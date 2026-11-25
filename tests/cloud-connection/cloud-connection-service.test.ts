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

function memoryTables(
  records: Array<{ id: string; name: string; kind?: 'raw' | 'result'; materialized?: boolean }>
) {
  const raws = new Map(records.filter((r) => r.kind !== 'result').map((r) => [r.id, r]));
  const results = new Map(records.filter((r) => r.kind === 'result').map((r) => [r.id, r]));
  const describe = async (kind: 'raw' | 'result', id: string) => {
    const rec = kind === 'result' ? results.get(id) : raws.get(id);
    if (!rec) throw new Error('missing');
    const materialized = rec.materialized !== false;
    return {
      materialized,
      name: rec.name,
      tableName: `tbl_${id}`,
      updatedAt: 1,
      columns: materialized ? ['a'] : [],
      columnTypes: materialized
        ? [{ name: 'a', type: 'text' as const, storageType: 'VARCHAR' }]
        : [],
      rowCount: materialized ? 1 : 0,
    };
  };
  return {
    _raws: raws,
    importRawTable: async (input: { name?: string; filePath: string }) => {
      const id = `imp-${input.filePath}`;
      const rec = { id, name: input.name || id };
      raws.set(id, rec);
      return {
        id,
        name: rec.name,
        groupId: null,
        sourcePath: input.filePath,
        sourceKind: 'excel' as const,
        inputConfig: {
          sourceKind: 'excel' as const,
          sheetName: 'Sheet1',
          sheetNames: ['Sheet1'],
          headerMode: 'auto' as const,
          headerRow: 1,
        },
        fileCount: 1,
        relatedPipelineNames: [],
        tableName: `tbl_${id}`,
        rowCount: 1,
        columnCount: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    },
    getRawTableRecord: async (id: string) => {
      const rec = raws.get(id);
      if (!rec) return null;
      return {
        id: rec.id,
        name: rec.name,
        groupId: null,
        sourcePath: '/x',
        sourceKind: 'excel' as const,
        inputConfig: {
          sourceKind: 'excel' as const,
          sheetName: 'Sheet1',
          sheetNames: ['Sheet1'],
          headerMode: 'auto' as const,
          headerRow: 1,
        },
        fileCount: 1,
        relatedPipelineNames: [],
        tableName: `tbl_${id}`,
        rowCount: 1,
        columnCount: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    },
    getResultTableRecord: async (id: string) => {
      const rec = results.get(id);
      if (!rec) return null;
      return {
        id: rec.id,
        name: rec.name,
        groupId: null,
        sourceRawTableId: null,
        tableName: `tbl_${id}`,
        rowCount: rec.materialized === false ? 0 : 1,
        columnCount: rec.materialized === false ? 0 : 1,
        relatedPipelineNames: [],
        relatedPipelineIds: [],
        createdAt: 1,
        updatedAt: 1,
      };
    },
    describeBoundTable: describe,
    previewBoundTable: async (kind: 'raw' | 'result', id: string) => {
      const snap = await describe(kind, id);
      return { ...snap, rows: snap.materialized ? [{ a: '1' }] : [] };
    },
    iterateBoundTableRows: async (
      kind: 'raw' | 'result',
      id: string,
      writeRow: (row: (string | null)[]) => Promise<void>
    ) => {
      const snap = await describe(kind, id);
      if (snap.materialized) await writeRow(['1']);
      return { columns: snap.columns, rowCount: snap.rowCount, materialized: snap.materialized };
    },
    refreshRawTableIfSourceChanged: async () => undefined,
  };
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
    expect(data.schemaVersion).toBe(2);
    expect(data.groups).toEqual([
      expect.objectContaining({
        sourceName: '我的本地文件',
        tables: [],
        files: [xlsxPath, csvPath],
      }),
    ]);
    expect(data.versions).toEqual({ 我的本地文件: { 'report.xlsx_Data': legacyVersion } });
    // 旧字段保留，便于回退
    expect(data.files).toEqual([xlsxPath, csvPath]);
    await service.refreshTables();
    expect(service.getState().groups[0].tables).toEqual([]);
    const again = new CloudConnectionService({ store, logger });
    expect(again.getState().groups).toHaveLength(1);
  });

  it('migration of an empty v1 store creates no group', () => {
    const store = new MemoryCloudConnectionStore({ sourceName: 'x', files: [] } as never);
    service = new CloudConnectionService({ store, logger });
    expect(store.read().groups).toEqual([]);
    expect(store.read().schemaVersion).toBe(2);
  });

  it('manages logical groups and table references', async () => {
    const tableStore = memoryTables([
      { id: 'raw-1', name: '销售' },
      { id: 'raw-2', name: '订单' },
      { id: 'out-1', name: '汇总', kind: 'result', materialized: false },
    ]);
    const store = new MemoryCloudConnectionStore();
    service = new CloudConnectionService({ store, logger, tableStore });
    await expect(service.addGroup({ sourceName: 'a&b' })).rejects.toThrow('分组名称不能出现&');
    await expect(service.addGroup({ sourceName: ' ' })).rejects.toThrow('分组名不能为空');
    const id = await service.addGroup({ sourceName: '本地' });
    await expect(service.addGroup({ sourceName: '本地' })).rejects.toThrow('分组名称请勿重复');
    await expect(service.updateGroup(id, { sourceName: '别的名字' })).rejects.toThrow(
      '分组名称仅创建时可配置，保存后无法修改'
    );
    expect(service.getState().groups[0].sourceName).toBe('本地');

    await service.addTableRefs(id, [{ kind: 'raw', tableId: 'raw-1' }]);
    let group = service.getState().groups[0];
    expect(group.tables).toEqual([
      expect.objectContaining({
        reportName: '销售',
        kind: 'raw',
        tableId: 'raw-1',
        status: 'ok',
      }),
    ]);
    await expect(
      service.addTableRefs(id, [{ kind: 'raw', tableId: 'raw-2', reportName: '销售' }])
    ).rejects.toThrow('表名请勿重复');
    await service.addTableRefs(id, [{ kind: 'result', tableId: 'out-1' }]);
    group = service.getState().groups[0];
    expect(group.tables.map((tb) => [tb.reportName, tb.status])).toEqual([
      ['销售', 'ok'],
      ['汇总', 'unmaterialized'],
    ]);

    await service.updateTableRef(id, '销售', { reportName: '销售上报' });
    expect(service.getState().groups[0].tables[0].reportName).toBe('销售上报');
    const stored = (tableStore as { _raws: Map<string, { name: string }> })._raws.get('raw-1');
    if (stored) stored.name = '销售改名';
    await service.refreshTables(id);
    expect(service.getState().groups[0].tables[0]).toMatchObject({
      reportName: '销售上报',
      displayName: '销售改名',
    });

    const preview = await service.previewTable(id, '销售上报');
    expect(preview.tableName).toBe('销售上报');
    expect(preview.columns).toEqual(['a']);
    expect(preview.rowCount).toBe(1);

    await service.deleteTable(id, '销售上报');
    expect(service.getState().groups[0].tables.map((tb) => tb.reportName)).toEqual(['汇总']);
    await service.deleteGroup(id);
    expect(service.getState().groups).toEqual([]);
  });

  it('migrates a legacy manual table into a raw-table reference and keeps the report name', async () => {
    const tableStore = memoryTables([]);
    const store = new MemoryCloudConnectionStore({
      schemaVersion: 2,
      groups: [
        {
          id: 'g1',
          sourceName: '本地',
          directoryPath: dir,
          strategy: 0,
          tables: [
            {
              tableName: '合并表',
              strategy: 5,
              fieldStrategy: 0,
              readStrategy: 0,
              appendStrategy: 1,
              relativeFilePath: '/m',
              headerRowNumber: 1,
              sheetStrategy: 0,
              sheetNumber: 1,
              sheetName: 'Sheet1',
            },
          ],
        },
      ],
    } as never);
    service = new CloudConnectionService({ store, logger, tableStore });
    await service.migrateLegacyGroups();
    const group = service.getState().groups[0];
    expect(group.tables).toEqual([
      expect.objectContaining({ reportName: '合并表', kind: 'raw', status: 'ok' }),
    ]);
    expect(store.read().groups[0].legacyTables).toBeUndefined();
    expect(store.read().schemaVersion).toBe(CLOUD_CONNECTION_SCHEMA_VERSION);
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
      const tableStore = memoryTables([
        { id: 'raw-1', name: '销售' },
        { id: 'raw-2', name: '订单' },
      ]);
      service = new CloudConnectionService({
        store: new MemoryCloudConnectionStore(),
        logger,
        agentOptions: { aliveLogIntervalMs: 0 },
        tableStore,
      });
      service.importConfigText(yaml(port));
      const id = await service.addGroup({ sourceName: '我的本地文件' });
      await service.addTableRefs(id, [{ kind: 'raw', tableId: 'raw-1' }]);
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
      ).toEqual(['销售']);

      const singles = () => sync.webhookCalls(HttpEvent.SOURCE_SINGLE).map((c) => c.body!);
      await service.addTableRefs(id, [{ kind: 'raw', tableId: 'raw-2' }]);
      expect(singles()).toHaveLength(1);
      expect(singles()[0]).toMatchObject({
        changeType: 'updateSingle',
        sourceName: '我的本地文件',
      });
      expect(
        (singles()[0].agentBasicTableList as Array<{ tableName: string }>).map((t) => t.tableName)
      ).toEqual(['销售', '订单']);
      await service.refreshTables(id);
      expect(singles()).toHaveLength(1);

      const id2 = await service.addGroup({ sourceName: '子目录' });
      expect(singles()[1]).toMatchObject({ changeType: 'addSource', sourceName: '子目录' });
      expect((singles()[1].agentBasicTableList as unknown[]).length).toBe(0);
      const reported = singles().length;
      await expect(service.updateGroup(id2, { sourceName: '改名' })).rejects.toThrow(
        '分组名称仅创建时可配置，保存后无法修改'
      );
      expect(service.getState().groups.find((g) => g.id === id2)?.sourceName).toBe('子目录');
      expect(singles()).toHaveLength(reported);
      await service.deleteGroup(id2);
      expect(singles()[reported]).toMatchObject({
        changeType: 'sourceDelete',
        sourceName: '子目录',
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
