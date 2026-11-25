/**
 * 云连接服务：把 `src/main/local-agent`（本地宝云端通道 + Excel 数据源）接到应用里。
 *
 * - 配置（config.yaml 解析结果，含 token）由 store 加密保存，token 不进入渲染进程、不写日志；
 * - 数据源按 Java 本地宝的「分组」组织：每个分组 = 一个 `LocalDatasourceBean`（分组名 =
 *   sourceName、目录、自动读表策略、手动表），连接成功后按 Java 协议上报表、响应云端请求；
 * - 分组 / 手动表变化时按 Java `ConfigStorage.compareAndInit` 的规则上报：
 *   新增分组 → source/single `addSource`；删除 → `sourceDelete`（空表列表）；目录或策略变化 →
 *   `updateSingle`；只改手动表时仅当表 id 集合变化才 `updateSingle`（`LocalClientProxy.updateTables`）；
 *   分组名仅创建时可配置（与 Java 界面一致，服务端靠名字识别），`updateGroup` 拒绝改名，不会走
 *   `sourceDelete` + `addSource`；
 * - 状态变化通过 `notify` 推给渲染进程。
 *
 * 本文件不依赖 electron，便于单测；electron 相关的存储与对话框在 store.ts / ipc.ts。
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

import type {
  CloudConnectionActivity,
  CloudConnectionConfigSummary,
  CloudConnectionGroup,
  CloudConnectionGroupInput,
  CloudConnectionState,
  CloudConnectionStatus,
  CloudConnectionTableConfig,
  CloudConnectionTableEntry,
  CloudConnectionTableInput,
  CloudConnectionTablePreview,
} from '../../../shared/contracts';
import { parseLocalAgentConfig } from '../../local-agent/config';
import { DEFAULT_AGENT_VERSION } from '../../local-agent/constants';
import {
  LocalReadStrategy,
  normalizeExcelTable,
  validateExcelTable,
  validateGroupName,
  type ExcelTableConfig,
  type LocalGroupConfig,
} from '../../local-agent/excel/local-config';
import {
  LocalExcelSource,
  type ExcelVersionStore,
  type UnchangedFile,
} from '../../local-agent/excel/local-excel-source';
import {
  EXCEL_SYNC_STREAM_OPTIONS,
  ExcelSourceHandlers,
  FetchType,
} from '../../local-agent/handlers/excel-source-handlers';
import { LocalAgent, type LocalAgentOptions } from '../../local-agent/local-agent';
import type { LocalAgentLogger } from '../../local-agent/logger';
import type { LocalAgentConfig } from '../../local-agent/types';

export const DEFAULT_SOURCE_NAME = '九思助理本地文件';
export const CLOUD_CONNECTION_SCHEMA_VERSION = 2;
const MAX_ACTIVITIES = 50;

export interface StoredCloudConfig {
  config: LocalAgentConfig;
  fileName?: string;
  importedAt: number;
}

export interface StoredGroup extends LocalGroupConfig {
  id: string;
}

export interface CloudConnectionPersisted {
  config: StoredCloudConfig | null;
  autoConnect: boolean;
  groups: StoredGroup[];
  /** sourceName → tableId → 上次同步时的文件版本。 */
  versions: Record<string, Record<string, UnchangedFile[]>>;
  schemaVersion: number;
  /** v1（逐个添加文件）字段：迁移后不再使用，保留以便回退。 */
  sourceName?: string;
  files?: string[];
}

export interface CloudConnectionStorePort {
  read(): CloudConnectionPersisted;
  write(patch: Partial<CloudConnectionPersisted>): void;
}

export class MemoryCloudConnectionStore implements CloudConnectionStorePort {
  private data: CloudConnectionPersisted;
  constructor(initial?: Partial<CloudConnectionPersisted> & Record<string, unknown>) {
    this.data = {
      config: null,
      autoConnect: false,
      groups: [],
      versions: {},
      schemaVersion: initial ? (initial.schemaVersion ?? 0) : CLOUD_CONNECTION_SCHEMA_VERSION,
      ...initial,
    } as CloudConnectionPersisted;
  }
  read(): CloudConnectionPersisted {
    return this.data;
  }
  write(patch: Partial<CloudConnectionPersisted>): void {
    this.data = { ...this.data, ...patch };
  }
}

