#!/usr/bin/env node
/**
 * 本地宝云端连接冒烟测试。先用 esbuild 把 src/main/local-agent/cli/smoke.ts 打包到 node_modules/.cache，再运行。
 * 用法：node scripts/local-agent-smoke.mjs <config.yaml> [seconds<=30]
 * token 可用环境变量 LOCAL_AGENT_TOKEN 覆盖；输出会对 token/agentId 打码。
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  // packages: 'external' 需要能从仓库解析依赖，所以把产物放回仓库的 node_modules/.cache 下运行
  const runFile = path.join(root, 'node_modules/.cache/local-agent-smoke.mjs');
  rmSync(runFile, { force: true });
  await build({
    entryPoints: [path.join(root, 'src/main/local-agent/cli/smoke.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: runFile,
    packages: 'external',
    logLevel: 'error',
    absWorkingDir: root,
  });
  const mod = await import(pathToFileURL(runFile).href);
  const code = await mod.runSmoke(process.argv.slice(2));
  setTimeout(() => process.exit(code), 300);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
