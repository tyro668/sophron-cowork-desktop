#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { getBrandList, normalizeBrandId } = require('./sophron-brand.cjs');

const PROJECT_ROOT = path.join(__dirname, '..');

function resolveNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function resolveNpxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[build:brands] Failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const rawArgs = process.argv.slice(2);
const firstArg = rawArgs[0] && !rawArgs[0].startsWith('-') ? rawArgs[0] : 'all';
const variantArg = normalizeBrandId(firstArg);
const builderArgs = rawArgs[0] && !rawArgs[0].startsWith('-') ? rawArgs.slice(1) : rawArgs;
const brands = getBrandList(variantArg);
const npm = resolveNpmCommand();
const npx = resolveNpxCommand();

run(npm, ['run', 'download:node']);
run(npm, ['run', 'prepare:gui-tools']);
run(npm, ['run', 'prepare:python:all']);
run(npm, ['run', 'build:wsl-agent']);
run(npm, ['run', 'build:lima-agent']);
run(npm, ['run', 'build:mcp']);
run(npx, ['tsc']);
run(npx, ['vite', 'build', '--config', 'vite.config.ts']);
run('node', ['scripts/pre-build-check.js']);

for (const brand of brands) {
  console.log(
    `[build:brands] Packaging ${brand.id}: productName="${brand.productName}", artifact="${brand.artifactName}"`
  );
  run(npx, ['electron-builder', '--config', 'electron-builder.config.cjs', ...builderArgs], {
    env: {
      ...process.env,
      SOPHRON_BUILD_VARIANT: brand.id,
    },
  });
}
