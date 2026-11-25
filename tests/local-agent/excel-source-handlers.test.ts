/**
 * 本地 Excel 数据源在真实 Socket.IO 服务端 + 假 Sync/OSS 下的端到端行为，
 * 校验事件名、负载、ack 和错误格式与 Java 本地宝一致。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { HttpEvent } from '../../src/main/local-agent/constants';
import { LocalExcelSource } from '../../src/main/local-agent/excel/local-excel-source';
import {
  EXCEL_SYNC_STREAM_OPTIONS,
  ExcelSourceHandlers,
  transOutputValue,
} from '../../src/main/local-agent/handlers/excel-source-handlers';
import { LocalAgent } from '../../src/main/local-agent/local-agent';
import { silentLocalAgentLogger } from '../../src/main/local-agent/logger';
import { lz4FrameDecode } from '../../src/main/local-agent/lz4';
import { AgentSyncStatus, type LocalAgentConfig } from '../../src/main/local-agent/types';
import { startMockSyncServer, type MockSyncServer } from './mock-sync-server';

const AGENT_ID = 'c'.repeat(32);
const SOURCE = '九思助理本地文件';

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

const parse = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>;

describe('ExcelSourceHandlers over Socket.IO', () => {
  let dir: string;
  let xlsxPath: string;
  let http: HttpServer;
  let io: IOServer;
  let port: number;
  let sync: MockSyncServer;
  let serverSocket: ServerSocket | null;
  let received: { event: string; payload: Record<string, unknown> }[];
  let cmds: Record<string, unknown>[];
  let agent: LocalAgent | null;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'excel-handlers-'));
    xlsxPath = path.join(dir, 'sales.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['城市', '销量'],
        ['北京', 10],
        ['上海, 浦东', 2.5],
      ]),
      'S1'
    );
    XLSX.writeFile(wb, xlsxPath);
    await writeFile(path.join(dir, 'other.csv'), 'a\n1\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sync = await startMockSyncServer();
    sync.options.omitInternalUrl = true;
    received = [];
    cmds = [];
    serverSocket = null;
    http = createServer();
    io = new IOServer(http, { path: '/gw/socket.io' });
    io.of('/database').on('connection', (socket) => {
      serverSocket = socket;
      socket.onAny((event: string, ...args: unknown[]) => {
        if (event === 'agent_cmd') {
          cmds.push(parse(args[0]));
          const ack = args[args.length - 1];
          if (typeof ack === 'function')
            ack(JSON.stringify({ code: 'ok', data: '[]', errMsg: null }));
          return;
        }
        received.push({ event, payload: parse(args[0]) });
      });
      socket.emit('connectSuccess', JSON.stringify({ baseUrl: sync.baseUrl }));
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    port = (http.address() as AddressInfo).port;
  });

  afterEach(async () => {
    agent?.stop();
    agent = null;
    await new Promise<void>((r) => io.close(() => r()));
    await sync.close();
  });

  const config = (): LocalAgentConfig => ({
    server: {
      agentId: AGENT_ID,
      token: 'tok',
      protocol: 'http',
      host: '127.0.0.1',
      port,
      path: '/gw',
    },
    socketIO: { reconnectionAttempts: 1, reconnectionDelay: 50, timeout: 2000 },
  });

  let logs: string[] = [];
  const captureLogger = {
    ...silentLocalAgentLogger,
    info: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
    warn: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
    error: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
  };

  async function connect(enableSync = true) {
    logs = [];
    const source = new LocalExcelSource({
      sourceName: SOURCE,
      files: [xlsxPath, path.join(dir, 'other.csv')],
    });
    agent = new LocalAgent(config(), {
      version: '4.0',
      logger: silentLocalAgentLogger,
      aliveLogIntervalMs: 0,
      streamOptions: EXCEL_SYNC_STREAM_OPTIONS,
    });
    const events: string[] = [];
    const handlers = new ExcelSourceHandlers(agent, {
      registry: { get: (n) => (n === SOURCE ? source : undefined), all: () => [source] },
      logger: captureLogger,
      enableSync,
      observer: (e) => events.push(`${e.type}:${e.event}`),
    });
    handlers.attach();
    agent.start();
    await until(() => cmds.length > 0 && serverSocket !== null);
    return { source, handlers, events };
  }

  it('reports all tables (systemStarted) then asks cdcTables on connect', async () => {
    await connect();
    const [call] = sync.webhookCalls(HttpEvent.SOURCE_ALL);
    expect(call.body).toEqual({
      agentId: AGENT_ID,
      changeType: 'systemStarted',
      agentBasicTableList: [
        {
          agentId: AGENT_ID,
          sourceName: SOURCE,
          tableName: 'sales.xlsx_S1',
          sourceTable: {
            id: 'sales.xlsx_S1',
            fileName: 'sales.xlsx',
            sheetName: 'S1',
            manual: false,
            type: 'excel',
          },
          jarVersion: '4.0',
          apiLevel: '5',
        },
        {
          agentId: AGENT_ID,
          sourceName: SOURCE,
          tableName: 'other.csv',
          sourceTable: { id: 'other.csv', fileName: 'other.csv', manual: false, type: 'excel' },
          jarVersion: '4.0',
          apiLevel: '5',
        },
      ],
    });
    expect(JSON.stringify(call.body)).not.toContain('tok');
    expect(cmds[0]).toEqual({ cmd: 'cdcTables', data: '""' });
  });

  it('re-reports tables as manualUpdate on `tables`', async () => {
    await connect();
    serverSocket!.emit('tables', 'm-tables');
    await until(() => sync.webhookCalls(HttpEvent.SOURCE_ALL).length >= 2);
    expect(sync.webhookCalls(HttpEvent.SOURCE_ALL)[1].body?.changeType).toBe('manualUpdate');
  });

  it('answers table_structure / table_rowcount / table_content_s3', async () => {
    await connect();
    const bean = { sourceName: SOURCE, tableName: 'sales.xlsx_S1' };
    serverSocket!.emit('table_structure', JSON.stringify(bean), 'm1');
    serverSocket!.emit('table_rowcount', JSON.stringify(bean), 'm2');
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify({ ...bean, rowSize: 100, offset: 0, groupId: 'g' }),
      'm3'
    );
    await until(() => received.length >= 3);
    const by = (e: string) => received.find((r) => r.event === e)!.payload;
    expect(by('table_structure_result')).toEqual({
      messageId: 'm1',
      error: false,
      hasNext: false,
      tableColumns: ['城市', '销量', '文件夹名(系统字段)', '表名(系统字段)', 'sheet名(系统字段)'],
      tableColumnTypes: [6, 5, 6, 6, 6],
      skipSync: false,
    });
    expect(by('table_rowcount_result')).toEqual({
      messageId: 'm2',
      error: false,
      hasNext: false,
      sourceName: SOURCE,
      tableName: 'sales.xlsx_S1',
      rowCount: 2,
    });
    const preview = by('table_content_s3_result');
    expect(preview).toMatchObject({ messageId: 'm3', error: false, hasNext: false });
    expect(preview.data).toEqual([
      ['北京', '10', path.basename(dir), 'sales.xlsx', 'S1'],
      ['上海, 浦东', '2.5', path.basename(dir), 'sales.xlsx', 'S1'],
    ]);
  });

  // 云端预览请求的真实形状：Java FetchBean 字段（Jackson 反序列化），预览由 rowSize > 0 决定，
  // 没有 preview 字段（FetchBean.isPreview() 是 @JsonIgnore 的派生值）。
  const javaPreviewBean = (tableName: string, extra: Record<string, unknown> = {}) => ({
    tableName,
    sourceName: SOURCE,
    queryTimout: 180000,
    rowSize: 100,
    offset: 0,
    sourceTableId: 'st-1',
    forceOverwrite: false,
    update: false,
    ...extra,
  });

  it('regression: Java-shaped preview (rowSize>0, no preview flag) answers over socket, no OSS', async () => {
    const { events } = await connect();
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify(javaPreviewBean('sales.xlsx_S1')),
      '34f6e6cb080d4b8d'
    );
    await until(() => received.some((r) => r.event === 'table_content_s3_result'));
    const dirName = path.basename(dir);
    const payload = received.find((r) => r.event === 'table_content_s3_result')!.payload;
    // S3SourceData 经 Jackson(NON_NULL) toMap 后的完整形状
    expect(payload).toEqual({
      messageId: '34f6e6cb080d4b8d',
      error: false,
      hasNext: false,
      sourceName: SOURCE,
      tableName: 'sales.xlsx_S1',
      type: 0,
      skipSync: false,
      meta: {
        messageId: '34f6e6cb080d4b8d',
        error: false,
        hasNext: false,
        tableColumns: ['城市', '销量', '文件夹名(系统字段)', '表名(系统字段)', 'sheet名(系统字段)'],
        tableColumnTypes: [6, 5, 6, 6, 6],
        skipSync: false,
      },
      data: [
        ['北京', '10', dirName, 'sales.xlsx', 'S1'],
        ['上海, 浦东', '2.5', dirName, 'sales.xlsx', 'S1'],
      ],
    });
    expect(received.filter((r) => r.event === 'table_content_s3_result')).toHaveLength(1);
    // 预览走 socket（S3DataSyncStream preview 分支），不申请预签名、不上传、不上报状态
    expect(sync.calls.filter((c) => c.path !== `/sync${HttpEvent.SOURCE_ALL}`)).toEqual([]);
    expect(events).not.toContain(`error:table_content_s3_result`);
  });

  it('regression: rowSize 0 / legacy preview flag is not a preview (Java ignores it) → no reply', async () => {
    await connect();
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify(javaPreviewBean('sales.xlsx_S1', { rowSize: 0 })),
      'n1'
    );
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify({ sourceName: SOURCE, tableName: 'sales.xlsx_S1', preview: true }),
      'n2'
    );
    serverSocket!.emit('table_rowcount', JSON.stringify(javaPreviewBean('sales.xlsx_S1')), 'n3');
    await until(() => received.some((r) => r.event === 'table_rowcount_result'));
    await new Promise((r) => setTimeout(r, 100));
    expect(received.filter((r) => r.event === 'table_content_s3_result')).toEqual([]);
  });

  it('regression: preview read error → ofError then the (empty) source, like Java flowRead + close', async () => {
    await connect();
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify(javaPreviewBean('missing.xlsx_S1')),
      'p-err'
    );
    await until(() => received.filter((r) => r.event === 'table_content_s3_result').length >= 2);
    const [first, second] = received
      .filter((r) => r.event === 'table_content_s3_result')
      .map((r) => r.payload);
    expect(first).toEqual({
      messageId: 'p-err',
      error: true,
      errorMessage: 'can not found table missing.xlsx_S1',
      hasNext: false,
    });
    expect(second).toMatchObject({
      messageId: 'p-err',
      error: false,
      hasNext: false,
      tableName: 'missing.xlsx_S1',
      data: [],
    });
    expect(second.meta).toBeUndefined();
  });

  it('regression: server preview flow = table_rowcount then table_content_s3 (Java FetchBean payloads)', async () => {
    await connect();
    // 与用户日志一致：先 rowCount，约 3 秒后 table_content_s3（这里不等待）
    const rowcountBean = {
      tableName: 'sales.xlsx_S1',
      sourceName: SOURCE,
      queryTimout: 180000,
      rowSize: 0,
      offset: 0,
      forceOverwrite: false,
      update: false,
    };
    serverSocket!.emit('table_rowcount', JSON.stringify(rowcountBean), '810430d4a93246d1');
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify(javaPreviewBean('sales.xlsx_S1')),
      '8bf9ac9531bc406a'
    );
    await until(
      () =>
        received.some((r) => r.event === 'table_rowcount_result') &&
        received.some((r) => r.event === 'table_content_s3_result')
    );
    // TableRowCountBean（Message + sourceName/tableName/rowCount），Jackson NON_NULL
    expect(received.find((r) => r.event === 'table_rowcount_result')!.payload).toEqual({
      messageId: '810430d4a93246d1',
      error: false,
      hasNext: false,
      sourceName: SOURCE,
      tableName: 'sales.xlsx_S1',
      rowCount: 2,
    });
    const preview = received.find((r) => r.event === 'table_content_s3_result')!.payload;
    expect(preview).toMatchObject({ messageId: '8bf9ac9531bc406a', error: false, hasNext: false });
    expect((preview.data as unknown[]).length).toBe(2);
    // 日志里能看到 rowSize（判定预览的唯一字段）
    expect(logs.some((l) => l.includes('rowSize: 100') && l.includes('8bf9ac9531bc406a'))).toBe(
      true
    );
    expect(logs.join('\n')).not.toContain('only support preview');
  });

  it('logs the raw payload keys when a table_content_s3 request is not a preview', async () => {
    await connect();
    serverSocket!.emit(
      'table_content_s3',
      JSON.stringify({ tableName: 'sales.xlsx_S1', sourceName: SOURCE, preview: true, limit: 100 }),
      'k1'
    );
    await until(() => logs.some((l) => l.includes('only support preview')));
    const line = logs.find((l) => l.includes('only support preview'))!;
    expect(line).toContain('rowSize=undefined');
    expect(line).toContain('payload keys: tableName,sourceName,preview,limit');
  });

  it('table_cdc_info / cdc_switch: checkSource error for unknown sources, silent for the Excel source', async () => {
    await connect();
    serverSocket!.emit(
      'table_cdc_info',
      JSON.stringify({ sourceName: 'nope', tableName: 't' }),
      'c1'
    );
    serverSocket!.emit('cdc_switch', JSON.stringify({ sourceName: 'nope', tableName: 't' }), 'c2');
    serverSocket!.emit(
      'table_cdc_info',
      JSON.stringify({ sourceName: SOURCE, tableName: 't' }),
      'c3'
    );
    serverSocket!.emit('cdc_switch', JSON.stringify({ sourceName: SOURCE, tableName: 't' }), 'c4');
    await until(() => received.filter((r) => r.event === 'table_content_result').length >= 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(
      received.filter((r) => r.event === 'table_content_result').map((r) => r.payload)
    ).toEqual([
      {
        messageId: 'c1',
        error: true,
        errorMessage: 'sourceName: nope is not exists',
        hasNext: false,
      },
      {
        messageId: 'c2',
        error: true,
        errorMessage: 'sourceName: nope is not exists',
        hasNext: false,
      },
    ]);
    expect(received.some((r) => r.event === 'cdc_switch_result')).toBe(false);
    expect(logs.some((l) => l.includes('not Cdcable'))).toBe(true);
  });

  it('connection_dialect_metadata: NON_JDBC / SOURCE_NOT_FOUND / INTERNAL like Java', async () => {
    await connect();
    serverSocket!.emit('connection_dialect_metadata', JSON.stringify({ sourceName: SOURCE }), 'd1');
    serverSocket!.emit('connection_dialect_metadata', JSON.stringify({ sourceName: 'nope' }), 'd2');
    serverSocket!.emit('connection_dialect_metadata', '{not json', 'd3');
    await until(
      () => received.filter((r) => r.event === 'connection_dialect_metadata_result').length >= 3
    );
    const by = (id: string) =>
      received.find(
        (r) => r.event === 'connection_dialect_metadata_result' && r.payload.messageId === id
      )!.payload;
    expect(by('d1')).toEqual({
      messageId: 'd1',
      error: true,
      errorMessage: 'DIALECT_METADATA_ERROR:NON_JDBC',
      hasNext: false,
    });
    expect(by('d2').errorMessage).toBe('DIALECT_METADATA_ERROR:SOURCE_NOT_FOUND');
    expect(by('d3').errorMessage).toBe('DIALECT_METADATA_ERROR:INTERNAL');
  });

  it('returns Java checkSource errors for unknown sources', async () => {
    await connect();
    const bean = { sourceName: 'nope', tableName: 't' };
    serverSocket!.emit('table_structure', JSON.stringify(bean), 'e1');
    serverSocket!.emit('table_content_s3', JSON.stringify({ ...bean, rowSize: 100 }), 'e2');
    await until(() => received.length >= 2);
    const error = { error: true, errorMessage: 'sourceName: nope is not exists', hasNext: false };
    expect(received.find((r) => r.event === 'table_content_result')!.payload).toEqual({
      messageId: 'e1',
      ...error,
    });
    expect(received.find((r) => r.event === 'table_content_s3_result')!.payload).toEqual({
      messageId: 'e2',
      ...error,
    });
  });

  it('dispatch uploads CSV + LZ4 parts and reports UPLOAD_SUCCESS', async () => {
    await connect();
    serverSocket!.emit(
      'table_content_s3_dispatch',
      JSON.stringify({
        sourceName: SOURCE,
        tableName: 'sales.xlsx_S1',
        groupId: 'g1',
        path: 'tables/sales.csv.lz4',
        uploadId: 'up-1',
      }),
      'd1'
    );
    await until(() => sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).length >= 2);
    const statuses = sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).map((c) => c.body);
    expect(statuses[0]).toMatchObject({ syncStatus: AgentSyncStatus.START_SYNC, messageId: 'd1' });
    expect(statuses[1]).toMatchObject({
      syncStatus: AgentSyncStatus.UPLOAD_SUCCESS,
      path: 'tables/sales.csv.lz4',
      tableColumns: ['城市', '销量', '文件夹名(系统字段)', '表名(系统字段)', 'sheet名(系统字段)'],
    });
    const part = sync.parts.get('tables/sales.csv.lz4#1')!;
    expect(part.readUInt32LE(0)).toBe(0x184d2204);
    const dirName = path.basename(dir);
    expect(Buffer.from(lz4FrameDecode(part)).toString('utf8')).toBe(
      `北京,10,${dirName},sales.xlsx,S1\r\n"上海, 浦东",2.5,${dirName},sales.xlsx,S1\r\n`
    );
  });

  it('does not upload when sync is disabled (dispatch → UPLOAD_FAILED datasource not found)', async () => {
    await connect(false);
    serverSocket!.emit(
      'table_content_s3_dispatch',
      JSON.stringify({ sourceName: SOURCE, tableName: 'sales.xlsx_S1', path: 'p', uploadId: 'u' }),
      'd2'
    );
    await until(() => sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS).length >= 2);
    expect(sync.parts.size).toBe(0);
    expect(sync.webhookCalls(HttpEvent.S3_NOTIFY_SYNC_STATUS)[1].body?.syncStatus).toBe(
      AgentSyncStatus.UPLOAD_FAILED
    );
  });
});

describe('transOutputValue (Java DataStream.trans2OutputType)', () => {
  it('trims ≤ U+0020, blanks values over 10000 chars, keeps null', () => {
    expect(transOutputValue('  a b\t')).toBe('a b');
    expect(transOutputValue('\u3000x\u3000')).toBe('\u3000x\u3000');
    expect(transOutputValue(' ' + 'x'.repeat(10000) + ' ')).toBe('x'.repeat(10000));
    expect(transOutputValue('x'.repeat(10001))).toBe('');
    expect(transOutputValue(null)).toBeNull();
  });
});
