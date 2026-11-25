/**
 * 云端 Socket.IO 连接生命周期，对应 Java `WebSocketVerticle` + `EventFactory.initFlowEvent()`
 * + `AgentContext`。
 *
 * 与 Java 的差异：收到服务端 `offline`（同一 agentId 被踢下线等）时，Java 会 `System.exit(0)`；
 * 这里只断开连接、停止重连并发出 `offline` 事件，由宿主应用决定怎么提示用户。
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  io as defaultIo,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from 'socket.io-client';

import { buildSocketOptions, buildSocketUrl, isDemoAgentId, verifyAgentId } from './config';
import { DEFAULT_API_LEVEL, FlowEvent } from './constants';
import { consoleLocalAgentLogger, type LocalAgentLogger } from './logger';
import { RemoteEnvStore, type RemoteEnvSnapshot } from './remote-env';
import { SocketEventDispatcher } from './transport/event-dispatcher';
import type { LocalAgentConfig, LocalAgentConnectionState } from './types';

export type IoFactory = (uri: string, opts: Partial<ManagerOptions & SocketOptions>) => Socket;

export interface LocalAgentConnectionOptions {
  config: LocalAgentConfig;
  /** 本地宝产品版本号（握手 query.version）。 */
  version: string;
  apiLevel?: string;
  logger?: LocalAgentLogger;
  remoteEnv?: RemoteEnvStore;
  dispatcher?: SocketEventDispatcher;
  ioFactory?: IoFactory;
  /** 存活日志间隔，Java 是 1 小时。0 关闭。 */
  aliveLogIntervalMs?: number;
}

export interface LocalAgentConnectionEvents {
  state: [LocalAgentConnectionState];
  connectSuccess: [RemoteEnvSnapshot];
  connectError: [string];
  disconnect: [string];
  offline: [];
}

export class LocalAgentConnection extends EventEmitter<LocalAgentConnectionEvents> {
  readonly remoteEnv: RemoteEnvStore;
  readonly dispatcher: SocketEventDispatcher;
  private readonly logger: LocalAgentLogger;
  private readonly ioFactory: IoFactory;
  private socket: Socket | null = null;
  private stateValue: LocalAgentConnectionState = 'idle';
  private instanceIdValue = '';
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();

  constructor(private readonly options: LocalAgentConnectionOptions) {
    super();
    this.logger = options.logger ?? consoleLocalAgentLogger;
    this.remoteEnv = options.remoteEnv ?? new RemoteEnvStore();
    this.dispatcher = options.dispatcher ?? new SocketEventDispatcher(this.logger);
    this.ioFactory = options.ioFactory ?? (defaultIo as unknown as IoFactory);
  }

  get state(): LocalAgentConnectionState {
    return this.stateValue;
  }

  get instanceId(): string {
    return this.instanceIdValue;
  }

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  private setState(state: LocalAgentConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit('state', state);
  }

  /**
   * 建立连接。示例配置（DEMO_AGENTID）不连接，返回 false。
   * 已经在运行时直接返回 true。
   */
  start(): boolean {
    if (this.socket) return true;
    const { config } = this.options;
    if (isDemoAgentId(config.server.agentId)) {
      this.logger.info('please copy config from server');
      return false;
    }
    const agentId = verifyAgentId(config.server.agentId);
    this.instanceIdValue = randomUUID();
    const url = buildSocketUrl(config.server);
    const socket = this.ioFactory(
      url,
      buildSocketOptions(config, {
        agentId,
        version: this.options.version,
        apiLevel: this.options.apiLevel ?? DEFAULT_API_LEVEL,
        instanceId: this.instanceIdValue,
      })
    );
    this.socket = socket;
    this.bindFlowEvents(socket);
    this.dispatcher.attach(socket);
    this.logger.info(
      `Data transport agent starting, url: ${url}, instanceId: ${this.instanceIdValue}`
    );
    this.setState('connecting');
    socket.connect();
    this.startAliveLog();
    return true;
  }

  /** 主动断开并释放资源。 */
  stop(): void {
    this.stopAliveLog();
    const socket = this.socket;
    if (!socket) {
      if (this.stateValue !== 'offline') this.setState('stopped');
      return;
    }
    this.socket = null;
    this.dispatcher.detach();
    socket.io.off();
    socket.off();
    socket.disconnect();
    if (this.stateValue !== 'offline') this.setState('stopped');
    this.logger.info('Data transport agent stopped');
  }

  private bindFlowEvents(socket: Socket): void {
    socket.on('connect', () => {
      this.logger.info(
        `socket connected, sessionId: ${socket.id}, transport: ${socket.io.engine?.transport?.name}`
      );
    });

    socket.on('connect_error', (error: Error) => {
      this.logger.warn(`socket connect error: ${error.message}`);
      this.setState(socket.active ? 'reconnecting' : 'disconnected');
    });

    socket.on('disconnect', (reason: string) => {
      this.logger.info(`jsy agent stopped, cause: ${reason}`);
      this.setState(socket.active ? 'reconnecting' : 'disconnected');
      this.emit('disconnect', reason);
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      this.logger.warn(`try reconnect, attempt: ${attempt}`);
      this.setState('reconnecting');
    });
    socket.io.on('reconnect', () => this.logger.info('agent reconnected'));
    socket.io.on('reconnect_error', (error: Error) =>
      this.logger.error(
        `try reconnect error, cause: ${error.message}, remote may have been shut down, waiting to restart`
      )
    );
    socket.io.on('reconnect_failed', () => {
      this.logger.error('reconnect attempts exhausted');
      this.setState('disconnected');
    });

    socket.on(FlowEvent.CONNECT_ERROR_MESSAGE, (...args: unknown[]) => {
      const message = args
        .filter((a) => typeof a !== 'function')
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(', ');
      this.logger.error(`start failed ==> ${message}`);
      this.setState('disconnected');
      this.emit('connectError', message);
    });

    socket.on(FlowEvent.CONNECT_SUCCESS, (payload: unknown) => {
      this.logger.info(
        `jsy agent start successfully, version: ${this.options.version}, apiLevel: ${this.options.apiLevel ?? DEFAULT_API_LEVEL}, instanceId: ${this.instanceIdValue}, sessionId: ${socket.id}`
      );
      try {
        const env = this.remoteEnv.update(RemoteEnvStore.parse(payload));
        this.logger.info('remote env is', env);
        this.setState('connected');
        this.emit('connectSuccess', env);
      } catch (error) {
        this.logger.error('update env error', error);
      }
    });

    socket.on(FlowEvent.OFFLINE, () => {
      this.logger.warn(`offline this client by server, pid: ${process.pid}`);
      this.setState('offline');
      this.stop();
      this.emit('offline');
    });
  }

  private startAliveLog(): void {
    const interval = this.options.aliveLogIntervalMs ?? 60 * 60 * 1000;
    if (!(interval > 0)) return;
    const print = () =>
      this.logger.info(
        `alive check, clientId ${this.options.config.server.agentId}, pid ${process.pid}, running ${Date.now() - this.startedAt}ms, socket ${this.connected}, version ${this.options.version}`
      );
    print();
    this.aliveTimer = setInterval(print, interval);
    this.aliveTimer.unref?.();
  }

  private stopAliveLog(): void {
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    this.aliveTimer = null;
  }
}
