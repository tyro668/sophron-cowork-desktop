/**
 * LZ4 块格式（block format）压缩 / 解压的纯 TS 实现。
 *
 * 压缩采用与 liblz4 `LZ4_compress_fast` 相同的贪心哈希匹配思路（最小匹配 4 字节，
 * 最后 5 字节必须是字面量，距结尾 12 字节内不再起匹配）；输出是合法的 LZ4 块，
 * 字节不要求与 lz4-java 完全一致，但任何 LZ4 解码器都能还原。
 */
const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MF_LIMIT = 12;
const HASH_LOG = 16;
const MAX_DISTANCE = 65535;

function hash(seq: number): number {
  return Math.imul(seq, 2654435761) >>> (32 - HASH_LOG);
}

function read32(src: Uint8Array, i: number): number {
  return (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
}

/** 最坏情况输出长度（与 LZ4_compressBound 一致）。 */
export function lz4CompressBound(n: number): number {
  return n + Math.floor(n / 255) + 16;
}

function writeLength(dst: Uint8Array, op: number, len: number): number {
  while (len >= 255) {
    dst[op++] = 255;
    len -= 255;
  }
  dst[op++] = len;
  return op;
}

/** 压缩 `src[start, end)`，返回写入 `dst` 的字节数。 */
export function lz4CompressBlock(
  src: Uint8Array,
  dst: Uint8Array,
  start = 0,
  end = src.length
): number {
  const table = new Int32Array(1 << HASH_LOG).fill(-1);
  let ip = start;
  let anchor = start;
  let op = 0;
  const matchLimit = end - LAST_LITERALS;
  const mfLimit = end - MF_LIMIT;

  if (end - start >= MF_LIMIT + 1) {
    while (ip < mfLimit) {
      const seq = read32(src, ip);
      const h = hash(seq);
      const ref = table[h];
      table[h] = ip;
      if (ref < start || ip - ref > MAX_DISTANCE || read32(src, ref) !== seq) {
        ip++;
        continue;
      }
      // 向前扩展
      let mStart = ip;
      let rStart = ref;
      while (mStart > anchor && rStart > start && src[mStart - 1] === src[rStart - 1]) {
        mStart--;
        rStart--;
      }
      // 向后扩展
      let mEnd = ip + MIN_MATCH;
      let rEnd = ref + MIN_MATCH;
      while (mEnd < matchLimit && src[mEnd] === src[rEnd]) {
        mEnd++;
        rEnd++;
      }
      const litLen = mStart - anchor;
      const matchLen = mEnd - mStart - MIN_MATCH;
      const tokenPos = op++;
      let token: number;
      if (litLen >= 15) {
        token = 0xf0;
        op = writeLength(dst, op, litLen - 15);
      } else token = litLen << 4;
      dst.set(src.subarray(anchor, mStart), op);
      op += litLen;
      const offset = mStart - rStart;
      dst[op++] = offset & 0xff;
      dst[op++] = offset >>> 8;
      if (matchLen >= 15) {
        token |= 0x0f;
        op = writeLength(dst, op, matchLen - 15);
      } else token |= matchLen;
      dst[tokenPos] = token;
      ip = mEnd;
      anchor = ip;
      if (ip - 2 >= start && ip - 2 < mfLimit) table[hash(read32(src, ip - 2))] = ip - 2;
    }
  }
  // 末尾字面量
  const litLen = end - anchor;
  const tokenPos = op++;
  if (litLen >= 15) {
    dst[tokenPos] = 0xf0;
    op = writeLength(dst, op, litLen - 15);
  } else dst[tokenPos] = litLen << 4;
  dst.set(src.subarray(anchor, end), op);
  op += litLen;
  return op;
}

/** 解压一个 LZ4 块。`maxOutput` 为解压后上限（frame 的块大小）。 */
export function lz4DecompressBlock(src: Uint8Array, maxOutput: number): Uint8Array {
  const dst = new Uint8Array(maxOutput);
  let ip = 0;
  let op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = src[ip++];
        litLen += b;
      } while (b === 255);
    }
    if (op + litLen > maxOutput || ip + litLen > src.length) throw new Error('LZ4 block corrupted');
    dst.set(src.subarray(ip, ip + litLen), op);
    ip += litLen;
    op += litLen;
    if (ip >= src.length) break;
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('LZ4 block corrupted: bad offset');
    let matchLen = token & 0x0f;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += MIN_MATCH;
    if (op + matchLen > maxOutput) throw new Error('LZ4 block corrupted: overflow');
    let ref = op - offset;
    for (let k = 0; k < matchLen; k++) dst[op++] = dst[ref++];
  }
  return dst.subarray(0, op);
}
