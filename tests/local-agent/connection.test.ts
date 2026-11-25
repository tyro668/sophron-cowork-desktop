import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HttpEvent } from '../../src/main/local-agent/constants';
import { LocalAgent } from '../../src/main/local-agent/local-agent';
import { silentLocalAgentLogger } from '../../src/main/local-agent/logger';
import { AgentSyncStatus, type LocalAgentConfig } from '../../src/main/local-agent/types';
import { startMockSyncServer, type MockSyncServer } from './mock-sync-server';

const AGENT_ID = 'b'.repeat(32);

function waitFor<T>(fn: (resolve: (v: T) => void) => void, ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fn((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

describe('LocalAgent over a real Socket.IO server', () => {
  let http: HttpServer;
  let io: IOServer;
  let port: number;
  let sync: MockSyncServer;
  let agent: LocalAgent | null = null;
  let lastHandshake: Record<string, unknown> = {};
  let serverSocket: ServerSocket | null = null;

  beforeEach(async () => {
    sync = await startMockSyncServer();
    sync.options.omitInternalUrl = true;
    http = createServer();
    io = new IOServer(http, { path: '/gw/socket.io' });
    io.of('/database').on('connection', (socket) => {
      serverSocket = socket;
      lastHandshake = { ...socket.handshake.query };
      if (socket.handshake.query.token !== 'good') {
        socket.emit('connectErrorMessage', 'token invalid');
        return;
      }
      socket.emit(
        'connectSuccess',
        JSON.stringify({
          baseUrl: sync.baseUrl,
          rowcountTimout: 180,
          contentTimout: 180,
          s3InternalCooldownTime: 1800,
          tableHeartbeatInterval: 180,
        })
      );
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    port = (http.address() as AddressInfo).port;
  });

  afterEach(async () => {
    agent?.stop();
    agent = null;
    serverSocket = null;
    await new Promise<void>((r) => io.close(() => r()));
    await sync.close();
  });

  const config = (token = 'good'): LocalAgentConfig => ({
    server: { agentId: AGENT_ID, token, protocol: 'http', host: '127.0.0.1', port, path: '/gw' },
    socketIO: { reconnectionAttempts: 2, reconnectionDelay: 50, timeout: 2000 },
  });

  it('connects to /database with handshake query and applies connectSuccess env', async () => {
    agent = new LocalAgent(config(), {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
    });
    const envPromise = waitFor<unknown>((r) => agent!.on('connectSuccess', r));
    expect(agent.start()).toBe(true);
    const env = await envPromise;
    expect(env).toMatchObject({
      baseUrl: sync.baseUrl,
      rowcountTimeout: 180,
      tableHeartbeatInterval: 180,
    });
    expect(agent.state).toBe('connected');
    expect(lastHandshake).toMatchObject({
      token: 'good',
      agentId: AGENT_ID,
      version: '3.0.0',
      apiLevel: '5',
    });
    expect(String(lastHandshake.instanceId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(agent.connection.getSocket()?.io.engine.transport.name).toBe('websocket');
  });

  it('surfaces connectErrorMessage', async () => {
    agent = new LocalAgent(config('bad'), {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
    });
    const msg = waitFor<string>((r) => agent!.on('connectError', r));
    agent.start();
    expect(await msg).toBe('token invalid');
  });

  it('handles offline without exiting the process and stops reconnecting', async () => {
    agent = new LocalAgent(config(), {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
    });
    await waitFor((r) => {
      agent!.on('connectSuccess', () => r(undefined));
      agent!.start();
    });
    const offline = waitFor((r) => agent!.on('offline', () => r(undefined)));
    serverSocket!.emit('offline');
    await offline;
    expect(agent.state).toBe('offline');
    expect(agent.connection.getSocket()).toBeNull();
  });

  it('does not connect with the demo agent id', () => {
    const cfg = config();
    cfg.server.agentId = 'DEMO_AGENTID';
    agent = new LocalAgent(cfg, {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
    });
    expect(agent.start()).toBe(false);
  });

  it('runs table_content_s3_dispatch end to end: START_SYNC → parts → complete → UPLOAD_SUCCESS', async () => {
    agent = new LocalAgent(config(), {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
      streamOptions: { batchSize: 8 },
    });
    agent.registerTableContentProvider('mysql-1', async ({ stream, source }) => {
      source.equalColumns = ['id'];
      await stream.write(Buffer.from('id,name\r\n'));
      await stream.write(Buffer.from('1,a\r\n'));
    });
    await waitFor((r) => {
      agent!.on('connectSuccess', () => r(undefined));
      agent!.start();
    });
    const fetchBean = {
      sourceName: 'mysql-1',
      tableName: 'orders',
      groupId: 'g-9',
      path: 'tables/orders.csv.lz4',
      uploadId: 'up-9',
      tableMeta: { tableColumns: ['id', 'name'], tableColumnTypes: [4, 12] },
    };
    serverSocket!.emit('table_content_s3_dispatch', JSON.stringify(fetchBean), 'msg-9');
    await waitFor<void>((r) => {
      const timer = setInterval(() => {
        if (sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).length >= 2) {
          clearInterval(timer);
          r();
        }
      }, 10);
    });
    const statuses = sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).map((c) => c.body);
    expect(statuses[0]).toMatchObject({
      syncStatus: AgentSyncStatus.START_SYNC,
      messageId: 'msg-9',
      agentId: AGENT_ID,
      token: 'good',
    });
    expect(statuses[1]).toMatchObject({
      syncStatus: AgentSyncStatus.UPLOAD_SUCCESS,
      path: 'tables/orders.csv.lz4',
      tableColumns: ['id', 'name'],
      equalsColumns: ['id'],
    });
    expect(sync.parts.get('tables/orders.csv.lz4#1')?.toString()).toBe('id,name\r\n');
    expect(sync.parts.get('tables/orders.csv.lz4#2')?.toString()).toBe('1,a\r\n');
    const [complete] = sync.webhookCalls(HttpEvent.S3_COMPLETE_PART_URL);
    expect((complete.body?.tags as string[]).length).toBe(2);
  });

  it('reports UPLOAD_FAILED when no provider is registered for the source', async () => {
    agent = new LocalAgent(config(), {
      version: '3.0.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
    });
    await waitFor((r) => {
      agent!.on('connectSuccess', () => r(undefined));
      agent!.start();
    });
    serverSocket!.emit(
      'table_content_s3_dispatch',
      JSON.stringify({ sourceName: 'nope', tableName: 't' }),
      'm'
    );
    await waitFor<void>((r) => {
      const timer = setInterval(() => {
        if (sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).length >= 2) {
          clearInterval(timer);
          r();
        }
      }, 10);
    });
    expect(sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS)[1].body).toMatchObject({
      syncStatus: AgentSyncStatus.UPLOAD_FAILED,
      errorMsg: 'datasource not found: nope',
    });
  });
});
