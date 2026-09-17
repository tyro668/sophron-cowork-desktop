import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const buildScript = readFileSync(path.resolve(process.cwd(), 'scripts/build-brands.js'), 'utf8');
const rootTsconfig = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'tsconfig.json'), 'utf8')
) as { files?: unknown[]; references?: unknown[] };

describe('formal build type checking', () => {
  it('type-checks the project-reference solution with tsc -b', () => {
    // The root tsconfig is a solution file (files: [] + references), so a bare
    // `tsc` checks zero files. The build must use `tsc -b` to actually walk
    // the project references.
    expect(rootTsconfig.files).toEqual([]);
    expect(Array.isArray(rootTsconfig.references)).toBe(true);
    expect(buildScript).toMatch(/run\(npx,\s*\[\s*'tsc',\s*'-b'\s*\]\)/);
    expect(buildScript).not.toMatch(/run\(npx,\s*\[\s*'tsc'\s*\]\)/);
  });

  it('builds vite bundles from the maintained TypeScript config', () => {
    expect(buildScript).toContain('vite.config.ts');
    expect(existsSync(path.resolve(process.cwd(), 'vite.config.ts'))).toBe(true);
  });
});
