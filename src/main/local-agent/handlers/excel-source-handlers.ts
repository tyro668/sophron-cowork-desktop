/**
 * 本地 Excel 数据源的云端事件处理，对应 Java：
 *   - `DatasourceInitializer.onSocketConnectSuccess`：连接成功后 POST `/webhook/agent/source/all`
 *     （changeType=systemStarted）上报全部表，然后 `agent_cmd` 查询 `cdcTables`；
 *   - `TablesHandler`（tables → manualUpdate 重新上报）；
 *   - `TableStructureHandler`（table_structure → table_structure_result）；
 *   - `TableRowCountHandler`（table_rowcount → table_rowcount_result）；
 *   - `TableContentS3Handler`（table_content_s3 预览 → table_content_s3_result）；
 *   - `table_content_s3_dispatch` 的取数实现（FullDataReader → CSV + LZ4 → 分片上传）。
 */
import { HttpEvent, ReceiveEvent, SendEvent } from '../constants';
import { lz4FrameEncoderFactory } from '../lz4';
import type { LocalAgent } from '../local-agent';
import type { LocalAgentLogger } from '../logger';
import { encodeCsvRow, type S3UploadStreamOptions } from '../s3/s3-upload-stream';
import { errorMessage } from '../transport/agent-socket';
import type { SocketTaskContext } from '../transport/event-dispatcher';
import { isPreviewFetch, WriteType, type FetchBean } from '../types';
import { createS3SourceData, parseFetchBean } from './table-content-s3-dispatch';
import { toSourceTableJson, type LocalExcelSource } from '../excel/local-excel-source';
import type { ExcelMetaPayload } from '../excel/analyzer';
import { javaTrim } from '../excel/field-type';

/** Java `FetchType`。 */
export const FetchType = {
  STARTED: 'systemStarted',
  UPDATE_SINGLE: 'updateSingle',
  MANUAL_UPDATE: 'manualUpdate',
  ADD_SOURCE: 'addSource',
  SOURCE_DELETE: 'sourceDelete',
  LOCAL_WEB_ALL: 'localWebAll',
} as const;

/** Java `AgentCmdType.CDC_TABLES`。 */
export const AGENT_CMD_CDC_TABLES = 'cdcTables';

export interface LocalSourceRegistry {
  get(sourceName: string): LocalExcelSource | undefined;
  all(): LocalExcelSource[];
}

export interface AgentBasicTable {
  agentId: string;
  sourceName: string;
  tableName: string;
  sourceTable: Record<string, unknown>;
  jarVersion: string;
  apiLevel: string;
}

export interface AllSourcesRequest {
  agentId: string;
  changeType: string;
  agentBasicTableList: AgentBasicTable[];
}

/** 云端请求的观察钩子（UI 状态 / 冒烟测试日志用）。 */
export type ExcelSourceObserver = (event: {
  type: 'request' | 'response' | 'error' | 'info';
  event: string;
  messageId?: string;
  sourceName?: string;
  tableName?: string;
  detail?: string;
}) => void;

export interface ExcelSourceHandlerOptions {
  registry: LocalSourceRegistry;
  logger: LocalAgentLogger;
  observer?: ExcelSourceObserver;
  /** 只响应这些 sourceName（冒烟测试只响应样例文件），默认全部。 */
  allowSource?: (sourceName: string) => boolean;
  /** 是否在连接成功后查询 cdcTables（Java 默认会）。 */
  queryCdcOnConnect?: boolean;
  /** 是否注册 table_content_s3_dispatch 取数实现（真正上传数据），默认 true。 */
  enableSync?: boolean;
  /**
   * 不在 allowSource 范围内的请求直接忽略、不回错误（冒烟测试用，避免替其它数据源应答）。
   * 默认 false：与 Java 一致回 `sourceName: X is not exists`。
   */
  ignoreDisallowedSources?: boolean;
}

export async function buildAllSourcesRequest(
  agent: Pick<LocalAgent, 'config' | 'version' | 'apiLevel'>,
  sources: LocalExcelSource[],
  changeType: string,
  logger?: LocalAgentLogger
): Promise<AllSourcesRequest> {
  const agentId = agent.config.server.agentId;
  const list: AgentBasicTable[] = [];
  for (const source of sources) {
    const errors = new Map<string, string>();
    const tables = await source.listTables(errors);
    for (const [file, message] of errors) logger?.warn(`skip file ${file}: ${message}`);
    for (const table of tables) {
      list.push({
        agentId,
        sourceName: source.sourceName,
        tableName: table.id,
        sourceTable: toSourceTableJson(table),
        jarVersion: agent.version,
        apiLevel: agent.apiLevel,
      });
    }
  }
  return { agentId, changeType, agentBasicTableList: list };
}

