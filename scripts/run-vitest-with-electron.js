/**
 * Run Vitest with Electron's embedded Node runtime.
 *
 * Native dependencies are rebuilt for Electron during postinstall, so running
 * tests with the host Node process can fail with a NODE_MODULE_VERSION
 * mismatch. ELECTRON_RUN_AS_NODE keeps the Electron ABI without opening a GUI.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveVitestCli() {
  const packagePath = require.resolve('vitest/package.json');
  return path.join(path.dirname(packagePath), 'vitest.mjs');
}

function run() {
  const electronPackagePath = require.resolve('electron/package.json');
  const electronCliPath = path.join(path.dirname(electronPackagePath), 'cli.js');
  const vitestPath = resolveVitestCli();

  if (!fs.existsSync(electronCliPath)) {
    throw new Error(`Electron CLI not found: ${electronCliPath}`);
  }
  if (!fs.existsSync(vitestPath)) {
    throw new Error(`Vitest CLI not found: ${vitestPath}`);
  }

  // Use Electron's CLI wrapper instead of spawning the binary directly. The
  // wrapper forwards Vitest's exit code and termination signals consistently.
  const result = spawnSync(
    process.execPath,
    [electronCliPath, vitestPath, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    console.error(`Vitest terminated by signal: ${result.signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

try {
  run();
} catch (error) {
  console.error('[test:electron] Failed to start Vitest:', error?.stack || error);
  process.exitCode = 1;
}
