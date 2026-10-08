import { it, expect } from 'vitest';
import { build } from 'vite';
import { builtinModules } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { piSdkResolve } from '../scripts/pi-sdk-resolve';

it('derives Codex auth in a standalone CJS bundle without missing relative OAuth imports', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'pi-oauth-bundle-'));
  try {
    await build({
      configFile: false,
      resolve: piSdkResolve,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: resolve('tests/fixtures/pi-oauth-bundle.ts'),
          formats: ['cjs'],
          fileName: () => 'smoke.cjs',
        },
        rolldownOptions: {
          platform: 'node',
          external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
        },
      },
    });
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        'require(process.argv[1]).verifyBundledOAuth().then(() => console.log("ok"))',
        join(outDir, 'smoke.cjs'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          PI_CODING_AGENT_DIR: join(outDir, 'agent'),
        },
      }
    );
    expect(output.trim()).toBe('ok');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 30000);
