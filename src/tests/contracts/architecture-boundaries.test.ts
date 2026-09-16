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

describe('entrypoint shape', () => {
  it('main/index.ts stays a thin composition root (no IPC handlers)', () => {
    const src = fs.readFileSync(path.join(SRC, 'main/index.ts'), 'utf8');
    expect(src).not.toMatch(/\bipcMain\.(handle|on)\b/);
    expect(src).not.toMatch(/\bhandleIpc\s*\(/);
    expect(src).not.toMatch(/\bBrowserWindow\b/);
  });

  it('preload/index.ts is a thin composition layer checked against ElectronApi', () => {
    const src = fs.readFileSync(path.join(SRC, 'preload/index.ts'), 'utf8');
    expect(src).toMatch(/\bsatisfies\s+ElectronApi\b/);
    expect(src).not.toMatch(/\binterface\s+Window\b|\bdeclare\s+global\b/);
  });

  it('Window.electronAPI is declared once in preload/electron-api.d.ts', () => {
    const dts = path.join(SRC, 'preload/electron-api.d.ts');
    expect(fs.existsSync(dts)).toBe(true);
    expect(fs.readFileSync(dts, 'utf8')).toMatch(/electronAPI\s*:\s*ElectronApi/);
  });
});

describe('data store layering', () => {
  const DATA_STORE = path.join(SRC, 'main/data/store');

  it('repositories and services never use class inheritance', () => {
    const offenders: string[] = [];
    for (const dir of ['repositories', 'services']) {
      for (const file of walk(path.join(DATA_STORE, dir))) {
        if (/class\s+\w+\s+extends\s+/.test(fs.readFileSync(file, 'utf8'))) {
          offenders.push(path.relative(SRC, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('data-task-store.ts is a composition facade (no extends, no SQL)', () => {
    const src = fs.readFileSync(path.join(SRC, 'main/data/data-task-store.ts'), 'utf8');
    expect(src).not.toMatch(/class\s+DataTaskStore\s+extends/);
    expect(src).not.toMatch(/\bmetaRunSql|\bmetaQueryRows|\brunSql|\bqueryRows/);
  });

  it('repositories do not execute workflows or compile operator SQL', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(DATA_STORE, 'repositories'))) {
      const src = fs.readFileSync(file, 'utf8');
      if (/COMPILE_STRATEGIES|compileWorkflowNodeSql|runWorkflowIntoTaskOutput/.test(src)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('operator registry shape', () => {
  const FORMS_DIR = path.join(SRC, 'renderer/components/workflow-forms');

  it('workflow form components import OperatorFormProps from ./types, not the barrel', () => {
    const offenders: string[] = [];
    for (const file of walk(FORMS_DIR)) {
      const name = path.basename(file);
      if (!/^Form.+\.tsx$/.test(name)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (/from\s+['"]\.\/index['"]/.test(src)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('workflow-forms/index.ts stays a barrel (no loader map, no interface Props)', () => {
    const src = fs.readFileSync(path.join(FORMS_DIR, 'index.ts'), 'utf8');
    expect(src).not.toMatch(/OPERATOR_FORM_LOADERS|import\('\.\/Form/);
    expect(src).not.toMatch(/interface\s+OperatorFormProps/);
  });

  it('the operator union is derived from the registry (no duplicate literal union)', () => {
    const src = fs.readFileSync(path.join(SRC, 'shared/data-workflow-types.ts'), 'utf8');
    expect(src).not.toMatch(/'input_source'\s*\|/);
    expect(src).toMatch(/operators\/definition/);
  });
});
