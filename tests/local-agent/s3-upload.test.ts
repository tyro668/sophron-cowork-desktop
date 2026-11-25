import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HttpEvent } from '../../src/main/local-agent/constants';
import { silentLocalAgentLogger } from '../../src/main/local-agent/logger';
import { RemoteEnvStore } from '../../src/main/local-agent/remote-env';
import { S3TransferError, SyncBizError } from '../../src/main/local-agent/s3/errors';
import { FileUploadTask } from '../../src/main/local-agent/s3/file-upload-task';
import { computeRetryDelay, DEFAULT_S3_RETRY_POLICY } from '../../src/main/local-agent/s3/retry';
import { S3HttpClient } from '../../src/main/local-agent/s3/s3-http-client';
import { S3UploadStream, encodeCsvRow } from '../../src/main/local-agent/s3/s3-upload-stream';
import { uploadLocalFile } from '../../src/main/local-agent/s3/upload-file';
import { WriteType, type S3SourceData } from '../../src/main/local-agent/types';
import { noSleep, startMockSyncServer, type MockSyncServer } from './mock-sync-server';

const CREDS = { agentId: 'a'.repeat(32), token: 'secret-token' };

function source(overrides: Partial<S3SourceData> = {}): S3SourceData {
  return {
    sourceName: 'mysql-1',
    tableName: 'orders',
    messageId: 'msg-1',
    groupId: 'g-1',
    path: 'tables/orders-0.csv.lz4',
    uploadId: 'up-0',
    type: WriteType.OVERWRITE,
    ...overrides,
  };
}

