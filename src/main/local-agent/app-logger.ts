import { log, logError, logWarn } from '../utils/logger';
import type { LocalAgentLogger } from './logger';

/** 把本地宝模块的日志接到应用统一日志（仅主进程使用）。 */
export function createAppLocalAgentLogger(): LocalAgentLogger {
  return {
    info: (...args) => log('[LocalAgent]', ...args),
    warn: (...args) => logWarn('[LocalAgent]', ...args),
    error: (...args) => logError('[LocalAgent]', ...args),
  };
}
