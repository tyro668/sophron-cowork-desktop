/**
 * 本模块自带的最小日志接口。模块本身不直接依赖 Electron，
 * 方便在单测和命令行冒烟脚本里运行；在主进程里用 `createAppLocalAgentLogger()`
 * 接入应用统一日志。
 */
export interface LocalAgentLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const PREFIX = '[LocalAgent]';

export const consoleLocalAgentLogger: LocalAgentLogger = {
  info: (...args) => console.log(PREFIX, ...args),
  warn: (...args) => console.warn(PREFIX, ...args),
  error: (...args) => console.error(PREFIX, ...args),
};

export const silentLocalAgentLogger: LocalAgentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** 去掉 URL 查询串（预签名签名、token 等）后再写日志。 */
export function redactUrl(url: string | undefined): string {
  if (!url) return String(url);
  const idx = url.indexOf('?');
  return idx >= 0 ? `${url.slice(0, idx)}?<redacted>` : url;
}
