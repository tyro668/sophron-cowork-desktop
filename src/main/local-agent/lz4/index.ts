export { xxhash32 } from './xxhash32';
export { lz4CompressBlock, lz4CompressBound, lz4DecompressBlock } from './lz4-block';
export {
  LZ4_BLOCK_SIZE_1MB,
  LZ4_FRAME_MAGIC,
  Lz4FrameEncoder,
  lz4FrameDecode,
  lz4FrameEncode,
} from './lz4-frame';
import { Lz4FrameEncoder } from './lz4-frame';

/** `S3UploadStreamOptions.batchEncoder` 工厂：与 Java `LZ4FrameOutputStream(SIZE_1MB)` 同格式。 */
export function lz4FrameEncoderFactory(): Lz4FrameEncoder {
  return new Lz4FrameEncoder();
}
