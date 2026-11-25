/**
 * 批量写入并按阈值切片上传，对应 Java `S3DataSyncStream` + `S3MessageSender.sendSync()`。
 *
 * Java 端把每一批行写成 CSV、整批压成一个独立的 LZ4 Frame，压缩后 ≥ s3BatchSize（默认 10MB）
 * 才切一片上传；close() 时把剩余数据（可能为空）作为最后一片上传，然后合并分片。
 *
 * 这里把"编码"和"上传"拆开：
 * - `write(bytes)`：写入已经编码好的字节；
 * - `writeRow(row)`：用 `RowEncoder` 把一行编码后写入；
 * - `compressBatch`：每片上传前对整批数据做一次变换。默认不压缩。
 * - `batchEncoder`：增量编码器（如 LZ4 Frame）。设置后按"已产出的压缩字节数 ≥ batchSize"
 *   切片（与 Java `compressBuffer.size() >= S3_BATCH_SIZE` 一致），每片一个独立 frame；
 *   一片里没有写入任何数据时上传空字节（Java `compressBuffer == null` 的情况）。
 */
import { DEFAULT_S3_BATCH_SIZE } from '../constants';
import type { LocalAgentLogger } from '../logger';
import type { S3SourceData } from '../types';
import { FileUploadTask } from './file-upload-task';
import type { S3HttpClient } from './s3-http-client';

export type RowEncoder = (row: unknown[]) => Uint8Array;
export type BatchCompressor = (batch: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export interface BatchEncoder {
  write(bytes: Uint8Array): void;
  /** 已经产出的编码后字节数（用于切片阈值判断）。 */
  readonly compressedSize: number;
  finish(): Uint8Array;
}

export interface S3UploadStreamOptions {
  batchSize?: number;
  rowEncoder?: RowEncoder;
  compressBatch?: BatchCompressor;
  batchEncoder?: () => BatchEncoder;
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
  private encoder: BatchEncoder | null = null;
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
    if (this.options.batchEncoder) {
      // Java：先取当前压缩大小，写入这一行，再判断是否切片
      if (!this.encoder) this.encoder = this.options.batchEncoder();
      const size = this.encoder.compressedSize;
      this.encoder.write(bytes);
      this.buffered += bytes.length;
      if (size >= this.batchSize) await this.flush();
      return;
    }
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
    let data: Uint8Array;
    if (this.options.batchEncoder) {
      data = this.encoder ? this.encoder.finish() : new Uint8Array(0);
      this.encoder = null;
    } else {
      const raw = Buffer.concat(this.chunks, this.buffered);
      data = this.options.compressBatch ? await this.options.compressBatch(raw) : raw;
    }
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

/**
 * commons-csv 1.14 `CSVFormat.DEFAULT.printRecord` 的逐字节等价实现（QuoteMode.MINIMAL）：
 * - null / undefined 输出空（不加引号）；
 * - 空串在行首时输出 `""`；
 * - 首字符 ≤ '#'、含 CR / LF / 双引号 / 逗号、或末字符 ≤ 空格时加引号，内部双引号翻倍；
 * - 行尾 CRLF。
 */
export function formatCsvRecord(row: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < row.length; i++) {
    if (i > 0) out += ',';
    const value = row[i];
    if (value === null || value === undefined) continue;
    const text =
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    out += needsCsvQuote(text, i === 0) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  return `${out}\r\n`;
}

function needsCsvQuote(text: string, newRecord: boolean): boolean {
  if (text.length === 0) return newRecord;
  if (text.charCodeAt(0) <= 0x23) return true;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a || c === 0x0d || c === 0x22 || c === 0x2c) return true;
  }
  return text.charCodeAt(text.length - 1) <= 0x20;
}

export function encodeCsvRow(row: unknown[]): Uint8Array {
  return Buffer.from(formatCsvRecord(row), 'utf8');
}
