/**
 * 云连接服务：把 `src/main/local-agent`（本地宝云端通道 + Excel 数据源）接到应用里。
 *
 * - 配置（config.yaml 解析结果，含 token）由 store 加密保存，token 不进入渲染进程、不写日志；
 * - 数据源按「逻辑分组」组织：分组名 = 云端 sourceName，分组内的表只能引用已有原始表 / 结果表；
 *   连接成功后按 Java 协议上报表、从 DuckDB 物化结果取数；
 * - 分组 / 引用变化时按 Java `ConfigStorage.compareAndInit` 的规则上报：
 *   新增分组 → source/single `addSource`；删除 → `sourceDelete`（空表列表）；引用集合变化 →
 *   `updateSingle`；
 *   分组名仅创建时可配置（与 Java 界面一致，服务端靠名字识别），`updateGroup` 拒绝改名，不会走
 *   `sourceDelete` + `addSource`；
 * - 状态变化通过 `notify` 推给渲染进程。
 *
 * 本文件不依赖 electron，便于单测；electron 相关的存储与对话框在 store.ts / ipc.ts。
 */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import type {
  CloudConnectionActivity,
  CloudConnectionConfigSummary,
  CloudConnectionGroup,
  CloudConnectionGroupInput,
  CloudConnectionState,
  CloudConnectionStatus,
  CloudConnectionTableEntry,
  CloudConnectionTablePreview,
  CloudConnectionTableRef,
  CloudConnectionTableRefInput,
  LegacyCloudConnectionTableConfig,
} from '../../../shared/contracts';
import {
  CLOUD_CONNECT_TIMEOUT_ERROR,
  CLOUD_CONNECT_TIMEOUT_MS,
  DEFAULT_AUTO_CONNECT,
  resolveAutoConnect,
  suggestReportName,
  isCloudConnectionRefNameConfirmed,
} from '../../../shared/contracts';
import { parseLocalAgentConfig } from '../../local-agent/config';
import { DEFAULT_AGENT_VERSION } from '../../local-agent/constants';
import { LocalReadStrategy, validateGroupName } from '../../local-agent/excel/local-config';
import {
  LocalExcelSource,
  type ExcelVersionStore,
  type UnchangedFile,
} from '../../local-agent/excel/local-excel-source';
import {
  importInputFromLegacyTable,
  planAutoTableImports,
  resolveSingleFileSheetName,
  toExcelTableConfig,
} from './legacy-table-import';
import {
  ReferencedTableSource,
  resolveTableRef,
  type CloudTableStorePort,
  type StoredTableRef,
} from './referenced-source';
import {
  EXCEL_SYNC_STREAM_OPTIONS,
  ExcelSourceHandlers,
  FetchType,
} from '../../local-agent/handlers/excel-source-handlers';
import { LocalAgent, type LocalAgentOptions } from '../../local-agent/local-agent';
import type { LocalAgentLogger } from '../../local-agent/logger';
import type { LocalAgentConfig } from '../../local-agent/types';

export const DEFAULT_SOURCE_NAME = '九思助理本地文件';
export const CLOUD_CONNECTION_SCHEMA_VERSION = 4;
const MAX_ACTIVITIES = 50;

export {
  CLOUD_CONNECT_TIMEOUT_ERROR,
  CLOUD_CONNECT_TIMEOUT_MS,
  DEFAULT_AUTO_CONNECT,
  resolveAutoConnect,
};

export interface StoredCloudConfig {
  config: LocalAgentConfig;
  fileName?: string;
  importedAt: number;
}

export interface StoredGroup {
  id: string;
  sourceName: string;
  tables: StoredTableRef[];
  /** schema v2 遗留：迁移完成后删除。 */
  directoryPath?: string;
  strategy?: number;
  legacyTables?: LegacyCloudConnectionTableConfig[];
  files?: string[];
}

export function isLegacyTableConfig(value: unknown): value is LegacyCloudConnectionTableConfig {
  return Boolean(
    value && typeof value === 'object' && 'relativeFilePath' in value && !('tableId' in value)
  );
}

