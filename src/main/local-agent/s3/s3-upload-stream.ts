/**
 * 批量写入并按阈值切片上传，对应 Java `S3DataSyncStream` + `S3MessageSender.sendSync()`。
 *
 * Java 端把每一批行写成 CSV、整批压成一个独立的 LZ4 Frame，压缩后 ≥ s3BatchSize（默认 10MB）
 * 才切一片上传；close() 时把剩余数据（可能为空）作为最后一片上传，然后合并分片。
 *
 * 这里把"编码"和"上传"拆开：
 * - `write(bytes)`：写入已经编码好的字节；
 * - `writeRow(row)`：用 `RowEncoder` 把一行编码后写入；
 * - `compressBatch`：每片上传前对整批数据做一次变换。要与 Sync 端兼容，应传入 LZ4 Frame 压缩
 *   （见迁移说明，本次未引入 LZ4 依赖）。默认不压缩。
 */
import { DEFAULT_S3_BATCH_SIZE } from '../constants';
import type { LocalAgentLogger } from '../logger';
import type { S3SourceData } from '../types';
import { FileUploadTask } from './file-upload-task';
import type { S3HttpClient } from './s3-http-client';

export type RowEncoder = (row: unknown[]) => Uint8Array;
export type BatchCompressor = (batch: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export interface S3UploadStreamOptions {
  batchSize?: number;
  rowEncoder?: RowEncoder;
  compressBatch?: BatchCompressor;
  /** 与 Java 一致，默认 close() 时即使没有剩余数据也上传一个空的最后一片。 */
  skipEmptyFinalPart?: boolean;
}

export class S3UploadStream {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private rowCount = 0;
  private batch = 1;
  private partsUploaded = 0;
  private closed = false;
  readonly task: FileUploadTask;
  private readonly batchSize: number;

  constructor(
    readonly source: S3SourceData,
    client: S3HttpClient,
    private readonly logger: LocalAgentLogger,
    private readonly options: S3UploadStreamOptions = {}
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_S3_BATCH_SIZE;
    this.task = new FileUploadTask(source, client, logger);
  }

  get totalRows(): number {
    return this.rowCount;
  }

  get uploadedParts(): number {
    return this.partsUploaded;
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.ensureOpen();
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.buffered += bytes.length;
    if (this.buffered >= this.batchSize) await this.flush();
  }

  async writeRow(row: unknown[]): Promise<void> {
    if (!this.options.rowEncoder) throw new Error('rowEncoder is not configured');
    this.rowCount++;
    await this.write(this.options.rowEncoder(row));
  }

  /** 结束当前批次并上传一片。 */
  async flush(): Promise<void> {
    this.ensureOpen();
    await this.sendBatch(false);
    this.batch++;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (!(this.options.skipEmptyFinalPart && this.buffered === 0 && this.partsUploaded > 0)) {
      await this.sendBatch(true);
    }
    this.closed = true;
    await this.task.complete(true);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('S3 upload stream is closed');
  }

  private async sendBatch(end: boolean): Promise<void> {
    const raw = Buffer.concat(this.chunks, this.buffered);
    const data = this.options.compressBatch ? await this.options.compressBatch(raw) : raw;
    this.logger.info(
      `Prepared s3 batch and send, batch: ${this.batch}, size: ${(data.length / 1024 / 1024).toFixed(2)} MB, isLast: ${end}, rows: ${this.rowCount}, messageId: ${this.source.messageId ?? ''}`
    );
    await this.task.upload(data);
    this.partsUploaded++;
    // 上传成功后再释放缓冲，失败时由调用方决定是否整体重试
    this.chunks = [];
    this.buffered = 0;
  }
}

/** commons-csv `CSVFormat.DEFAULT` 风格的最小 CSV 行编码（逗号分隔、CRLF、按需加引号）。 */
export function encodeCsvRow(row: unknown[]): Uint8Array {
  const cells = row.map((value) => {
    if (value === null || value === undefined) return '';
    const text =
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  });
  return Buffer.from(`${cells.join(',')}\r\n`, 'utf8');
}