/**
 * v1 → v2：早期「逐个添加文件 + 一个 sourceName」变成一个分组（无目录、不自动读表，
 * 文件保留在 `files` 里按原规则生成表），版本记录挂到该分组名下。表 id、上报内容不变。
 */
export function migrateCloudConnectionData(
  data: CloudConnectionPersisted
): Partial<CloudConnectionPersisted> | null {
  if (data.schemaVersion >= CLOUD_CONNECTION_SCHEMA_VERSION) return null;
  const legacyFiles = Array.isArray(data.files) ? data.files : [];
  const sourceName = (data.sourceName || DEFAULT_SOURCE_NAME).trim() || DEFAULT_SOURCE_NAME;
  const groups: StoredGroup[] = Array.isArray(data.groups) ? [...data.groups] : [];
  if (legacyFiles.length > 0 && !groups.some((g) => g.sourceName === sourceName)) {
    groups.push({
      id: randomUUID(),
      sourceName,
      directoryPath: '',
      strategy: LocalReadStrategy.NONE,
      tables: [],
      files: [...legacyFiles],
    });
  }
  const rawVersions = (data.versions ?? {}) as Record<string, unknown>;
  const isFlat = Object.values(rawVersions).some((v) => Array.isArray(v));
  const versions = isFlat
    ? { [sourceName]: rawVersions as Record<string, UnchangedFile[]> }
    : (rawVersions as Record<string, Record<string, UnchangedFile[]>>);
  return { groups, versions, schemaVersion: CLOUD_CONNECTION_SCHEMA_VERSION };
}

export type AgentFactory = (config: LocalAgentConfig, options: LocalAgentOptions) => LocalAgent;

export interface CloudConnectionServiceDeps {
  store: CloudConnectionStorePort;
  logger: LocalAgentLogger;
  notify?: (state: CloudConnectionState) => void;
  createAgent?: AgentFactory;
  /** 透传给 LocalAgent（测试注入 ioFactory / fetchImpl）。 */
  agentOptions?: Partial<LocalAgentOptions>;
}