describe('S3 presigned multipart upload', () => {
  let server: MockSyncServer;
  let env: RemoteEnvStore;
  let client: S3HttpClient;

  beforeEach(async () => {
    server = await startMockSyncServer();
    env = new RemoteEnvStore();
    env.update({ baseUrl: server.baseUrl, s3InternalCooldownTime: 1800 });
    client = new S3HttpClient({
      remoteEnv: env,
      credentials: () => CREDS,
      logger: silentLocalAgentLogger,
      sleep: noSleep,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('computes guava-style retry delays', () => {
    const p = DEFAULT_S3_RETRY_POLICY;
    expect(computeRetryDelay(1, p, () => 0)).toBe(60);
    expect(computeRetryDelay(2, p, () => 0)).toBe(120);
    expect(computeRetryDelay(20, p, () => 0)).toBe(60_000);
    expect(computeRetryDelay(1, p, () => 0.999)).toBe(60 + 499);
  });

  it('merges agent credentials into every webhook body', async () => {
    await client.notifySyncStatus({ syncStatus: 2, tableName: 't' });
    const [call] = server.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS);
    expect(call.body).toEqual({
      syncStatus: 2,
      tableName: 't',
      skipSync: false,
      writeType: 0,
      agentId: CREDS.agentId,
      token: CREDS.token,
    });
  });

  it('does not retry business errors (Resp.code 400~500)', async () => {
    server.options.respCodeFor[HttpEvent.S3_COMPLETE_PART_URL] = 403;
    await expect(client.completePartUpload('p', 'u', ['e1'])).rejects.toBeInstanceOf(SyncBizError);
    expect(server.webhookCalls(HttpEvent.S3_COMPLETE_PART_URL)).toHaveLength(1);
  });

  it('retries other non-200 Resp codes up to 3 attempts', async () => {
    server.options.respCodeFor[HttpEvent.REPORT_TABLE_HEARTBEAT] = 503;
    await expect(client.reportHeartbeat([])).rejects.toBeInstanceOf(S3TransferError);
    expect(server.webhookCalls(HttpEvent.REPORT_TABLE_HEARTBEAT)).toHaveLength(3);
  });

  it('uploads via internal url when reachable and strips ETag quotes', async () => {
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger);
    await task.upload(Buffer.from('hello'));
    await task.complete(true);
    // 1 次空 PUT 探测 + 1 次真正上传，都走内网
    const intPuts = server.calls.filter((c) => c.path === '/oss/int');
    expect(intPuts.map((c) => c.bytes?.length)).toEqual([0, 5]);
    expect(server.calls.some((c) => c.path === '/oss/ext')).toBe(false);
    const [complete] = server.webhookCalls(HttpEvent.S3_COMPLETE_PART_URL);
    expect(complete.body).toMatchObject({
      path: 'tables/orders-0.csv.lz4',
      uploadId: 'up-0',
      tags: ['5d41402abc4b2a76b9719d911017c592'],
    });
  });

  it('falls back to external url and caches the unreachable state', async () => {
    server.options.internalAvailable = false;
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger);
    await task.upload(Buffer.from('a'));
    await task.upload(Buffer.from('b'));
    // 只探测一次（缓存），两片都走外网
    expect(server.calls.filter((c) => c.path === '/oss/int')).toHaveLength(1);
    expect(server.calls.filter((c) => c.path === '/oss/ext')).toHaveLength(2);
    expect(client.networkState.get()).toBe(false);
  });

  it('skips internal network entirely when disabled', async () => {
    client.enableInternalNetwork = false;
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger);
    await task.upload(Buffer.from('x'));
    expect(server.calls.filter((c) => c.path === '/oss/int')).toHaveLength(0);
  });

  it('retries failed part PUTs', async () => {
    client.enableInternalNetwork = false;
    server.options.failExternalPuts = 2;
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger);
    await task.upload(Buffer.from('retry-me'));
    expect(server.calls.filter((c) => c.path === '/oss/ext')).toHaveLength(3);
    expect(server.parts.get('tables/orders-0.csv.lz4#1')?.toString()).toBe('retry-me');
  });

  it('re-fetches the presigned url when it is already expired', async () => {
    client.enableInternalNetwork = false;
    server.options.expirationOffset = -1000;
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger);
    await task.upload(Buffer.from('x'));
    expect(server.webhookCalls(HttpEvent.S3_NEXT_PART_URL)).toHaveLength(2);
  });

  it('rotates to a new file after MAX_PART_NUMBER parts', async () => {
    client.enableInternalNetwork = false;
    const task = new FileUploadTask(source(), client, silentLocalAgentLogger, 2);
    for (const s of ['1', '2', '3']) await task.upload(Buffer.from(s));
    await task.complete(true);
    const fileReq = server.webhookCalls(HttpEvent.S3_FILE_PATH);
    expect(fileReq).toHaveLength(1);
    expect(fileReq[0].body).toMatchObject({
      index: 1,
      sourceName: 'mysql-1',
      tableName: 'orders',
      writeType: 0,
      groupId: 'g-1',
      messageId: 'msg-1',
    });
    const completes = server.webhookCalls(HttpEvent.S3_COMPLETE_PART_URL).map((c) => c.body);
    expect(completes).toHaveLength(2);
    expect((completes[0]?.tags as string[]).length).toBe(2);
    expect(completes[1]).toMatchObject({ uploadId: 'up-1' });
    expect(task.uploadedFiles().map((f) => f.parts)).toEqual([2, 1]);
  });

  it('S3UploadStream batches rows and uploads the (Java-style) final empty part', async () => {
    client.enableInternalNetwork = false;
    const stream = new S3UploadStream(source(), client, silentLocalAgentLogger, {
      batchSize: 10,
      rowEncoder: encodeCsvRow,
    });
    await stream.writeRow([1, 'abcdefgh']); // 11 bytes → flush
    await stream.writeRow(['x']);
    await stream.close();
    expect(stream.uploadedParts).toBe(2);
    expect(server.parts.get('tables/orders-0.csv.lz4#1')?.toString()).toBe('1,abcdefgh\r\n');
    expect(server.parts.get('tables/orders-0.csv.lz4#2')?.toString()).toBe('x\r\n');
    expect(server.webhookCalls(HttpEvent.S3_COMPLETE_PART_URL)).toHaveLength(1);
  });

  it('encodes CSV with quoting', () => {
    expect(Buffer.from(encodeCsvRow(['a,b', 'q"x', null, 3])).toString()).toBe(
      '"a,b","q""x",,3\r\n'
    );
  });

  it('uploadLocalFile splits a file into batch-size parts', async () => {
    client.enableInternalNetwork = false;
    const dir = await mkdtemp(path.join(tmpdir(), 'la-upload-'));
    try {
      const file = path.join(dir, 'data.bin');
      const content = Buffer.alloc(25, 7);
      await writeFile(file, content);
      const progress: number[] = [];
      const result = await uploadLocalFile(file, source(), client, silentLocalAgentLogger, {
        batchSize: 10,
        onProgress: (n) => progress.push(n),
      });
      expect(result).toMatchObject({ bytes: 25, parts: 3 });
      expect(progress).toEqual([10, 20, 25]);
      const sizes = [1, 2, 3].map((n) => server.parts.get(`tables/orders-0.csv.lz4#${n}`)?.length);
      expect(sizes).toEqual([10, 10, 5]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requests the first file path when the cloud did not pre-allocate one', async () => {
    client.enableInternalNetwork = false;
    const task = new FileUploadTask(
      source({ path: undefined, uploadId: undefined }),
      client,
      silentLocalAgentLogger
    );
    await task.upload(Buffer.from('x'));
    expect(server.webhookCalls(HttpEvent.S3_FILE_PATH)[0].body).toMatchObject({ index: 0 });
  });
});
