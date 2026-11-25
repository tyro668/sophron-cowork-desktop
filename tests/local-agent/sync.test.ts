import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HttpEvent } from '../../src/main/local-agent/constants';
import { silentLocalAgentLogger } from '../../src/main/local-agent/logger';
import { RemoteEnvStore } from '../../src/main/local-agent/remote-env';
import { S3HttpClient } from '../../src/main/local-agent/s3/s3-http-client';
import { SyncTaskDispatcher } from '../../src/main/local-agent/sync/sync-dispatcher';
import { S3SyncTask, type SyncTask } from '../../src/main/local-agent/sync/sync-task';
import { AgentSyncStatus, SyncTaskStatus, WriteType } from '../../src/main/local-agent/types';
import { noSleep, startMockSyncServer, type MockSyncServer } from './mock-sync-server';

describe('sync task + dispatcher', () => {
  let server: MockSyncServer;
  let client: S3HttpClient;

  beforeEach(async () => {
    server = await startMockSyncServer();
    const env = new RemoteEnvStore();
    env.update({ baseUrl: server.baseUrl });
    client = new S3HttpClient({
      remoteEnv: env,
      credentials: () => ({ agentId: 'a'.repeat(32), token: 't' }),
      logger: silentLocalAgentLogger,
      sleep: noSleep,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const fetchBean = { sourceName: 's', tableName: 't', groupId: 'g', messageId: 'm' };

  it('reports START_SYNC then UPLOAD_SUCCESS with columns and path', async () => {
    const task = new S3SyncTask(
      fetchBean,
      async () => ({
        ...fetchBean,
        path: 'p.csv',
        type: WriteType.APPEND,
        meta: { tableColumns: ['id'], tableColumnTypes: [4], tableColumnComments: [''] },
        equalColumns: ['id'],
      }),
      client,
      silentLocalAgentLogger
    );
    await task.run();
    const statuses = server.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).map((c) => c.body);
    expect(statuses[0]).toMatchObject({
      syncStatus: AgentSyncStatus.START_SYNC,
      groupId: 'g',
      messageId: 'm',
    });
    expect(statuses[1]).toMatchObject({
      syncStatus: AgentSyncStatus.UPLOAD_SUCCESS,
      path: 'p.csv',
      writeType: 1,
      tableColumns: ['id'],
      tableColumnTypes: [4],
      equalsColumns: ['id'],
      skipSync: false,
    });
  });

  it('reports UPLOAD_FAILED with the error message', async () => {
    const task = new S3SyncTask(
      fetchBean,
      async () => {
        throw new Error('db down');
      },
      client,
      silentLocalAgentLogger
    );
    await task.run();
    const statuses = server.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).map((c) => c.body);
    expect(statuses[1]).toMatchObject({
      syncStatus: AgentSyncStatus.UPLOAD_FAILED,
      errorMsg: 'db down',
    });
  });

  it('limits concurrency per source and reports waiting/running tables in heartbeat', async () => {
    const dispatcher = new SyncTaskDispatcher(client, silentLocalAgentLogger, 1);
    const releases: Array<() => void> = [];
    const mk = (tableName: string): SyncTask => ({
      sourceName: 's',
      tableName,
      groupId: 'g',
      run: () => new Promise<void>((r) => releases.push(r)),
    });
    const p1 = dispatcher.submit(mk('t1'));
    const p2 = dispatcher.submit(mk('t2'));
    await new Promise((r) => setTimeout(r, 5));
    expect(dispatcher.collectSyncTables()).toEqual([
      { groupId: 'g', sourceName: 's', tableName: 't2', syncStatus: SyncTaskStatus.WAITING },
      { groupId: 'g', sourceName: 's', tableName: 't1', syncStatus: SyncTaskStatus.RUNNING },
    ]);
    await dispatcher.reportHeartbeatOnce();
    const [hb] = server.webhookCalls(HttpEvent.REPORT_TABLE_HEARTBEAT);
    expect((hb.body?.tables as unknown[]).length).toBe(2);
    releases[0]();
    await p1;
    await new Promise((r) => setTimeout(r, 5));
    expect(releases).toHaveLength(2);
    releases[1]();
    await p2;
    expect(dispatcher.collectSyncTables()).toEqual([]);
    await dispatcher.reportHeartbeatOnce();
    expect(server.webhookCalls(HttpEvent.REPORT_TABLE_HEARTBEAT)).toHaveLength(1);
    dispatcher.close();
  });
});