export function normalizeStoredGroup(raw: StoredGroup): StoredGroup {
  const tables = Array.isArray(raw.tables) ? raw.tables : [];
  if (tables.some(isLegacyTableConfig)) {
    return {
      ...raw,
      tables: [],
      legacyTables: [
        ...(raw.legacyTables ?? []),
        ...(tables.filter(isLegacyTableConfig) as unknown as LegacyCloudConnectionTableConfig[]),
      ],
    };
  }
  return {
    ...raw,
    tables: tables.filter(
      (item): item is StoredTableRef =>
        !isLegacyTableConfig(item) && Boolean((item as StoredTableRef).tableId)
    ),
  };
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
      autoConnect: DEFAULT_AUTO_CONNECT,
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
  if (data.schemaVersion >= 2) return null;
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
  return { groups, versions, schemaVersion: 2 };
}

/**
 * v3 → v4：为已有引用补上 `nameConfirmed: true`（未完成是新行为，旧数据视为已确认）。
 */
export function migrateConfirmedRefNames(
  data: CloudConnectionPersisted
): Partial<CloudConnectionPersisted> | null {
  if ((data.schemaVersion ?? 0) >= 4) return null;
  const groups = (Array.isArray(data.groups) ? data.groups : []).map((group) => ({
    ...group,
    tables: (group.tables ?? []).map((table) =>
      isCloudConnectionRefNameConfirmed(table) && table.nameConfirmed !== undefined
        ? table
        : { ...table, nameConfirmed: table.nameConfirmed !== false }
    ),
  }));
  return { groups, schemaVersion: 4 };
}

export type AgentFactory = (config: LocalAgentConfig, options: LocalAgentOptions) => LocalAgent;

export interface CloudConnectionServiceDeps {
  store: CloudConnectionStorePort;
  logger: LocalAgentLogger;
  notify?: (state: CloudConnectionState) => void;
  createAgent?: AgentFactory;
  /** 透传给 LocalAgent（测试注入 ioFactory / fetchImpl）。 */
  agentOptions?: Partial<LocalAgentOptions>;
  tableStore?: CloudTableStorePort;
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
  nameImmutable: '上报表名确认后不可修改',
};

