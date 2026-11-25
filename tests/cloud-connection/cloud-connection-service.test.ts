import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server as IOServer } from 'socket.io';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  CLOUD_CONNECTION_SCHEMA_VERSION,
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
    await mkdir(path.join(dir, 'm'));
    await writeFile(path.join(dir, 'm', 'a.csv'), 'k,v\n1,a\n2,b\n');
    await writeFile(path.join(dir, 'm', 'b.csv'), 'k,v\n3,c\n');
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

  it('migrates the v1 per-file registry into one group with identical table ids', async () => {
    const legacyVersion = [{ fileName: xlsxPath, modifyTime: 1 }];
    const store = new MemoryCloudConnectionStore({
      config: null,
      autoConnect: false,
      sourceName: '我的本地文件',
      files: [xlsxPath, csvPath],
      versions: { 'report.xlsx_Data': legacyVersion },
    } as never);
    service = new CloudConnectionService({ store, logger });
    const data = store.read();
    expect(data.schemaVersion).toBe(CLOUD_CONNECTION_SCHEMA_VERSION);
    expect(data.groups).toEqual([
      expect.objectContaining({
        sourceName: '我的本地文件',
        directoryPath: '',
        strategy: 0,
        tables: [],
        files: [xlsxPath, csvPath],
      }),
    ]);
    expect(data.versions).toEqual({ 我的本地文件: { 'report.xlsx_Data': legacyVersion } });
    // 旧字段保留，便于回退
    expect(data.files).toEqual([xlsxPath, csvPath]);
    await service.refreshTables();
    const [group] = service.getState().groups;
    expect(group.entries.map((e) => [e.id, e.manual])).toEqual([
      ['report.xlsx_Data', false],
      ['list.csv', false],
    ]);
    // 再次构造不重复迁移
    const again = new CloudConnectionService({ store, logger });
    expect(again.getState().groups).toHaveLength(1);
    await service.removeLegacyFile(group.id, csvPath);
    expect(store.read().groups[0].files).toEqual([xlsxPath]);
  });

  it('migration of an empty v1 store creates no group', () => {
    const store = new MemoryCloudConnectionStore({ sourceName: 'x', files: [] } as never);
    service = new CloudConnectionService({ store, logger });
    expect(store.read().groups).toEqual([]);
    expect(store.read().schemaVersion).toBe(CLOUD_CONNECTION_SCHEMA_VERSION);
  });

  it('manages groups and manual tables with Java validation rules; passwords stay in main', async () => {
    const store = new MemoryCloudConnectionStore();
    service = new CloudConnectionService({ store, logger });
    await expect(
      service.addGroup({ sourceName: 'a&b', directoryPath: dir, strategy: 1 })
    ).rejects.toThrow('分组名称不能出现&');
    await expect(
      service.addGroup({ sourceName: ' ', directoryPath: dir, strategy: 1 })
    ).rejects.toThrow('分组名不能为空');
    await expect(
      service.addGroup({ sourceName: 'g', directoryPath: path.join(dir, 'nope'), strategy: 1 })
    ).rejects.toThrow('目录不存在');
    const id = await service.addGroup({ sourceName: '本地', directoryPath: dir, strategy: 1 });
    await expect(
      service.addGroup({ sourceName: '本地', directoryPath: dir, strategy: 1 })
    ).rejects.toThrow('分组名称请勿重复');
    let group = service.getState().groups[0];
    expect(group.entries.map((e) => e.id)).toEqual(['list.csv', 'report.xlsx_Data']);

    const table = {
      tableName: '合并表',
      strategy: 5,
      fieldStrategy: 0,
      readStrategy: 0,
      appendStrategy: 0,
      relativeFilePath: '/m',
      headerRowNumber: 1,
      sheetStrategy: 0,
      sheetNumber: 1,
      sheetName: 'Sheet1',
      password: 'pw',
    };
    await expect(service.saveTable(id, null, { ...table, tableName: '' })).rejects.toThrow(
      '请输入表名'
    );
    await expect(
      service.saveTable(id, null, { ...table, strategy: 0, relativeFilePath: '' })
    ).rejects.toThrow('请选择文件路径');
    await service.saveTable(id, null, table);
    await expect(service.saveTable(id, null, table)).rejects.toThrow('表名请勿重复');
    group = service.getState().groups[0];
    expect(group.tables).toEqual([
      expect.objectContaining({ tableName: '合并表', relativeFilePath: '/m', hasPassword: true }),
    ]);
    expect(JSON.stringify(service.getState())).not.toContain('"pw"');
    expect(store.read().groups[0].tables[0].password).toBe('pw');
    // 手动表在前，m 目录不再出现在自动表里
    expect(group.entries.map((e) => [e.id, e.manual])).toEqual([
      ['合并表', true],
      ['list.csv', false],
      ['report.xlsx_Data', false],
    ]);
    // password undefined = 保持；null = 清除
    await service.saveTable(id, '合并表', { ...table, password: undefined, headerRowNumber: 2 });
    expect(store.read().groups[0].tables[0]).toMatchObject({ password: 'pw', headerRowNumber: 2 });
    await service.saveTable(id, '合并表', { ...table, password: null });
    expect(store.read().groups[0].tables[0].password).toBeUndefined();

    const preview = await service.previewDraft(id, null, { ...table, tableName: '草稿' });
    expect(preview.tableName).toBe('草稿');
    expect(preview.rowCount).toBe(3);
    expect(preview.columns.slice(0, 2)).toEqual(['k', 'v']);

    expect(service.relativePathInGroup(id, path.join(dir, 'm', 'a.csv'))).toBe('/m/a.csv');
    expect(() => service!.relativePathInGroup(id, tmpdir())).toThrow();

    await service.deleteTable(id, '合并表');
    expect(service.getState().groups[0].tables).toEqual([]);
    await service.deleteGroup(id);
    expect(service.getState().groups).toEqual([]);
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

    it('connects and reports group / table changes like Java ConfigStorage', async () => {
      service = new CloudConnectionService({
        store: new MemoryCloudConnectionStore(),
        logger,
        agentOptions: { aliveLogIntervalMs: 0 },
      });
      service.importConfigText(yaml(port));
      const id = await service.addGroup({
        sourceName: '我的本地文件',
        directoryPath: dir,
        strategy: 1,
      });
      service.connect();
      await until(() => sync.webhookCalls(HttpEvent.SOURCE_ALL).length > 0);
      await until(() => service!.getState().status === 'connected');
      const state = service.getState();
      expect(state.remoteEnv).toMatchObject({ baseUrl: sync.baseUrl });
      expect(state.connectedAt).toBeTypeOf('number');
      const body = sync.webhookCalls(HttpEvent.SOURCE_ALL)[0].body!;
      expect(body.changeType).toBe('systemStarted');
      expect(
        (body.agentBasicTableList as Array<{ tableName: string }>).map((t) => t.tableName)
      ).toEqual(['list.csv', 'report.xlsx_Data']);

      const singles = () => sync.webhookCalls(HttpEvent.SOURCE_SINGLE).map((c) => c.body!);
      const table = {
        tableName: '合并表',
        strategy: 5,
        fieldStrategy: 0,
        readStrategy: 0,
        appendStrategy: 0,
        relativeFilePath: '/m',
        headerRowNumber: 1,
        sheetStrategy: 0,
        sheetNumber: 1,
        sheetName: 'Sheet1',
      };
      // 新增手动表：表 id 集合变化 → updateSingle
      await service.saveTable(id, null, table);
      expect(singles()).toHaveLength(1);
      expect(singles()[0]).toMatchObject({
        changeType: 'updateSingle',
        sourceName: '我的本地文件',
      });
      expect(
        (singles()[0].agentBasicTableList as Array<{ tableName: string }>).map((t) => t.tableName)
      ).toEqual(['合并表', 'list.csv', 'report.xlsx_Data']);
      // 只改表头行：id 集合不变 → 不上报（LocalClientProxy.updateTables 返回 false）
      await service.saveTable(id, '合并表', { ...table, headerRowNumber: 2 });
      expect(singles()).toHaveLength(1);

      // 新增分组 → addSource
      const sub = path.join(dir, 'm');
      const id2 = await service.addGroup({ sourceName: '子目录', directoryPath: sub, strategy: 1 });
      expect(singles()[1]).toMatchObject({ changeType: 'addSource', sourceName: '子目录' });
      expect((singles()[1].agentBasicTableList as unknown[]).length).toBe(2);
      // 策略变化 → updateSingle
      await service.updateGroup(id2, { sourceName: '子目录', directoryPath: sub, strategy: 0 });
      expect(singles()[2]).toMatchObject({ changeType: 'updateSingle', sourceName: '子目录' });
      expect(singles()[2].agentBasicTableList).toEqual([]);
      // 改名 → 删除旧数据源 + 新增
      await service.updateGroup(id2, { sourceName: '改名', directoryPath: sub, strategy: 1 });
      expect(singles()[3]).toMatchObject({ changeType: 'sourceDelete', sourceName: '子目录' });
      expect(singles()[3].agentBasicTableList).toEqual([]);
      expect(singles()[4]).toMatchObject({ changeType: 'addSource', sourceName: '改名' });
      // 删除分组 → sourceDelete，空表列表
      await service.deleteGroup(id2);
      expect(singles()[5]).toMatchObject({
        changeType: 'sourceDelete',
        sourceName: '改名',
        agentBasicTableList: [],
      });

      service.disconnect();
      expect(service.getState().status).toBe('stopped');
      expect(
        service.getState().activities.some((a) => a.event === 'connectSuccess' && a.type === 'info')
      ).toBe(true);
      expect(logs.join('\n')).not.toContain(TOKEN);
    });
  });
});
