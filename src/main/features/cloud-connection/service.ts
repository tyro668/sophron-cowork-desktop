/**
 * 云连接服务：把 `src/main/local-agent`（本地宝云端通道 + Excel 数据源）接到应用里。
 *
 * - 配置（config.yaml 解析结果，含 token）由 store 加密保存，token 不进入渲染进程、不写日志；
 * - 用户添加的本地 Excel / CSV 文件组成一个本地数据源（sourceName 可改），连接成功后按
 *   Java 本地宝的协议上报表、响应云端的结构 / 行数 / 预览 / 同步请求；
 * - 状态变化通过 `notify` 推给渲染进程。
 *
 * 本文件不依赖 electron，便于单测；electron 相关的存储与对话框在 store.ts / ipc.ts。
 */
import * as path from 'node:path';

import type {
  CloudConnectionActivity,
  CloudConnectionConfigSummary,
  CloudConnectionFile,
  CloudConnectionFilePreview,
  CloudConnectionState,
  CloudConnectionStatus,
} from '../../../shared/contracts';
import { parseLocalAgentConfig } from '../../local-agent/config';
import { DEFAULT_AGENT_VERSION } from '../../local-agent/constants';
import {
  LocalExcelSource,
  type ExcelVersionStore,
  type UnchangedFile,
} from '../../local-agent/excel/local-excel-source';
import { isSupportedTableFile } from '../../local-agent/excel/table-reader';
import {
  EXCEL_SYNC_STREAM_OPTIONS,
  ExcelSourceHandlers,
  FetchType,
} from '../../local-agent/handlers/excel-source-handlers';
import { LocalAgent, type LocalAgentOptions } from '../../local-agent/local-agent';
import type { LocalAgentLogger } from '../../local-agent/logger';
import type { LocalAgentConfig } from '../../local-agent/types';

export const DEFAULT_SOURCE_NAME = '九思助理本地文件';
const MAX_ACTIVITIES = 50;

export interface StoredCloudConfig {
  config: LocalAgentConfig;
  fileName?: string;
  importedAt: number;
}

export interface CloudConnectionPersisted {
  config: StoredCloudConfig | null;
  autoConnect: boolean;
  sourceName: string;
  files: string[];
  versions: Record<string, UnchangedFile[]>;
}

export interface CloudConnectionStorePort {
  read(): CloudConnectionPersisted;
  write(patch: Partial<CloudConnectionPersisted>): void;
}

export class MemoryCloudConnectionStore implements CloudConnectionStorePort {
  private data: CloudConnectionPersisted;
  constructor(initial?: Partial<CloudConnectionPersisted>) {
    this.data = {
      config: null,
      autoConnect: false,
      sourceName: DEFAULT_SOURCE_NAME,
      files: [],
      versions: {},
      ...initial,
    };
  }
  read(): CloudConnectionPersisted {
    return this.data;
  }
  write(patch: Partial<CloudConnectionPersisted>): void {
    this.data = { ...this.data, ...patch };
  }
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
  constructor(private readonly store: CloudConnectionStorePort) {}
  get(id: string) {
    return this.store.read().versions[id];
  }
  put(id: string, files: UnchangedFile[]) {
    this.store.write({ versions: { ...this.store.read().versions, [id]: files } });
  }
  delete(id: string) {
    const next = { ...this.store.read().versions };
    delete next[id];
    this.store.write({ versions: next });
  }
}

export class CloudConnectionService {
  private agent: LocalAgent | null = null;
  private handlers: ExcelSourceHandlers | null = null;
  private status: CloudConnectionStatus = 'idle';
  private connectedAt: number | null = null;
  private remoteEnv: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private activities: CloudConnectionActivity[] = [];
  private readonly fileStates = new Map<string, CloudConnectionFile>();
  private readonly source: LocalExcelSource;

