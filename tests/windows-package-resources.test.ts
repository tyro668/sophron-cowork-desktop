import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const config = require('../electron-builder.config.cjs');

it('packages existing built-in skills with the production config on every platform', () => {
  for (const platform of ['win', 'mac', 'linux']) {
    const resource = config[platform].extraResources.find(
      (item: { to: string }) => item.to === 'skills'
    );
    expect(resource.from).toBe('assets/skills');
    expect(fs.statSync(path.resolve(resource.from)).isDirectory()).toBe(true);
  }
});

it('ships the Windows Node runtime, WSL agent and unpacked native binaries', () => {
  expect(config.win.target).toContainEqual({ target: 'nsis', arch: ['x64'] });
  expect(config.win.extraResources).toEqual(
    expect.arrayContaining([
      { from: 'resources/node/win32-x64', to: 'node' },
      { from: 'dist-wsl-agent', to: 'wsl-agent' },
    ])
  );
  expect(config.asarUnpack).toEqual(
    expect.arrayContaining([
      'node_modules/@duckdb/**/*.node',
      'node_modules/@duckdb/**/*.dll',
      'node_modules/better-sqlite3/**/*.node',
    ])
  );
});