export function maskAgentId(agentId: string): string {
  if (!agentId) return '';
  if (agentId.length <= 8) return `${agentId.slice(0, 2)}****`;
  return `${agentId.slice(0, 4)}****${agentId.slice(-4)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StoreVersionAdapter implements ExcelVersionStore {
  constructor(
    private readonly store: CloudConnectionStorePort,
    private readonly sourceName: () => string
  ) {}
  private all() {
    return this.store.read().versions ?? {};
  }
  get(id: string) {
    return this.all()[this.sourceName()]?.[id];
  }
  put(id: string, files: UnchangedFile[]) {
    const all = this.all();
    const name = this.sourceName();
    this.store.write({ versions: { ...all, [name]: { ...(all[name] ?? {}), [id]: files } } });
  }
  delete(id: string) {
    const all = this.all();
    const name = this.sourceName();
    if (!all[name]?.[id]) return;
    const next = { ...all[name] };
    delete next[id];
    this.store.write({ versions: { ...all, [name]: next } });
  }
}

const GROUP_ERRORS: Record<string, string> = {
  required: '分组名不能为空',
  ampersand: '分组名称不能出现&',
  duplicate: '分组名称请勿重复',
  /** 与 Java agent-ui 文案一致：分组名称仅创建时可配置，保存后无法修改。 */
  immutable: '分组名称仅创建时可配置，保存后无法修改',
};

const TABLE_ERRORS: Record<string, string> = {
  nameRequired: '请输入表名',
  nameDuplicate: '表名请勿重复',
  pathRequired: '请选择文件路径',
};

interface GroupRuntime {
  source: LocalExcelSource;
  entries: CloudConnectionTableEntry[];
  status: 'pending' | 'ready' | 'error';
  error?: string;
}

export class CloudConnectionService {
  private agent: LocalAgent | null = null;
  private handlers: ExcelSourceHandlers | null = null;
  private status: CloudConnectionStatus = 'idle';
  private connectedAt: number | null = null;
  private remoteEnv: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private activities: CloudConnectionActivity[] = [];
  private readonly runtimes = new Map<string, GroupRuntime>();

  constructor(private readonly deps: CloudConnectionServiceDeps) {
    const migration = migrateCloudConnectionData(deps.store.read());
    if (migration) {
      deps.store.write(migration);
      if ((migration.groups ?? []).length > 0) {
        deps.logger.info(
          `cloud connection data migrated to groups: ${(migration.groups ?? []).map((g) => g.sourceName).join(',')}`
        );
      }
    }
    for (const group of this.groups()) this.ensureRuntime(group);
  }

  private groups(): StoredGroup[] {
    return this.deps.store.read().groups ?? [];
  }

  private ensureRuntime(group: StoredGroup): GroupRuntime {
    let runtime = this.runtimes.get(group.id);
    if (!runtime) {
      const source: LocalExcelSource = new LocalExcelSource({
        sourceName: group.sourceName,
        directoryPath: group.directoryPath,
        strategy: group.strategy,
        tables: group.tables,
        files: group.files ?? [],
        versionStore: new StoreVersionAdapter(this.deps.store, (): string => source.sourceName),
      });
      runtime = { source, entries: [], status: 'pending' };
      this.runtimes.set(group.id, runtime);
    }
    return runtime;
  }

  private findGroup(id: string): StoredGroup {
    const group = this.groups().find((g) => g.id === id);
    if (!group) throw new Error('分组不存在');
    return group;
  }

  private writeGroups(groups: StoredGroup[]): void {
    this.deps.store.write({ groups });
  }

  private sources(): LocalExcelSource[] {
    return this.groups().map((g) => this.ensureRuntime(g).source);
  }

  // ---------------------------------------------------------------- state

  getState(): CloudConnectionState {
    const persisted = this.deps.store.read();
    return {
      configured: Boolean(persisted.config),
      config: persisted.config ? this.summarizeConfig(persisted.config) : null,
      status: this.status,
      connectedAt: this.connectedAt,
      remoteEnv: this.remoteEnv,
      lastError: this.lastError,
      autoConnect: persisted.autoConnect,
      groups: this.groups().map((g) => this.groupState(g)),
      activities: [...this.activities],
    };
  }

  private groupState(group: StoredGroup): CloudConnectionGroup {
    const runtime = this.ensureRuntime(group);
    return {
      id: group.id,
      sourceName: group.sourceName,
      directoryPath: group.directoryPath,
      strategy: group.strategy,
      tables: group.tables.map((t) => toTableConfig(t)),
      files: [...(group.files ?? [])],
      entries: [...runtime.entries],
      entriesStatus: runtime.status,
      entriesError: runtime.error,
    };
  }

  private summarizeConfig(stored: StoredCloudConfig): CloudConnectionConfigSummary {
    const { server } = stored.config;
    return {
      agentIdMasked: maskAgentId(server.agentId),
      protocol: server.protocol,
      host: server.host,
      port: server.port,
      path: server.path,
      fileName: stored.fileName,
      importedAt: stored.importedAt,
      hasToken: Boolean(server.token),
    };
  }

  private emit(): void {
    this.deps.notify?.(this.getState());
  }

  private pushActivity(activity: Omit<CloudConnectionActivity, 'at'>): void {
    this.activities = [{ at: Date.now(), ...activity }, ...this.activities].slice(
      0,
      MAX_ACTIVITIES
    );
    this.emit();
  }

  // ---------------------------------------------------------------- config

  /** 解析并保存 config.yaml 内容；不回显 token。 */
  importConfigText(text: string, fileName?: string): void {
    const config = parseLocalAgentConfig(text, {});
    if (!config.server.agentId) throw new Error('config.yaml 缺少 server.agentId');
    if (!config.server.token) throw new Error('config.yaml 缺少 server.token');
    const wasConnected = this.agent !== null;
    if (wasConnected) this.disconnect();
    this.deps.store.write({
      config: {
        config,
        fileName: fileName ? path.basename(fileName) : undefined,
        importedAt: Date.now(),
      },
    });
    this.lastError = null;
    this.deps.logger.info(
      `cloud connection config imported, agentId: ${maskAgentId(config.server.agentId)}, host: ${config.server.host}`
    );
    this.emit();
  }

  clearConfig(): void {
    this.disconnect();
    this.deps.store.write({ config: null, autoConnect: false });
    this.lastError = null;
    this.emit();
  }

  setAutoConnect(enabled: boolean): void {
    this.deps.store.write({ autoConnect: enabled });
    this.emit();
  }

  // ---------------------------------------------------------------- connection

  connect(): void {
    const stored = this.deps.store.read().config;
    if (!stored) throw new Error('请先导入 config.yaml');
    if (this.agent) return;
    const options: LocalAgentOptions = {
      version: stored.config.server.version || DEFAULT_AGENT_VERSION,
      logger: this.deps.logger,
      streamOptions: EXCEL_SYNC_STREAM_OPTIONS,
      ...this.deps.agentOptions,
    };
    const agent = this.deps.createAgent
      ? this.deps.createAgent(stored.config, options)
      : new LocalAgent(stored.config, options);
    const registry = {
      get: (name: string) => this.sources().find((s) => s.sourceName === name),
      all: () => this.sources(),
    };
    const handlers = new ExcelSourceHandlers(agent, {
      registry,
      logger: this.deps.logger,
      observer: (e) =>
        this.pushActivity({
          type: e.type,
          event: e.event,
          tableName: e.tableName,
          detail: e.detail,
        }),
    });
    handlers.attach();
    agent.on('state', (s) => {
      this.status = s;
      if (s !== 'connected') this.connectedAt = s === 'reconnecting' ? this.connectedAt : null;
      this.emit();
    });
    agent.on('connectSuccess', (env) => {
      this.status = 'connected';
      this.connectedAt = Date.now();
      this.remoteEnv = { ...env } as Record<string, unknown>;
      this.lastError = null;
      this.pushActivity({ type: 'info', event: 'connectSuccess' });
    });
    agent.on('connectError', (message) => {
      this.lastError = message;
      this.pushActivity({ type: 'error', event: 'connect_error', detail: message });
    });
    agent.on('disconnect', (reason) => {
      this.pushActivity({ type: 'info', event: 'disconnect', detail: reason });
    });
    agent.on('offline', () => {
      this.lastError = '云端通知本连接已下线（可能在其他地方使用了同一个 agentId）';
      this.pushActivity({ type: 'error', event: 'offline' });
    });
    this.agent = agent;
    this.handlers = handlers;
    this.status = 'connecting';
    this.lastError = null;
    agent.start();
    this.emit();
  }

  disconnect(): void {
    const agent = this.agent;
    this.agent = null;
    this.handlers = null;
    if (agent) {
      agent.removeAllListeners();
      agent.stop();
    }
    this.status = agent ? 'stopped' : this.status;
    this.connectedAt = null;
    this.emit();
  }

  /** 应用启动时调用：开启了自动连接且已有配置则连接。 */
  start(): void {
    const persisted = this.deps.store.read();
    if (persisted.autoConnect && persisted.config) {
      try {
        this.connect();
      } catch (error) {
        this.lastError = messageOf(error);
        this.emit();
      }
    }
    void this.refreshTables();
  }

  stop(): void {
    this.disconnect();
  }

  private get online(): boolean {
    return Boolean(this.handlers && this.status === 'connected');
  }

  private async report(action: () => Promise<unknown> | undefined, what: string): Promise<void> {
    if (!this.online) return;
    try {
      await action();
    } catch (error) {
      this.deps.logger.warn(`${what} failed: ${messageOf(error)}`);
    }
  }

  // ---------------------------------------------------------------- groups

  /** 重新扫描各分组的表（手动表 + 自动表），更新状态。 */
  async refreshTables(groupId?: string): Promise<void> {
    const groups = groupId ? [this.findGroup(groupId)] : this.groups();
    for (const group of groups) {
      const runtime = this.ensureRuntime(group);
      runtime.status = 'pending';
      this.emit();
      try {
        const errors = new Map<string, string>();
        const tables = await runtime.source.listTables(errors);
        runtime.entries = tables.map((t) => ({
          id: t.id,
          manual: t.manual,
          fileName: t.fileName,
          sheetName: t.sheetName,
        }));
        runtime.status = 'ready';
        runtime.error = errors.size
          ? [...errors].map(([f, m]) => `${path.basename(f)}: ${m}`).join('；')
          : undefined;
      } catch (error) {
        runtime.status = 'error';
        runtime.error = messageOf(error);
      }
      this.emit();
    }
  }

  private async tableIds(group: StoredGroup): Promise<string[]> {
    const tables = await this.ensureRuntime(group).source.listTables();
    return tables.map((t) => t.id).sort();
  }

  private async checkDirectory(directoryPath: string): Promise<string> {
    const resolved = path.resolve(directoryPath);
    let isDir = false;
    try {
      isDir = (await stat(resolved)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new Error(`目录不存在：${directoryPath}`);
    return resolved;
  }

  async addGroup(input: CloudConnectionGroupInput): Promise<string> {
    const groups = this.groups();
    const error = validateGroupName(
      input.sourceName,
      groups.map((g) => g.sourceName)
    );
    if (error) throw new Error(GROUP_ERRORS[error]);
    const directoryPath = await this.checkDirectory(input.directoryPath);
    const group: StoredGroup = {
      id: randomUUID(),
      sourceName: input.sourceName.trim(),
      directoryPath,
      strategy: input.strategy,
      tables: [],
    };
    this.writeGroups([...groups, group]);
    const runtime = this.ensureRuntime(group);
    await this.refreshTables(group.id);
    // Java ConfigStorage：新增数据源 → initialize + fetchSingleTables(SOURCE_ADD)
    await this.report(() => {
      this.handlers!.registerProvider(runtime.source);
      return this.handlers!.reportSingleSource(runtime.source, FetchType.ADD_SOURCE);
    }, 'report source add');
    return group.id;
  }

  async updateGroup(id: string, input: CloudConnectionGroupInput): Promise<void> {
    const groups = this.groups();
    const current = this.findGroup(id);
    const name = input.sourceName.trim();
    // Java 界面：分组名仅创建时可配置；服务端靠 sourceName 识别数据源，禁止改名。
    if (name !== current.sourceName) {
      throw new Error(GROUP_ERRORS.immutable);
    }
    const directoryPath =
      input.directoryPath || !current.directoryPath
        ? input.directoryPath
          ? await this.checkDirectory(input.directoryPath)
          : ''
        : current.directoryPath;
    const next: StoredGroup = {
      ...current,
      sourceName: current.sourceName,
      directoryPath,
      strategy: input.strategy,
    };
    const recreate = directoryPath !== current.directoryPath || input.strategy !== current.strategy;
    if (!recreate) return;
    this.writeGroups(groups.map((g) => (g.id === id ? next : g)));
    const runtime = this.ensureRuntime(current);
    runtime.source.configure({ directoryPath, strategy: input.strategy });
    await this.refreshTables(id);
    // RECREATE → fetchSingleTables(UPDATE_SINGLE)
    await this.report(
      () => this.handlers!.reportSingleSource(runtime.source, FetchType.UPDATE_SINGLE),
      'report source update'
    );
  }

  async deleteGroup(id: string): Promise<void> {
    const group = this.findGroup(id);
    this.writeGroups(this.groups().filter((g) => g.id !== id));
    this.runtimes.delete(id);
    const versions = { ...(this.deps.store.read().versions ?? {}) };
    delete versions[group.sourceName];
    this.deps.store.write({ versions });
    this.emit();
    // DatasourceInitializer.deleteSource：source/single sourceDelete + 空表列表
    await this.report(() => {
      this.handlers!.unregisterProvider(group.sourceName);
      return this.handlers!.reportSingleSource(
        new LocalExcelSource({ sourceName: group.sourceName }),
        FetchType.SOURCE_DELETE
      );
    }, 'report source delete');
  }

  // ---------------------------------------------------------------- manual tables

  private toStoredTable(
    input: CloudConnectionTableInput,
    previous: ExcelTableConfig | undefined
  ): ExcelTableConfig {
    const { password, ...rest } = input;
    const table = normalizeExcelTable(rest);
    const nextPassword = password === undefined ? previous?.password : password || undefined;
    if (nextPassword) table.password = nextPassword;
    return table;
  }

  private async applyTables(group: StoredGroup, tables: ExcelTableConfig[]): Promise<void> {
    const runtime = this.ensureRuntime(group);
    const before = await this.tableIds(group).catch(() => [] as string[]);
    const next: StoredGroup = { ...group, tables };
    this.writeGroups(this.groups().map((g) => (g.id === group.id ? next : g)));
    runtime.source.configure({ tables });
    await this.refreshTables(group.id);
    const after = await this.tableIds(next).catch(() => [] as string[]);
    // LocalClientProxy.updateTables：表 id 集合变化才 fetchSingleTables(UPDATE_SINGLE)
    if (before.join('\u0000') !== after.join('\u0000')) {
      await this.report(
        () => this.handlers!.reportSingleSource(runtime.source, FetchType.UPDATE_SINGLE),
        'report tables update'
      );
    }
  }

  async saveTable(
    groupId: string,
    originalName: string | null,
    input: CloudConnectionTableInput
  ): Promise<void> {
    const group = this.findGroup(groupId);
    if (!group.directoryPath) throw new Error('请先为分组设置目录');
    const previous = originalName
      ? group.tables.find((t) => t.tableName === originalName)
      : undefined;
    if (originalName && !previous) throw new Error('表不存在');
    const table = this.toStoredTable(input, previous);
    const others = group.tables.filter((t) => t.tableName !== originalName);
    const error = validateExcelTable(
      table,
      others.map((t) => t.tableName)
    );
    if (error) throw new Error(TABLE_ERRORS[error]);
    const versions = this.ensureRuntime(group).source.versionStore;
    if (previous) {
      // 改名 = 删除旧表；文件来源变化（策略 / 路径）时删除版本记录
      const watchChanged =
        previous.strategy !== table.strategy ||
        previous.relativeFilePath !== table.relativeFilePath;
      if (previous.tableName !== table.tableName || watchChanged)
        versions.delete(previous.tableName);
    }
    const tables = previous
      ? group.tables.map((t) => (t.tableName === originalName ? table : t))
      : [...group.tables, table];
    await this.applyTables(group, tables);
  }

  async deleteTable(groupId: string, tableName: string): Promise<void> {
    const group = this.findGroup(groupId);
    if (!group.tables.some((t) => t.tableName === tableName)) throw new Error('表不存在');
    this.ensureRuntime(group).source.versionStore.delete(tableName);
    await this.applyTables(
      group,
      group.tables.filter((t) => t.tableName !== tableName)
    );
  }

  /** 移除早期逐个添加的文件。 */
  async removeLegacyFile(groupId: string, filePath: string): Promise<void> {
    const group = this.findGroup(groupId);
    const files = (group.files ?? []).filter((f) => f !== filePath);
    const runtime = this.ensureRuntime(group);
    const before = await this.tableIds(group).catch(() => [] as string[]);
    const next: StoredGroup = { ...group, files };
    if (files.length === 0) delete next.files;
    this.writeGroups(this.groups().map((g) => (g.id === groupId ? next : g)));
    runtime.source.setFiles(files);
    await this.refreshTables(groupId);
    const after = await this.tableIds(next).catch(() => [] as string[]);
    if (before.join('\u0000') !== after.join('\u0000')) {
      await this.report(
        () => this.handlers!.reportSingleSource(runtime.source, FetchType.UPDATE_SINGLE),
        'report source update'
      );
    }
  }

  // ---------------------------------------------------------------- preview

  async previewTable(groupId: string, tableId: string): Promise<CloudConnectionTablePreview> {
    const group = this.findGroup(groupId);
    const source = this.ensureRuntime(group).source;
    const table = await source.getTable(tableId);
    if (!table) throw new Error(`can not found table ${tableId}`);
    return { tableName: tableId, ...(await source.previewTable(table)) };
  }

  /** 预览表单里尚未保存的手动表配置（对应 agent-ui 的表名旁「预览」按钮）。 */
  async previewDraft(
    groupId: string,
    originalName: string | null,
    input: CloudConnectionTableInput
  ): Promise<CloudConnectionTablePreview> {
    const group = this.findGroup(groupId);
    if (!group.directoryPath) throw new Error('请先为分组设置目录');
    const previous = originalName
      ? group.tables.find((t) => t.tableName === originalName)
      : undefined;
    const table = this.toStoredTable(input, previous);
    const source = this.ensureRuntime(group).source;
    const draft = source.draftTable(table);
    return { tableName: table.tableName, ...(await source.previewTable(draft)) };
  }

  /** 把用户选择的绝对路径转成分组内的相对路径（`/` 开头，Unix 分隔符）。 */
  relativePathInGroup(groupId: string, absolutePath: string): string {
    const group = this.findGroup(groupId);
    if (!group.directoryPath) throw new Error('请先为分组设置目录');
    const rel = path.relative(path.resolve(group.directoryPath), path.resolve(absolutePath));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('请选择分组目录下的文件或文件夹');
    }
    return `/${rel.split(path.sep).join('/')}`;
  }
}

function toTableConfig(table: ExcelTableConfig): CloudConnectionTableConfig {
  const { password, ...rest } = table;
  return { ...rest, hasPassword: Boolean(password) };
}