  constructor(private readonly deps: CloudConnectionServiceDeps) {
    const persisted = deps.store.read();
    this.source = new LocalExcelSource({
      sourceName: persisted.sourceName || DEFAULT_SOURCE_NAME,
      files: persisted.files,
      versionStore: new StoreVersionAdapter(deps.store),
    });
    for (const file of persisted.files) this.fileStates.set(file, this.pendingFile(file));
  }

  private pendingFile(filePath: string): CloudConnectionFile {
    return { path: filePath, name: path.basename(filePath), status: 'pending' };
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
      sourceName: this.source.sourceName,
      files: persisted.files.map((f) => this.fileStates.get(f) ?? this.pendingFile(f)),
      activities: [...this.activities],
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

  setSourceName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('数据源名称不能为空');
    if (this.agent) throw new Error('请先断开连接再修改数据源名称');
    this.source.sourceName = trimmed;
    this.deps.store.write({ sourceName: trimmed });
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
      get: (name: string) => (name === this.source.sourceName ? this.source : undefined),
      all: () => [this.source],
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
    void this.refreshFiles();
  }

  stop(): void {
    this.disconnect();
  }

  // ---------------------------------------------------------------- files

  async addFiles(paths: string[]): Promise<string[]> {
    const persisted = this.deps.store.read();
    const files = [...persisted.files];
    const rejected: string[] = [];
    for (const raw of paths) {
      const filePath = path.resolve(raw);
      if (!isSupportedTableFile(filePath)) {
        rejected.push(`${path.basename(filePath)}：不支持的文件类型`);
        continue;
      }
      if (files.includes(filePath)) continue;
      const clash = files.find((f) => path.basename(f) === path.basename(filePath));
      if (clash) {
        rejected.push(`${path.basename(filePath)}：已存在同名文件（表 id 按文件名生成）`);
        continue;
      }
      files.push(filePath);
      this.fileStates.set(filePath, this.pendingFile(filePath));
    }
    await this.applyFiles(files);
    return rejected;
  }

  async removeFile(filePath: string): Promise<void> {
    const files = this.deps.store.read().files.filter((f) => f !== filePath);
    this.fileStates.delete(filePath);
    await this.applyFiles(files);
  }

  private async applyFiles(files: string[]): Promise<void> {
    const before = this.deps.store.read().files;
    this.deps.store.write({ files });
    this.source.setFiles(files);
    this.emit();
    await this.refreshFiles();
    const changed = before.length !== files.length || before.some((f, i) => f !== files[i]);
    if (changed && this.handlers && this.status === 'connected') {
      try {
        await this.handlers.reportSingleSource(this.source, FetchType.UPDATE_SINGLE);
      } catch (error) {
        this.deps.logger.warn(`report source update failed: ${messageOf(error)}`);
      }
    }
  }

  /** 重新解析全部文件，更新解析状态。 */
  async refreshFiles(): Promise<void> {
    for (const filePath of this.deps.store.read().files) {
      const current = this.fileStates.get(filePath) ?? this.pendingFile(filePath);
      this.fileStates.set(filePath, { ...current, status: 'parsing', error: undefined });
      this.emit();
      try {
        const summary = await this.source.summarize(filePath, 0);
        this.fileStates.set(filePath, {
          path: filePath,
          name: summary.fileName,
          status: 'ready',
          size: summary.size,
          modifyTime: summary.modifyTime,
          sheets: summary.sheets.map(({ sampleRows: _s, ...rest }) => rest),
        });
      } catch (error) {
        this.fileStates.set(filePath, { ...current, status: 'error', error: messageOf(error) });
      }
      this.emit();
    }
  }

  async previewFile(filePath: string, sampleSize = 50): Promise<CloudConnectionFilePreview> {
    if (!this.deps.store.read().files.includes(filePath)) throw new Error('文件不在云连接列表中');
    const summary = await this.source.summarize(filePath, sampleSize);
    return {
      path: filePath,
      name: summary.fileName,
      charset: summary.charset,
      delimiter: summary.delimiter,
      sheets: summary.sheets,
    };
  }
}
