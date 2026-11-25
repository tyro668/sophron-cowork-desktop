/**
 * 单表/单文件的分片上传任务，对应 Java `FileUploadTask`。
 *
 * - 第一个文件的 path/uploadId 由云端在任务里下发（FetchBean.path / uploadId）；
 * - 每片上传前向云端申请预签名 URL，上传后记录 ETag；
 * - 单文件超过 10000 片时先合并当前文件，再申请下一个文件（index = 已有文件数）；
 * - complete() 合并当前文件的所有分片。
 */
import { MAX_PART_NUMBER } from '../constants';
import type { LocalAgentLogger } from '../logger';
import type { S3SourceData } from '../types';
import type { S3HttpClient } from './s3-http-client';

interface FileInfo {
  path?: string;
  uploadId?: string;
  eTags: string[];
}

export interface UploadedFile {
  path: string;
  uploadId: string;
  parts: number;
}

export class FileUploadTask {
  private readonly files: FileInfo[] = [];

  constructor(
    private readonly source: S3SourceData,
    private readonly client: S3HttpClient,
    private readonly logger: LocalAgentLogger,
    private readonly maxPartNumber: number = MAX_PART_NUMBER
  ) {
    this.files.push({ path: source.path, uploadId: source.uploadId, eTags: [] });
  }

  private current(): FileInfo {
    return this.files[this.files.length - 1];
  }

  get fileCount(): number {
    return this.files.length;
  }

  /** 已上传的文件（含分片数），用于结果回报和测试。 */
  uploadedFiles(): UploadedFile[] {
    return this.files
      .filter((f): f is FileInfo & { path: string; uploadId: string } => !!f.path && !!f.uploadId)
      .map((f) => ({ path: f.path, uploadId: f.uploadId, parts: f.eTags.length }));
  }

  /** 如果云端没有预先分配首个文件，按 index 0 申请（推断行为，Java 端总是由云端预分配）。 */
  private async ensureFirstFile(): Promise<void> {
    const file = this.current();
    if (file.path && file.uploadId) return;
    const s3Path = await this.client.fetchFilePathInfo({
      groupId: this.source.groupId,
      sourceName: this.source.sourceName,
      tableName: this.source.tableName,
      writeType: this.source.type,
      messageId: this.source.messageId,
      index: this.files.length - 1,
    });
    file.path = s3Path.path;
    file.uploadId = s3Path.uploadId;
    if (!file.path || !file.uploadId) {
      throw new Error('cloud did not return path/uploadId for the upload file');
    }
  }

  async upload(data: Uint8Array): Promise<void> {
    await this.ensureFirstFile();
    let file = this.current();
    let partNumber = file.eTags.length + 1;
    if (partNumber > this.maxPartNumber) {
      await this.complete(false);
      const s3Path = await this.client.fetchFilePathInfo({
        groupId: this.source.groupId,
        sourceName: this.source.sourceName,
        tableName: this.source.tableName,
        writeType: this.source.type,
        messageId: this.source.messageId,
        index: this.files.length,
      });
      this.files.push({ path: s3Path.path, uploadId: s3Path.uploadId, eTags: [] });
      file = this.current();
      partNumber = 1;
    }
    const params = {
      partNumber,
      uploadId: file.uploadId!,
      path: file.path!,
      sourceName: this.source.sourceName,
      tableName: this.source.tableName,
    };
    const s3Path = await this.client.fetchNextPartUploadInfo(params);
    const eTag = await this.client.multiPartUpload(params, s3Path, data);
    this.logger.info(
      `Upload successfully, file index = ${this.files.length}, partNumber = ${partNumber}`
    );
    file.eTags.push(eTag);
  }

  async complete(isEnd: boolean): Promise<void> {
    const file = this.current();
    if (!file.path) return;
    await this.client.completePartUpload(file.path, file.uploadId ?? '', [...file.eTags]);
    this.logger.info(`Complete file upload, file index = ${this.files.length}, isEnd = ${isEnd}`);
  }
}
