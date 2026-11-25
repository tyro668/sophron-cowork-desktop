/**
 * 读取本地宝 config.yaml，并构造 Socket.IO 连接参数。
 * 对应 Java：`AgentConfig` / `ServerConfig` / `SocketIoConfig` / `VerifyUtil`
 * 以及 `WebSocketVerticle.concatOptions()`。
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

import { DEFAULT_API_LEVEL, DEFAULT_SOCKET_IO, DEMO_AGENT_ID, WS } from './constants';
import type { LocalAgentConfig, LocalAgentServerConfig, LocalAgentSocketIoConfig } from './types';

export class LocalAgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAgentConfigError';
  }
}

/** 覆盖 token 的环境变量，等价于 Java 的 `-Dtoken=...` 系统属性。 */
export const TOKEN_ENV_VAR = 'LOCAL_AGENT_TOKEN';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 解析 yaml 文本。支持 `socket.io`（Java 的 JsonProperty 名）和 `socketIO` 两种写法。 */
export function parseLocalAgentConfig(
  text: string,
  env: NodeJS.ProcessEnv = process.env
): LocalAgentConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new LocalAgentConfigError(
      `config.yaml 解析失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const root = asRecord(raw);
  const serverRaw = asRecord(root.server);
  if (Object.keys(serverRaw).length === 0) {
    throw new LocalAgentConfigError('config.yaml 缺少 server 配置');
  }
  const protocol = asString(serverRaw.protocol) || 'https';
  const server: LocalAgentServerConfig = {
    agentId: asString(serverRaw.agentId),
    token: asString(env[TOKEN_ENV_VAR]) || asString(serverRaw.token),
    protocol,
    host: asString(serverRaw.host),
    port: asNumber(serverRaw.port, protocol === 'https' ? 443 : 80),
    path: asString(serverRaw.path) || undefined,
    version: asString(serverRaw.version) || undefined,
  };
  if (!server.host) {
    throw new LocalAgentConfigError('config.yaml 缺少 server.host');
  }
  const sioRaw = asRecord(root['socket.io'] ?? root.socketIO);
  const socketIO: LocalAgentSocketIoConfig = {
    reconnectionAttempts: asNumber(
      sioRaw.reconnectionAttempts,
      DEFAULT_SOCKET_IO.reconnectionAttempts
    ),
    reconnectionDelay: asNumber(sioRaw.reconnectionDelay, DEFAULT_SOCKET_IO.reconnectionDelay),
    timeout: asNumber(sioRaw.timeout, DEFAULT_SOCKET_IO.timeout),
  };
  return { server, socketIO };
}

export async function loadLocalAgentConfig(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<LocalAgentConfig> {
  const text = await readFile(filePath, 'utf8');
  return parseLocalAgentConfig(text, env);
}

export function isDemoAgentId(agentId: string): boolean {
  return agentId === DEMO_AGENT_ID;
}

/**
 * 对应 `VerifyUtil.verifyAgentId`：示例 ID 换成随机 ID（不会真正连接），
 * 否则要求长度为 32。
 */
export function verifyAgentId(agentId: string): string {
  if (isDemoAgentId(agentId)) {
    return randomUUID().replace(/-/g, '');
  }
  if (!agentId || agentId.length !== 32) {
    throw new LocalAgentConfigError(
      `The length of agentId has to be equal to 32, agentId length = ${agentId?.length ?? 0}`
    );
  }
  return agentId;
}

/** `%s://%s:%s%s`（protocol, host, port, namespace）。 */
export function buildSocketUrl(server: LocalAgentServerConfig): string {
  return `${server.protocol}://${server.host}:${server.port}${WS.NAMESPACE}`;
}

export interface HandshakeIdentity {
  agentId: string;
  /** 本地宝产品版本号，云端可能据此做兼容判断。 */
  version: string;
  apiLevel?: string;
  instanceId: string;
}

/**
 * 对应 `concatOptions()`：
 * - token/agentId/version/apiLevel/instanceId 都放在握手 query 里（不是 v4 的 auth 字段）；
 * - 只走 websocket；
 * - Java 2.x 客户端里 `reconnectionAttempts: 0` 表示无限重试，JS 客户端 0 表示不重试，这里换成 Infinity。
 */
export function buildSocketOptions(
  config: LocalAgentConfig,
  identity: HandshakeIdentity
): Partial<ManagerOptions & SocketOptions> {
  const { server, socketIO } = config;
  const options: Partial<ManagerOptions & SocketOptions> = {
    transports: ['websocket'],
    query: {
      [WS.TOKEN]: server.token,
      [WS.AGENT_ID]: identity.agentId,
      [WS.VERSION]: identity.version,
      [WS.API_LEVEL]: identity.apiLevel ?? DEFAULT_API_LEVEL,
      [WS.INSTANCE_ID]: identity.instanceId,
    },
    reconnection: true,
    reconnectionAttempts:
      socketIO.reconnectionAttempts > 0 ? socketIO.reconnectionAttempts : Infinity,
    reconnectionDelay: socketIO.reconnectionDelay,
    timeout: socketIO.timeout,
    autoConnect: false,
  };
  if (server.path) {
    options.path = `${server.path}/socket.io`;
  }
  return options;
}
