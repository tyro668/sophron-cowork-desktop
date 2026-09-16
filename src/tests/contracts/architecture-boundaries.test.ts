/**
 * Architecture boundary enforcement.
 *
 * Dependency rules (checked by scanning import specifiers in source):
 *   - src/main/** and src/preload/** must never import from renderer/.
 *   - src/shared/** must never import from main/, renderer/, or preload/.
 *   - src/renderer/** must never import from main/ or preload/.
 *
 * Cross-process contracts live in src/shared/contracts/. Renderer files may
 * still import '../types' (a re-export barrel); main/preload must not.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

/** True when a specifier escapes the given tree: '../x' hops up to src/, or alias. */
function referencesTopLevel(specifier: string, topDir: string): boolean {
  if (specifier.startsWith(`@/${topDir}/`) || specifier.startsWith(`@${topDir}/`)) return true;
  if (!specifier.startsWith('.')) return false;
  const segs = specifier.split('/');
  // any number of leading '..' followed by the forbidden top-level dir name
  const i = segs.findIndex((s) => s !== '..');
  return i > 0 && segs[i] === topDir;
}

function violations(dir: string, forbidden: Array<'main' | 'renderer' | 'preload'>): string[] {
  const out: string[] = [];
  for (const file of walk(path.join(SRC, dir))) {
    for (const spec of importsOf(file)) {
      for (const top of forbidden) {
        if (referencesTopLevel(spec, top)) {
          out.push(`${path.relative(SRC, file)} -> ${spec}`);
        }
      }
    }
  }
  return out;
}

describe('process boundaries', () => {
  it('main/ never imports from renderer/', () => {
    expect(violations('main', ['renderer'])).toEqual([]);
  });

  it('preload/ never imports from renderer/', () => {
    expect(violations('preload', ['renderer'])).toEqual([]);
  });

  it('shared/ never imports from main/, renderer/, or preload/', () => {
    expect(violations('shared', ['main', 'renderer', 'preload'])).toEqual([]);
  });

  it('renderer/ never imports from main/ or preload/', () => {
    expect(violations('renderer', ['main', 'preload'])).toEqual([]);
  });

  it('contracts barrel exists and domain dirs are present', () => {
    const contracts = path.join(SRC, 'shared/contracts');
    for (const d of ['config', 'session', 'data', 'ipc', 'remote']) {
      expect(fs.existsSync(path.join(contracts, d, 'index.ts')), `missing contracts/${d}`).toBe(
        true
      );
    }
  });
});