interface GroupRuntime {
  source: ReferencedTableSource;
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
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private initialConnect = false;

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
    const nameMigration = migrateConfirmedRefNames(deps.store.read());
    if (nameMigration) deps.store.write(nameMigration);
    const groups = (this.deps.store.read().groups ?? []).map(normalizeStoredGroup);
    if (JSON.stringify(groups) !== JSON.stringify(this.deps.store.read().groups ?? [])) {
      this.deps.store.write({ groups });
    }
    for (const group of groups) this.ensureRuntime(group);
  }

  private groups(): StoredGroup[] {
    return (this.deps.store.read().groups ?? []).map(normalizeStoredGroup);
  }

  private ensureRuntime(group: StoredGroup): GroupRuntime {
    let runtime = this.runtimes.get(group.id);
    if (!runtime) {
      const source = new ReferencedTableSource(
        group.sourceName,
        group.tables,
        this.deps.tableStore,
        new StoreVersionAdapter(this.deps.store, (): string => source.sourceName)
      );
      runtime = { source, entries: [], status: 'pending' };
      this.runtimes.set(group.id, runtime);
    } else {
      runtime.source.setRefs(group.tables);
      runtime.source.sourceName = group.sourceName;
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

  private sources(): ReferencedTableSource[] {
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
      autoConnect: resolveAutoConnect(persisted.autoConnect),
      groups: this.groups().map((g) => this.groupState(g)),
      activities: [...this.activities],
    };
  }

  private groupState(group: StoredGroup): CloudConnectionGroup {
    const runtime = this.ensureRuntime(group);
    return {
      id: group.id,
      sourceName: group.sourceName,
      tables: runtime.entries.length
        ? this.tablesFromEntries(group.tables, runtime.entries)
        : group.tables.map((ref) => ({
            ...ref,
            status: 'pending' as const,
          })),
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
    if (resolveAutoConnect(this.deps.store.read().autoConnect)) {
      try {
        this.connect();
      } catch (error) {
        this.lastError = messageOf(error);
        this.emit();
      }
    }
  }

  clearConfig(): void {
    this.disconnect();
    this.deps.store.write({ config: null });
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
      this.initialConnect = false;
      this.clearConnectTimer();
      this.status = 'connected';
      this.connectedAt = Date.now();
      this.remoteEnv = { ...env } as Record<string, unknown>;
      this.lastError = null;
      this.pushActivity({ type: 'info', event: 'connectSuccess' });
    });
    agent.on('connectError', (message) => {
      this.lastError = message;
      this.pushActivity({ type: 'error', event: 'connect_error', detail: message });
      if (this.initialConnect) this.failInitialConnect(message);
    });
    agent.on('disconnect', (reason) => {
      this.pushActivity({ type: 'info', event: 'disconnect', detail: reason });
    });
    agent.on('offline', () => {
      const message = '云端通知本连接已下线（可能在其他地方使用了同一个 agentId）';
      this.lastError = message;
      this.pushActivity({ type: 'error', event: 'offline' });
      if (this.initialConnect) this.failInitialConnect(message);
    });
    this.agent = agent;
    this.handlers = handlers;
    this.status = 'connecting';
    this.lastError = null;
    this.initialConnect = true;
    this.armConnectTimer();
    agent.start();
    this.emit();
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private armConnectTimer(): void {
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.initialConnect || this.status === 'connected') return;
      this.failInitialConnect(CLOUD_CONNECT_TIMEOUT_ERROR);
    }, CLOUD_CONNECT_TIMEOUT_MS);
  }

  /** 首次连接失败：记录原因并停止本次尝试，避免无限重连把状态一直停在「连接中」。 */
  private failInitialConnect(message: string): void {
    this.initialConnect = false;
    this.clearConnectTimer();
    this.lastError = message;
    if (this.agent) this.disconnect();
    else this.emit();
  }

  disconnect(): void {
    this.clearConnectTimer();
    this.initialConnect = false;
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

  /** 应用启动时调用：已有配置且自动连接（默认开启）则连接。 */
  start(): void {
    const persisted = this.deps.store.read();
    if (resolveAutoConnect(persisted.autoConnect) && persisted.config) {
      try {
        this.connect();
      } catch (error) {
        this.lastError = messageOf(error);
        this.emit();
      }
    }
    void this.migrateLegacyGroups().finally(() => {
      void this.refreshTables();
    });
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

  /** 解析引用状态，更新右侧列表。 */
  async refreshTables(groupId?: string): Promise<void> {
    const groups = groupId ? [this.findGroup(groupId)] : this.groups();
    for (const group of groups) {
      const runtime = this.ensureRuntime(group);
      runtime.status = 'pending';
      this.emit();
      try {
        const errors = new Map<string, string>();
        const entries: CloudConnectionTableEntry[] = [];
        for (const ref of group.tables) {
          const resolved = this.deps.tableStore
            ? await resolveTableRef(this.deps.tableStore, ref)
            : { ...ref, status: 'pending' as const, statusReason: '数据仓库尚未就绪' };
          entries.push({
            id: resolved.reportName,
            kind: resolved.kind,
            tableId: resolved.tableId,
            displayName: resolved.displayName,
            status: resolved.status,
          });
          if (resolved.status !== 'ok' && resolved.statusReason) {
            errors.set(resolved.reportName, resolved.statusReason);
          }
        }
        runtime.entries = entries;
        runtime.status = 'ready';
        runtime.error = errors.size
          ? [...errors].map(([name, message]) => `${name}: ${message}`).join('；')
          : undefined;
      } catch (error) {
        runtime.status = 'error';
        runtime.error = messageOf(error);
      }
      this.emit();
    }
  }

  private tablesFromEntries(
    refs: StoredTableRef[],
    entries: CloudConnectionTableEntry[]
  ): CloudConnectionTableRef[] {
    return refs.map((ref) => {
      const entry = entries.find((item) => item.id === ref.reportName);
      return {
        ...ref,
        displayName: entry?.displayName,
        status: entry?.status ?? 'pending',
      };
    });
  }

  private async tableIds(group: StoredGroup): Promise<string[]> {
    return group.tables
      .filter((table) => isCloudConnectionRefNameConfirmed(table))
      .map((table) => table.reportName)
      .sort();
  }

  async addGroup(input: CloudConnectionGroupInput): Promise<string> {
    const groups = this.groups();
    const error = validateGroupName(
      input.sourceName,
      groups.map((g) => g.sourceName)
    );
    if (error) throw new Error(GROUP_ERRORS[error]);
    const group: StoredGroup = {
      id: randomUUID(),
      sourceName: input.sourceName.trim(),
      tables: [],
    };
    this.writeGroups([...groups, group]);
    const runtime = this.ensureRuntime(group);
    await this.refreshTables(group.id);
    await this.report(() => {
      this.handlers!.registerProvider(runtime.source);
      return this.handlers!.reportSingleSource(runtime.source, FetchType.ADD_SOURCE);
    }, 'report source add');
    return group.id;
  }

  async updateGroup(id: string, input: CloudConnectionGroupInput): Promise<void> {
    const current = this.findGroup(id);
    const name = input.sourceName.trim();
    if (name !== current.sourceName) {
      throw new Error(GROUP_ERRORS.immutable);
    }
  }

  async deleteGroup(id: string): Promise<void> {
    const group = this.findGroup(id);
    this.writeGroups(this.groups().filter((g) => g.id !== id));
    this.runtimes.delete(id);
    const versions = { ...(this.deps.store.read().versions ?? {}) };
    delete versions[group.sourceName];
    this.deps.store.write({ versions });
    this.emit();
    await this.report(() => {
      this.handlers!.unregisterProvider(group.sourceName);
      return this.handlers!.reportSingleSource(
        new LocalExcelSource({ sourceName: group.sourceName }),
        FetchType.SOURCE_DELETE
      );
    }, 'report source delete');
  }

  private defaultReportName(displayName: string, used: Set<string>): string {
    return suggestReportName(displayName, used);
  }

  async addTableRefs(groupId: string, inputs: CloudConnectionTableRefInput[]): Promise<void> {
    const group = this.findGroup(groupId);
    if (!this.deps.tableStore) throw new Error('数据仓库尚未就绪');
    const used = new Set(group.tables.map((table) => table.reportName));
    const next = [...group.tables];
    for (const input of inputs) {
      if (next.some((table) => table.kind === input.kind && table.tableId === input.tableId)) {
        continue;
      }
      const resolved = await resolveTableRef(this.deps.tableStore, {
        reportName: input.reportName?.trim() || 'pending',
        kind: input.kind,
        tableId: input.tableId,
      });
      if (resolved.status === 'missing') {
        throw new Error(resolved.statusReason || '表不存在');
      }
      const reportName =
        input.reportName?.trim() ||
        this.defaultReportName(resolved.displayName || '未命名表', used);
      if (used.has(reportName)) throw new Error(TABLE_ERRORS.nameDuplicate);
      used.add(reportName);
      next.push({ reportName, kind: input.kind, tableId: input.tableId, nameConfirmed: false });
    }
    await this.applyRefs(group, next);
  }

  async updateTableRef(
    groupId: string,
    reportName: string,
    input: { reportName: string }
  ): Promise<void> {
    const group = this.findGroup(groupId);
    const current = group.tables.find((table) => table.reportName === reportName);
    if (!current) throw new Error('表不存在');
    const nextName = input.reportName.trim();
    if (!nextName) throw new Error(TABLE_ERRORS.nameRequired);
    if (isCloudConnectionRefNameConfirmed(current)) {
      if (nextName !== reportName) throw new Error(TABLE_ERRORS.nameImmutable);
      return;
    }
    if (nextName !== reportName && group.tables.some((table) => table.reportName === nextName)) {
      throw new Error(TABLE_ERRORS.nameDuplicate);
    }
    const runtime = this.ensureRuntime(group);
    if (nextName !== reportName) runtime.source.versionStore.delete(reportName);
    await this.applyRefs(
      group,
      group.tables.map((table) =>
        table.reportName === reportName
          ? { ...table, reportName: nextName, nameConfirmed: true }
          : table
      )
    );
  }

  async deleteTable(groupId: string, reportName: string): Promise<void> {
    const group = this.findGroup(groupId);
    if (!group.tables.some((table) => table.reportName === reportName)) throw new Error('表不存在');
    this.ensureRuntime(group).source.versionStore.delete(reportName);
    await this.applyRefs(
      group,
      group.tables.filter((table) => table.reportName !== reportName)
    );
  }

  private async applyRefs(group: StoredGroup, tables: StoredTableRef[]): Promise<void> {
    const runtime = this.ensureRuntime(group);
    const before = await this.tableIds(group).catch(() => [] as string[]);
    const next: StoredGroup = {
      ...group,
      tables,
      directoryPath: undefined,
      strategy: undefined,
      legacyTables: undefined,
      files: undefined,
    };
    delete next.directoryPath;
    delete next.strategy;
    delete next.legacyTables;
    delete next.files;
    this.writeGroups(this.groups().map((item) => (item.id === group.id ? next : item)));
    runtime.source.setRefs(tables);
    await this.refreshTables(group.id);
    const after = await this.tableIds(next).catch(() => [] as string[]);
    if (before.join('\u0000') !== after.join('\u0000')) {
      await this.report(
        () => this.handlers!.reportSingleSource(runtime.source, FetchType.UPDATE_SINGLE),
        'report tables update'
      );
    }
  }

  async previewTable(groupId: string, reportName: string): Promise<CloudConnectionTablePreview> {
    const group = this.findGroup(groupId);
    const source = this.ensureRuntime(group).source;
    const table = await source.getTable(reportName, { includePending: true });
    if (!table) throw new Error(`can not found table ${reportName}`);
    return { tableName: reportName, ...(await source.previewTable(table)) };
  }

  private migrating = false;

  /** 把 v2 目录/手动表/自动表物化为原始表并改为引用。幂等。 */
  async migrateLegacyGroups(): Promise<void> {
    if (this.migrating) return;
    this.migrating = true;
    try {
      if (!this.deps.tableStore) return;
      const groups = this.groups();
      let changed = false;
      const nextGroups: StoredGroup[] = [];
      for (const group of groups) {
        const migrated = await this.migrateOneGroup(group);
        nextGroups.push(migrated);
        if (migrated !== group) changed = true;
      }
      if (changed) {
        this.deps.store.write({
          groups: nextGroups,
          schemaVersion: CLOUD_CONNECTION_SCHEMA_VERSION,
        });
        for (const group of nextGroups) this.ensureRuntime(group);
        await this.refreshTables();
      } else if ((this.deps.store.read().schemaVersion ?? 0) < CLOUD_CONNECTION_SCHEMA_VERSION) {
        this.deps.store.write({ schemaVersion: CLOUD_CONNECTION_SCHEMA_VERSION });
      }
    } catch (error) {
      this.deps.logger.warn(`cloud connection v3 migration failed: ${messageOf(error)}`);
    } finally {
      this.migrating = false;
    }
  }

  private async migrateOneGroup(group: StoredGroup): Promise<StoredGroup> {
    const store = this.deps.tableStore;
    if (!store) return group;
    const hasLegacy =
      Boolean(group.legacyTables?.length) ||
      Boolean(group.files?.length) ||
      Boolean(group.directoryPath && group.strategy && group.strategy !== LocalReadStrategy.NONE);
    if (!hasLegacy) return group;
    const tables = [...group.tables];
    const used = new Set(tables.map((item) => item.reportName));
    const errors: string[] = [];
    for (const legacy of group.legacyTables ?? []) {
      if (tables.some((item) => item.reportName === legacy.tableName)) continue;
      try {
        let input = importInputFromLegacyTable(group.directoryPath || '', legacy);
        if (input.sourceKind === 'excel' && input.config && input.config.sourceKind === 'excel') {
          const excel = toExcelTableConfig(legacy);
          if (!input.config.sheetName) {
            const sheet = resolveSingleFileSheetName(input.filePath, excel);
            if (sheet) input = { ...input, config: { ...input.config, sheetName: sheet } };
          }
        }
        const created = await store.importRawTable(input);
        const reportName = legacy.tableName;
        used.add(reportName);
        tables.push({ reportName, kind: 'raw', tableId: created.id, nameConfirmed: true });
      } catch (error) {
        errors.push(`${legacy.tableName}: ${messageOf(error)}`);
      }
    }
    try {
      const autos = await planAutoTableImports({
        directoryPath: group.directoryPath || '',
        strategy: group.strategy ?? LocalReadStrategy.NONE,
        manualTables: group.legacyTables ?? [],
        files: group.files,
      });
      for (const auto of autos) {
        if (used.has(auto.reportName)) continue;
        try {
          const created = await store.importRawTable(auto.input);
          used.add(auto.reportName);
          tables.push({
            reportName: auto.reportName,
            kind: 'raw',
            tableId: created.id,
            nameConfirmed: true,
          });
        } catch (error) {
          errors.push(`${auto.reportName}: ${messageOf(error)}`);
        }
      }
    } catch (error) {
      errors.push(messageOf(error));
    }
    const next: StoredGroup = { id: group.id, sourceName: group.sourceName, tables };
    if (errors.length) {
      this.deps.logger.warn(
        `cloud connection group ${group.sourceName} migrated with errors: ${errors.join('；')}`
      );
    }
    return next;
  }
}
