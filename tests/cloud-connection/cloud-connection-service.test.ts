import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server as IOServer } from 'socket.io';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  CloudConnectionService,
  MemoryCloudConnectionStore,
  maskAgentId,
} from '../../src/main/features/cloud-connection/service';
import { HttpEvent } from '../../src/main/local-agent/constants';
import { silentLocalAgentLogger, type LocalAgentLogger } from '../../src/main/local-agent/logger';
import { startMockSyncServer, type MockSyncServer } from '../local-agent/mock-sync-server';

const AGENT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'super-secret-token-value';

function until(check: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 10);
  });
}

function yaml(port: number, token = TOKEN): string {
  return [
    'server:',
    '  protocol: "http"',
    `  port: ${port}`,
    `  agentId: "${AGENT_ID}"`,
    `  token: "${token}"`,
    '  host: "127.0.0.1"',
    '  path: "/gw"',
    'socket.io:',
    '  reconnectionAttempts: 1',
    '  reconnectionDelay: 50',
    '  timeout: 2000',
    '',
  ].join('\n');
}

describe('CloudConnectionService', () => {
  let dir: string;
  let xlsxPath: string;
  let csvPath: string;
  let logs: string[];
  let logger: LocalAgentLogger;
  let service: CloudConnectionService | null;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cloud-conn-'));
    xlsxPath = path.join(dir, 'report.xlsx');
    csvPath = path.join(dir, 'list.csv');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['a', 'b'],
        [1, 'x'],
      ]),
      'Data'
    );
    XLSX.writeFile(wb, xlsxPath);
    await writeFile(csvPath, 'k,v\n1,2\n3,4\n');
    await writeFile(path.join(dir, 'notes.txt'), 'x');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    logs = [];
    const push = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    logger = { ...silentLocalAgentLogger, info: push, warn: push, error: push };
    service = null;
  });

  afterEach(() => {
    service?.stop();
  });

  it('imports config without exposing the token', () => {
    const notified: string[] = [];
    service = new CloudConnectionService({
      store: new MemoryCloudConnectionStore(),
      logger,
      notify: (s) => notified.push(JSON.stringify(s)),
    });
    service.importConfigText(yaml(1234), '/x/y/config.yaml');
    const state = service.getState();
    expect(state.configured).toBe(true);
    expect(state.config).toMatchObject({
      agentIdMasked: maskAgentId(AGENT_ID),
      host: '127.0.0.1',
      port: 1234,
      fileName: 'config.yaml',
      hasToken: true,
    });
    expect(state.config!.agentIdMasked).toBe('0123****cdef');
    const everything = [JSON.stringify(state), ...notified, ...logs].join('\n');
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(AGENT_ID);
  });

  it('rejects configs without token', () => {
    service = new CloudConnectionService({ store: new MemoryCloudConnectionStore(), logger });
    expect(() => service!.importConfigText(yaml(1, ''))).toThrow(/token/);
    expect(service.getState().configured).toBe(false);
  });

  it('manages files: type check, name clash, parse status, preview, remove', async () => {
    const store = new MemoryCloudConnectionStore();
    service = new CloudConnectionService({ store, logger });
    const rejected = await service.addFiles([xlsxPath, csvPath, path.join(dir, 'notes.txt')]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('notes.txt');
    const clash = await service.addFiles([path.join(dir, 'sub', 'list.csv')]);
    expect(clash[0]).toContain('同名');
    const files = service.getState().files;
    expect(files.map((f) => [f.name, f.status])).toEqual([
      ['report.xlsx', 'ready'],
      ['list.csv', 'ready'],
    ]);
    expect(files[0].sheets).toEqual([
      expect.objectContaining({
        sheetName: 'Data',
        tableId: 'report.xlsx_Data',
        rowCount: 1,
        columns: ['a', 'b', '文件夹名(系统字段)', '表名(系统字段)', 'sheet名(系统字段)'],
      }),
    ]);
    const preview = await service.previewFile(csvPath);
    expect(preview.sheets[0].sampleRows.length).toBe(2);
    expect(preview.delimiter).toBe(',');
    await expect(service.previewFile('/etc/passwd')).rejects.toThrow();
    await service.removeFile(csvPath);
    expect(store.read().files).toEqual([xlsxPath]);
  });

  describe('connected', () => {
    let http: HttpServer;
    let io: IOServer;
    let sync: MockSyncServer;
    let port: number;

    beforeEach(async () => {
      sync = await startMockSyncServer();
      http = createServer();
      io = new IOServer(http, { path: '/gw/socket.io' });
      io.of('/database').on('connection', (socket) => {
        socket.on('agent_cmd', (_d: unknown, ack?: (v: string) => void) =>
          ack?.(JSON.stringify({ code: 'ok', data: '[]' }))
        );
        socket.emit('connectSuccess', JSON.stringify({ baseUrl: sync.baseUrl }));
      });
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
      port = (http.address() as AddressInfo).port;
    });

    afterEach(async () => {
      service?.stop();
      service = null;
      await new Promise<void>((r) => io.close(() => r()));
      await sync.close();
    });

    it('connects, registers tables, reports file changes and disconnects', async () => {
      service = new CloudConnectionService({
        store: new MemoryCloudConnectionStore(),
        logger,
        agentOptions: { aliveLogIntervalMs: 0 },
      });
      service.importConfigText(yaml(port));
      service.setSourceName('我的本地文件');
      await service.addFiles([xlsxPath]);
      service.connect();
      await until(() => sync.webhookCalls(HttpEvent.SOURCE_ALL).length > 0);
      await until(() => service!.getState().status === 'connected');
      const state = service.getState();
      expect(state.remoteEnv).toMatchObject({ baseUrl: sync.baseUrl });
      expect(state.connectedAt).toBeTypeOf('number');
      const body = sync.webhookCalls(HttpEvent.SOURCE_ALL)[0].body!;
      expect(body.changeType).toBe('systemStarted');
      expect(body.agentBasicTableList).toEqual([
        expect.objectContaining({ sourceName: '我的本地文件', tableName: 'report.xlsx_Data' }),
      ]);
      expect(() => service!.setSourceName('x')).toThrow();

      await service.addFiles([csvPath]);
      await until(() => sync.webhookCalls(HttpEvent.SOURCE_SINGLE).length > 0);
      const single = sync.webhookCalls(HttpEvent.SOURCE_SINGLE)[0].body!;
      expect(single).toMatchObject({ changeType: 'updateSingle', sourceName: '我的本地文件' });
      expect((single.agentBasicTableList as unknown[]).length).toBe(2);

      service.disconnect();
      expect(service.getState().status).toBe('stopped');
      expect(
        service.getState().activities.some((a) => a.event === 'connectSuccess' && a.type === 'info')
      ).toBe(true);
      expect(logs.join('\n')).not.toContain(TOKEN);
    });
  });
});
