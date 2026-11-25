/**
 * 真实服务端连接冒烟测试：读取 config.yaml，用 LocalAgent 连接云端，
 * 打印 connect / connectSuccess 参数和收到的事件，然后在 N 秒后断开。
 *
 * - 不注册任何任务处理器，不回 ack，不上传数据；
 * - 输出中的 token / agentId 会被打码。
 *
 * 运行：node scripts/local-agent-smoke.mjs <config.yaml> [秒数，默认 20，最多 30]
 *
 * `--excel <样例文件>` 模式（云连接冒烟，最多 60 秒）：
 * - 只把这个样例文件作为一个独立数据源注册（source/all systemStarted + agent_cmd cdcTables）；
 * - 只应答这个数据源的 table_structure / table_rowcount / table_content_s3 预览，
 *   其它数据源的请求忽略不回；
 * - 不注册 table_content_s3_dispatch，不上传任何数据。
 */
import path from 'node:path';

import { loadLocalAgentConfig } from '../config';
import { LocalExcelSource } from '../excel/local-excel-source';
import { ExcelSourceHandlers } from '../handlers/excel-source-handlers';
import { LocalAgent } from '../local-agent';
import type { LocalAgentLogger } from '../logger';

export async function runSmoke(rawArgv: string[]): Promise<number> {
  const argv = [...rawArgv];
  const excelIdx = argv.indexOf('--excel');
  const excelFile = excelIdx >= 0 ? argv.splice(excelIdx, 2)[1] : undefined;
  const sourceIdx = argv.indexOf('--source');
  const excelSourceName = sourceIdx >= 0 ? argv.splice(sourceIdx, 2)[1] : '九思助理云连接冒烟测试';
  const configPath = argv[0];
  if (!configPath || (excelIdx >= 0 && !excelFile)) {
    console.error(
      'usage: local-agent-smoke [--excel <file.xlsx> [--source <name>]] <config.yaml> [seconds]'
    );
    return 2;
  }
  const maxSeconds = excelFile ? 60 : 30;
  const seconds = Math.min(maxSeconds, Math.max(1, Number(argv[1] ?? 20) || 20));
  const config = await loadLocalAgentConfig(configPath);
  const secrets = [config.server.token, config.server.agentId].filter((s) => s && s.length >= 6);
  const redact = (text: string) =>
    secrets.reduce(
      (acc, s) =>
        acc.split(s).join(s === config.server.token ? '<token>' : `${s.slice(0, 4)}…<agentId>`),
      text
    );
  const t0 = Date.now();
  const out = (level: string, args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
      .join(' ');
    console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${level} ${redact(text)}`);
  };
  const logger: LocalAgentLogger = {
    info: (...a) => out('INFO ', a),
    warn: (...a) => out('WARN ', a),
    error: (...a) => out('ERROR', a),
  };
  const agent = new LocalAgent(config, {
    version: process.env.LOCAL_AGENT_VERSION || '4.0',
    logger,
    registerDefaultHandlers: false,
    aliveLogIntervalMs: 0,
  });
  if (excelFile) {
    const source = new LocalExcelSource({
      sourceName: excelSourceName,
      files: [path.resolve(excelFile)],
    });
    const tables = await source.listTables();
    logger.info(
      `excel source "${excelSourceName}": ${tables.map((t) => t.id).join(', ')} (sync upload disabled)`
    );
    new ExcelSourceHandlers(agent, {
      registry: {
        get: (n) => (n === excelSourceName ? source : undefined),
        all: () => [source],
      },
      logger,
      enableSync: false,
      allowSource: (n) => n === excelSourceName,
      ignoreDisallowedSources: true,
      observer: (e) =>
        logger.info(
          `[excel] ${e.type} ${e.event}${e.tableName ? ` table=${e.tableName}` : ''}${e.messageId ? ` msg=${e.messageId}` : ''}${e.detail ? ` ${e.detail}` : ''}`
        ),
    }).attach();
  }
  let gotConnectSuccess = false;
  agent.on('state', (s) => logger.info(`state -> ${s}`));
  agent.on('connectSuccess', (env) => {
    gotConnectSuccess = true;
    logger.info('connectSuccess env', env);
  });
  agent.on('connectError', (m) => logger.error(`connectErrorMessage: ${m}`));
  agent.on('offline', () => logger.warn('server sent offline'));
  agent.start();
  const socket = agent.connection.getSocket();
  socket?.onAny((event: string, ...args: unknown[]) => {
    const expectsAck = typeof args[args.length - 1] === 'function';
    const shown = JSON.stringify(args.filter((a) => typeof a !== 'function'));
    logger.info(
      `EVENT ${event}${expectsAck ? ' (expects ack, NOT answered)' : ''} ${shown.length > 300 ? shown.slice(0, 300) + '…' : shown}`
    );
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  logger.info(
    `closing after ${seconds}s, connected=${agent.connection.connected}, transport=${socket?.io.engine?.transport?.name}, connectSuccess=${gotConnectSuccess}`
  );
  agent.stop();
  return gotConnectSuccess ? 0 : 1;
}
