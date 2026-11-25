/**
 * 把本地文件按分片上传到云端分配的 OSS 路径。
 * 复用与表同步完全相同的预签名分片流程（FileUploadTask），文件按 batchSize 切片，
 * 每片原样上传（不再做 CSV/LZ4 编码）。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { DEFAULT_S3_BATCH_SIZE } from '../constants';
import type { LocalAgentLogger } from '../logger';
import type { S3SourceData } from '../types';
import type { S3HttpClient } from './s3-http-client';
import { S3UploadStream, type BatchCompressor } from './s3-upload-stream';

export interface UploadLocalFileOptions {
  batchSize?: number;
  compressBatch?: BatchCompressor;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

export interface UploadLocalFileResult {
  bytes: number;
  parts: number;
  files: Array<{ path: string; uploadId: string; parts: number }>;
}

export async function uploadLocalFile(
  filePath: string,
  source: S3SourceData,
  client: S3HttpClient,
  logger: LocalAgentLogger,
  options: UploadLocalFileOptions = {}
): Promise<UploadLocalFileResult> {
  const batchSize = options.batchSize ?? DEFAULT_S3_BATCH_SIZE;
  const { size } = await stat(filePath);
  const stream = new S3UploadStream(source, client, logger, {
    batchSize,
    compressBatch: options.compressBatch,
    skipEmptyFinalPart: true,
  });
  let uploaded = 0;
  // highWaterMark = batchSize：每次读到的块正好凑成一片，最后一片可能更小
  const reader = createReadStream(filePath, { highWaterMark: batchSize });
  for await (const chunk of reader) {
    const buf = chunk as Buffer;
    await stream.write(buf);
    uploaded += buf.length;
    options.onProgress?.(uploaded, size);
  }
  await stream.close();
  return { bytes: uploaded, parts: stream.uploadedParts, files: stream.task.uploadedFiles() };
}