function fetchBeanOf(ctx: SocketTaskContext): FetchBean {
  return parseFetchBean(ctx.payload);
}

const MAX_STRING_LENGTH = 10000;

/** Java `DataStream.trans2OutputType`（字符串部分）：trim，超过 10000 字符置空。 */
export function transOutputValue(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = javaTrim(value);
  return trimmed.length > MAX_STRING_LENGTH ? '' : trimmed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExcelSourceHandlers {
  private readonly logger: LocalAgentLogger;

  constructor(
    private readonly agent: LocalAgent,
    private readonly options: ExcelSourceHandlerOptions
  ) {
    this.logger = options.logger;
  }

  /** 注册事件处理器与连接成功钩子。 */
  attach(): void {
    const { agent } = this;
    agent.onTask(ReceiveEvent.QUERY_ALL_TABLES, (ctx) => this.onTables(ctx));
    agent.onTask(ReceiveEvent.QUERY_STRUCTURE_OF_TABLE, (ctx) => this.onStructure(ctx));
    agent.onTask(ReceiveEvent.QUERY_ROWCOUNT_OF_TABLE, (ctx) => this.onRowCount(ctx));
    agent.onTask(ReceiveEvent.QUERY_CONTENT_OF_TABLE_S3, (ctx) => this.onPreview(ctx));
    agent.onTask(ReceiveEvent.QUERY_CDC_OF_TABLE, (ctx) => this.onCdcSync(ctx));
    agent.onTask(ReceiveEvent.CDC_SWITCH, (ctx) => this.onCdcSwitch(ctx));
    agent.onTask(ReceiveEvent.QUERY_CONNECTION_DIALECT_METADATA, (ctx) =>
      this.onConnectionMetadata(ctx)
    );
    if (this.options.enableSync !== false) {
      for (const source of this.options.registry.all()) this.registerProvider(source);
    }
    agent.on('connectSuccess', () => {
      void this.onConnectSuccess();
    });
  }

  registerProvider(source: LocalExcelSource): void {
    if (this.options.enableSync === false) return;
    this.agent.registerTableContentProvider(
      source.sourceName,
      async ({ fetchBean, source: s3, stream }) => {
        this.observe('request', ReceiveEvent.QUERY_CONTENT_OF_TABLE_S3_DISPATCH, fetchBean);
        const excel = this.options.registry.get(fetchBean.sourceName);
        if (!excel || !this.allowed(fetchBean.sourceName)) {
          throw new Error(`sourceName: ${fetchBean.sourceName} is not exists`);
        }
        const table = await excel.getTable(fetchBean.tableName);
        if (!table) throw new Error(`can not found table ${fetchBean.tableName}`);
        const meta = await excel.queryMeta(table, fetchBean.messageId);
        s3.meta = meta;
        fetchBean.tableMeta = meta;
        s3.type = WriteType.OVERWRITE;
        const rows = await excel.writeFullData(table, meta.tableColumns!.length, (row) =>
          stream.writeRow(row.map(transOutputValue))
        );
        this.observe(
          'response',
          ReceiveEvent.QUERY_CONTENT_OF_TABLE_S3_DISPATCH,
          fetchBean,
          `rows=${rows}`
        );
      }
    );
  }

  unregisterProvider(sourceName: string): void {
    this.agent.unregisterTableContentProvider(sourceName);
  }

  private allowed(sourceName: string): boolean {
    return this.options.allowSource ? this.options.allowSource(sourceName) : true;
  }

  private observe(
    type: 'request' | 'response' | 'error' | 'info',
    event: string,
    bean?: Partial<FetchBean>,
    detail?: string
  ): void {
    this.options.observer?.({
      type,
      event,
      messageId: bean?.messageId,
      sourceName: bean?.sourceName,
      tableName: bean?.tableName,
      detail,
    });
  }

  private sources(): LocalExcelSource[] {
    return this.options.registry.all().filter((s) => this.allowed(s.sourceName));
  }

  /** `fetchAllTables` → POST source/all。返回云端响应文本。 */
  async reportAllTables(changeType: string, messageId?: string): Promise<string> {
    const request = await buildAllSourcesRequest(
      this.agent,
      this.sources(),
      changeType,
      this.logger
    );
    this.logger.info(
      `report tables, changeType: ${changeType}, tables: ${request.agentBasicTableList.length}, messageId: ${messageId ?? ''}`
    );
    this.observe(
      'request',
      HttpEvent.SOURCE_ALL,
      { messageId },
      `${changeType} tables=${request.agentBasicTableList.length}`
    );
    const response = await this.agent.httpSender.blockSendWithFallback(
      HttpEvent.SOURCE_ALL,
      request
    );
    this.observe(
      'response',
      HttpEvent.SOURCE_ALL,
      { messageId },
      `HTTP ${this.agent.httpSender.lastStatus ?? '?'} ${response.slice(0, 500)}`.trim()
    );
    return response;
  }

  /**
   * `fetchSingleTables` → POST source/single（数据源配置变化时，Java 用 updateSingle /
   * addSource / sourceDelete）。
   */
  async reportSingleSource(source: LocalExcelSource, changeType: string): Promise<string> {
    const all = await buildAllSourcesRequest(this.agent, [source], changeType, this.logger);
    const request = {
      agentId: all.agentId,
      changeType,
      sourceName: source.sourceName,
      agentBasicTableList: all.agentBasicTableList,
    };
    this.observe(
      'request',
      HttpEvent.SOURCE_SINGLE,
      undefined,
      `${changeType} tables=${request.agentBasicTableList.length}`
    );
    const response = await this.agent.httpSender.blockSendWithFallback(
      HttpEvent.SOURCE_SINGLE,
      request
    );
    this.observe(
      'response',
      HttpEvent.SOURCE_SINGLE,
      undefined,
      `HTTP ${this.agent.httpSender.lastStatus ?? '?'} ${response.slice(0, 500)}`.trim()
    );
    return response;
  }

  async onConnectSuccess(): Promise<void> {
    try {
      await this.reportAllTables(FetchType.STARTED);
    } catch (error) {
      this.logger.error('source tables send error', error);
      this.observe('error', HttpEvent.SOURCE_ALL, undefined, messageOf(error));
    }
    if (this.options.queryCdcOnConnect !== false) {
      try {
        const result = await this.agent.socketSender.blockSend(
          SendEvent.CMD,
          { cmd: AGENT_CMD_CDC_TABLES, data: JSON.stringify('') },
          30_000
        );
        this.observe(
          'response',
          SendEvent.CMD,
          undefined,
          `cdcTables ack: ${result.slice(0, 300)}`
        );
      } catch (error) {
        this.logger.warn(`agent_cmd cdcTables failed: ${messageOf(error)}`);
        this.observe('error', SendEvent.CMD, undefined, messageOf(error));
      }
    }
  }

  private async onTables(ctx: SocketTaskContext): Promise<void> {
    this.logger.info(`trigger tables update, messageId: ${ctx.messageId}`);
    this.observe('request', ReceiveEvent.QUERY_ALL_TABLES, { messageId: ctx.messageId });
    try {
      await this.reportAllTables(FetchType.MANUAL_UPDATE, ctx.messageId);
    } catch (error) {
      this.logger.error(`source tables send error, messageId:${ctx.messageId}`, error);
      this.observe(
        'error',
        ReceiveEvent.QUERY_ALL_TABLES,
        { messageId: ctx.messageId },
        messageOf(error)
      );
    }
  }

  /** `Preconditions.checkSource`：数据源不存在时按 Java 原样回错误（事件名沿用 Java 的写法）。 */
  private checkSource(
    bean: FetchBean,
    messageId: string,
    event: string
  ): LocalExcelSource | undefined {
    const allowed = this.allowed(bean.sourceName);
    if (!allowed && this.options.ignoreDisallowedSources) {
      this.logger.info(`ignore request for source ${bean.sourceName}, messageId: ${messageId}`);
      this.observe('info', event, { ...bean, messageId }, 'ignored (source not allowed)');
      return undefined;
    }
    const source = allowed ? this.options.registry.get(bean.sourceName) : undefined;
    if (!source) {
      const msg = `sourceName: ${bean.sourceName} is not exists`;
      this.agent.socketSender.send(event, errorMessage(messageId, msg));
      this.logger.error(msg);
      this.observe('error', event, { ...bean, messageId }, msg);
    }
    return source;
  }

  private async onStructure(ctx: SocketTaskContext): Promise<void> {
    const bean = fetchBeanOf(ctx);
    this.logger.info(
      `start fetch table structure, table: ${bean.tableName}, messageId: ${ctx.messageId}`
    );
    this.observe('request', ReceiveEvent.QUERY_STRUCTURE_OF_TABLE, {
      ...bean,
      messageId: ctx.messageId,
    });
    const source = this.checkSource(bean, ctx.messageId, SendEvent.SEND_CONTENT_OF_TABLE);
    if (!source) return;
    const event = SendEvent.SEND_STRUCTURE_OF_TABLE;
    try {
      const table = await source.getTable(bean.tableName);
      if (!table) throw new Error(`can not found table ${bean.tableName}`);
      const meta: ExcelMetaPayload = await source.queryStructure(table, bean, ctx.messageId);
      this.agent.socketSender.send(event, meta);
      this.observe(
        'response',
        event,
        { ...bean, messageId: ctx.messageId },
        meta.skipSync ? 'skipSync' : `columns=${meta.tableColumns?.length ?? 0}`
      );
    } catch (error) {
      this.readError(bean, ctx.messageId, event, error);
    }
  }

  /** `AbstractExcelTableReader.flowRead` 的异常处理：预览请求回错误消息，否则只记录。 */
  private readError(bean: FetchBean, messageId: string, event: string, error: unknown): void {
    this.logger.error(`${bean.tableName} read error`, error);
    this.observe('error', event, { ...bean, messageId }, messageOf(error));
    if (isPreviewFetch(bean))
      this.agent.socketSender.send(event, errorMessage(messageId, messageOf(error)));
  }

  private async onRowCount(ctx: SocketTaskContext): Promise<void> {
    const bean = fetchBeanOf(ctx);
    this.logger.info(
      `start fetch table rowCount, table: ${bean.tableName}, messageId: ${ctx.messageId}`
    );
    this.observe('request', ReceiveEvent.QUERY_ROWCOUNT_OF_TABLE, {
      ...bean,
      messageId: ctx.messageId,
    });
    const source = this.checkSource(bean, ctx.messageId, SendEvent.SEND_CONTENT_OF_TABLE);
    if (!source) return;
    const event = SendEvent.SEND_ROWCOUNT_OF_TABLE;
    const work = (async () => {
      const table = await source.getTable(bean.tableName);
      if (!table) throw new Error(`can not found table ${bean.tableName}`);
      const rowCount = await source.rowCount(table);
      return { table, rowCount };
    })();
    const timeoutMs = Number(bean.queryTimout ?? 0);
    try {
      const { table, rowCount } =
        timeoutMs > 0
          ? await Promise.race([
              work,
              new Promise<never>((_r, reject) =>
                setTimeout(
                  () => reject(new Error('rowcount read interrupted')),
                  timeoutMs
                ).unref?.()
              ),
            ])
          : await work;
      this.agent.socketSender.send(event, {
        messageId: ctx.messageId,
        error: false,
        hasNext: false,
        sourceName: bean.sourceName,
        tableName: table.id,
        rowCount,
      });
      this.observe(
        'response',
        event,
        { ...bean, messageId: ctx.messageId },
        `rowCount=${rowCount}`
      );
    } catch (error) {
      this.logger.error(`${bean.tableName} read rowcount error`, error);
      this.agent.socketSender.send(event, errorMessage(ctx.messageId, messageOf(error)));
      this.observe('error', event, { ...bean, messageId: ctx.messageId }, messageOf(error));
    }
  }

  /**
   * `TableCdcSyncHandler`：只做 checkSource（不存在时回 table_content_result 错误），
   * 其余不应答（Java 3.0 里这里就是空实现）。
   */
  private onCdcSync(ctx: SocketTaskContext): void {
    const bean = fetchBeanOf(ctx);
    this.logger.info(`start sync table cdc records, messageId: ${ctx.messageId}`);
    this.observe('request', ReceiveEvent.QUERY_CDC_OF_TABLE, { ...bean, messageId: ctx.messageId });
    this.checkSource(bean, ctx.messageId, SendEvent.SEND_CONTENT_OF_TABLE);
  }

  /**
   * `TableCdcSwitchHandler`：checkSource 后，Excel 数据源（LocalClientProxy）不是 Cdcable，
   * Java 只记错误日志、不回 cdc_switch_result。
   */
  private onCdcSwitch(ctx: SocketTaskContext): void {
    const bean = fetchBeanOf(ctx);
    this.logger.info(`cdc switch, messageId: ${ctx.messageId}`);
    this.observe('request', ReceiveEvent.CDC_SWITCH, { ...bean, messageId: ctx.messageId });
    const source = this.checkSource(bean, ctx.messageId, SendEvent.SEND_CONTENT_OF_TABLE);
    if (!source) return;
    this.logger.error(
      `cdc switch proxy is not Cdcable, sourceName: ${bean.sourceName}, proxy class: LocalExcelSource`
    );
    this.observe(
      'error',
      ReceiveEvent.CDC_SWITCH,
      { ...bean, messageId: ctx.messageId },
      'not Cdcable'
    );
  }

  /**
   * `ConnectionMetadataHandler`：解析失败 → INTERNAL；找不到数据源 → SOURCE_NOT_FOUND；
   * 非 JDBC（Excel 数据源）→ NON_JDBC。均回 connection_dialect_metadata_result 的 ofError。
   */
  private onConnectionMetadata(ctx: SocketTaskContext): void {
    const event = SendEvent.SEND_CONNECTION_DIALECT_METADATA;
    let sourceName: string | undefined;
    try {
      const raw = ctx.payload;
      const request = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        sourceName?: unknown;
      } | null;
      sourceName =
        request && typeof request === 'object' && request.sourceName != null
          ? String(request.sourceName)
          : undefined;
    } catch {
      this.agent.socketSender.send(
        event,
        errorMessage(ctx.messageId, 'DIALECT_METADATA_ERROR:INTERNAL')
      );
      return;
    }
    this.observe('request', ReceiveEvent.QUERY_CONNECTION_DIALECT_METADATA, {
      sourceName,
      messageId: ctx.messageId,
    });
    const source =
      sourceName !== undefined && this.allowed(sourceName)
        ? this.options.registry.get(sourceName)
        : undefined;
    if (!source) {
      if (
        sourceName !== undefined &&
        !this.allowed(sourceName) &&
        this.options.ignoreDisallowedSources
      )
        return;
      this.agent.socketSender.send(
        event,
        errorMessage(ctx.messageId, 'DIALECT_METADATA_ERROR:SOURCE_NOT_FOUND')
      );
      return;
    }
    this.agent.socketSender.send(
      event,
      errorMessage(ctx.messageId, 'DIALECT_METADATA_ERROR:NON_JDBC')
    );
  }

  private async onPreview(ctx: SocketTaskContext): Promise<void> {
    const bean = fetchBeanOf(ctx);
    bean.messageId = ctx.messageId;
    this.logger.info(
      `start fetch table content s3, table: ${bean.tableName}, rowSize: ${String(bean.rowSize)}, messageId: ${ctx.messageId}`
    );
    this.observe('request', ReceiveEvent.QUERY_CONTENT_OF_TABLE_S3, bean);
    const event = SendEvent.SEND_CONTENT_OF_TABLE_S3;
    const source = this.checkSource(bean, ctx.messageId, event);
    if (!source) return;
    if (!isPreviewFetch(bean)) {
      // Java 抛 IllegalArgumentException，不回任何消息
      this.logger.error(
        `TableContentS3Handler only support preview table content (rowSize=${String(bean.rowSize)}, payload keys: ${Object.keys(bean).join(',')})`
      );
      this.observe('error', event, bean, `not a preview request (rowSize=${bean.rowSize ?? ''})`);
      return;
    }
    const s3 = createS3SourceData(bean);
    const payload: Record<string, unknown> = {
      ...s3,
      skipSync: false,
      error: false,
      data: [] as unknown[],
    };
    try {
      const table = await source.getTable(bean.tableName);
      if (!table) throw new Error(`can not found table ${bean.tableName}`);
      const { meta, rows } = await source.topRows(table, ctx.messageId);
      payload.meta = meta;
      // S3DataSyncStream.row → DataStream.trans2OutputType，preview 时 append 到 source 走 socket
      payload.data = rows.map((row) => row.map(transOutputValue));
    } catch (error) {
      // Java：flowRead 先回错误消息，随后 DataStream.close() 仍会发出一份空数据
      this.readError(bean, ctx.messageId, event, error);
    }
    payload.hasNext = false;
    this.agent.socketSender.send(event, payload);
    this.observe('response', event, bean, `rows=${(payload.data as unknown[]).length}`);
  }
}

/** 同步上传用的流选项：commons-csv DEFAULT 行编码 + 每片一个 LZ4 Frame（1MB 块）。 */
export const EXCEL_SYNC_STREAM_OPTIONS: S3UploadStreamOptions = {
  rowEncoder: encodeCsvRow,
  batchEncoder: lz4FrameEncoderFactory,
};
