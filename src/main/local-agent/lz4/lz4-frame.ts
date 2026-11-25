/**
 * LZ4 Frame 编码 / 解码，按 lz4-java 1.8.0
 * `new LZ4FrameOutputStream(out, BLOCKSIZE.SIZE_1MB)` 的输出格式：
 *
 *   magic 04 22 4D 18 | FLG 0x60（version=01, block independence）| BD 0x60（1MB）| HC
 *   每块：u32le 长度（最高位=1 表示未压缩原样存储）+ 数据；无块校验
 *   结束标记 00 00 00 00；无内容校验、无 content size
 *
 * Java 端（S3DataSyncStream）每个上传分片都是一个独立的 Frame，这里同样一片一帧。
 */
import { lz4CompressBlock, lz4CompressBound, lz4DecompressBlock } from './lz4-block';
import { xxhash32 } from './xxhash32';

export const LZ4_FRAME_MAGIC = 0x184d2204;
export const LZ4_BLOCK_SIZE_1MB = 1024 * 1024;
const FLG_VERSION = 0x40;
const FLG_BLOCK_INDEPENDENCE = 0x20;
const FLG_BLOCK_CHECKSUM = 0x10;
const FLG_CONTENT_SIZE = 0x08;
const FLG_CONTENT_CHECKSUM = 0x04;
const BD_1MB = 6 << 4;
const UNCOMPRESSED_FLAG = 0x80000000;

function frameHeader(): Uint8Array {
  const header = new Uint8Array(7);
  const view = new DataView(header.buffer);
  view.setUint32(0, LZ4_FRAME_MAGIC, true);
  header[4] = FLG_VERSION | FLG_BLOCK_INDEPENDENCE;
  header[5] = BD_1MB;
  header[6] = (xxhash32(header, 0, 4, 2) >>> 8) & 0xff;
  return header;
}

/**
 * 增量写入的 LZ4 Frame 编码器：攒满 1MB 原始数据压成一块，`compressedSize`
 * 是已经产出的压缩字节数（与 Java `compressBuffer.size()` 一样是估算阈值用的）。
 */
export class Lz4FrameEncoder {
  private readonly blockSize: number;
  private readonly pending: Uint8Array;
  private pendingLen = 0;
  private readonly out: Uint8Array[] = [];
  private outLen = 0;
  private readonly scratch: Uint8Array;
  private finished = false;

  constructor(blockSize = LZ4_BLOCK_SIZE_1MB) {
    this.blockSize = blockSize;
    this.pending = new Uint8Array(blockSize);
    this.scratch = new Uint8Array(lz4CompressBound(blockSize));
    this.push(frameHeader());
  }

  get compressedSize(): number {
    return this.outLen;
  }

  write(data: Uint8Array): void {
    if (this.finished) throw new Error('LZ4 frame already finished');
    let offset = 0;
    while (offset < data.length) {
      const n = Math.min(this.blockSize - this.pendingLen, data.length - offset);
      this.pending.set(data.subarray(offset, offset + n), this.pendingLen);
      this.pendingLen += n;
      offset += n;
      if (this.pendingLen === this.blockSize) this.writeBlock();
    }
  }

  /** 写出剩余数据 + 结束标记，返回完整 frame。 */
  finish(): Uint8Array {
    if (!this.finished) {
      if (this.pendingLen > 0) this.writeBlock();
      this.push(new Uint8Array(4));
      this.finished = true;
    }
    return Buffer.concat(this.out, this.outLen);
  }

  private writeBlock(): void {
    const len = this.pendingLen;
    const compressedLen = lz4CompressBlock(this.pending, this.scratch, 0, len);
    const sizeField = new Uint8Array(4);
    const view = new DataView(sizeField.buffer);
    if (compressedLen >= len) {
      view.setUint32(0, (len | UNCOMPRESSED_FLAG) >>> 0, true);
      this.push(sizeField);
      this.push(this.pending.slice(0, len));
    } else {
      view.setUint32(0, compressedLen, true);
      this.push(sizeField);
      this.push(this.scratch.slice(0, compressedLen));
    }
    this.pendingLen = 0;
  }

  private push(chunk: Uint8Array): void {
    this.out.push(chunk);
    this.outLen += chunk.length;
  }
}

/** 一次性把 `data` 编成一个 LZ4 Frame。 */
export function lz4FrameEncode(data: Uint8Array, blockSize = LZ4_BLOCK_SIZE_1MB): Uint8Array {
  const encoder = new Lz4FrameEncoder(blockSize);
  encoder.write(data);
  return encoder.finish();
}

const BLOCK_MAX_SIZES: Record<number, number> = {
  4: 64 * 1024,
  5: 256 * 1024,
  6: 1024 * 1024,
  7: 4 * 1024 * 1024,
};

/**
 * 解码一个或多个首尾相接的 LZ4 Frame（支持块 / 内容校验与 content size 标志，用于
 * 校验 Java 产物与测试）。
 */
export function lz4FrameDecode(input: Uint8Array): Uint8Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const out: Uint8Array[] = [];
  let pos = 0;
  while (pos < input.length) {
    if (view.getUint32(pos, true) !== LZ4_FRAME_MAGIC) throw new Error('bad LZ4 frame magic');
    const flg = input[pos + 4];
    const bd = input[pos + 5];
    if ((flg & 0xc0) !== FLG_VERSION) throw new Error('unsupported LZ4 frame version');
    let headerLen = 2;
    if (flg & FLG_CONTENT_SIZE) headerLen += 8;
    if (flg & 0x01) headerLen += 4;
    const hc = input[pos + 4 + headerLen];
    if (((xxhash32(input, 0, pos + 4, headerLen) >>> 8) & 0xff) !== hc) {
      throw new Error('LZ4 frame header checksum mismatch');
    }
    const maxBlock = BLOCK_MAX_SIZES[(bd >>> 4) & 0x07];
    if (!maxBlock) throw new Error('bad LZ4 block max size');
    pos += 4 + headerLen + 1;
    const frameParts: Uint8Array[] = [];
    for (;;) {
      const raw = view.getUint32(pos, true);
      pos += 4;
      if (raw === 0) break;
      const size = raw & 0x7fffffff;
      const block = input.subarray(pos, pos + size);
      pos += size;
      frameParts.push(
        raw & UNCOMPRESSED_FLAG ? block.slice() : lz4DecompressBlock(block, maxBlock)
      );
      if (flg & FLG_BLOCK_CHECKSUM) pos += 4;
    }
    const content = Buffer.concat(frameParts);
    if (flg & FLG_CONTENT_CHECKSUM) {
      if (view.getUint32(pos, true) !== xxhash32(content))
        throw new Error('LZ4 content checksum mismatch');
      pos += 4;
    }
    out.push(content);
  }
  return Buffer.concat(out);
}
