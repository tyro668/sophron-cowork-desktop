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

/** One import edge: target specifier + whether the statement is type-only. */
const IMPORT_STMT_RE =
  /\b(?:import|export)\s+(type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function runtimeImportsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_STMT_RE)) {
    const spec = m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    let typeOnly = Boolean(m[1]);
    if (!typeOnly && m[0].startsWith('import ') === false && m[0].startsWith('export ') === false) {
      // dynamic import() — always a runtime edge
    } else if (!typeOnly) {
      const named = m[0].match(/\{([\s\S]*?)\}/);
      const rest = m[0].replace(/\{[\s\S]*?\}/, '');
      if (
        named &&
        /^[\s]*(import|export)[\s\S]*from/.test(rest) &&
        !rest
          .replace(/^\s*(import|export)\s*/, '')
          .replace(/from\s*['"][^'"]+['"]\s*;?\s*$/, '')
          .trim()
      ) {
        typeOnly = named[1].split(',').every((s) => /^\s*type\s/.test(s));
      }
    }
    if (!typeOnly) specs.push(spec);
  }
  return specs;
}

const RESOLVE_EXTS = ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) {
    if (spec.startsWith('@/')) spec = `./${spec.slice(2)}`;
    else if (spec.startsWith('@main/')) spec = `./main/${spec.slice(6)}`;
    else if (spec.startsWith('@renderer/')) spec = `./renderer/${spec.slice(10)}`;
    else return null;
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of RESOLVE_EXTS) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  }
  return null;
}

/**
 * Runtime (non-`import type`) module cycles under src/. Type-only edges erase
 * at compile time and are allowed; real cycles are not — they make module init
 * order load-bearing and defeat layering. The two sandbox entries are an
 * intentional lazy boundary: the bridges reach the bootstrap singleton via
 * `await import()` so the edge never initializes eagerly.
 */
const ALLOWED_RUNTIME_CYCLE_EDGES = new Set([
  'main/sandbox/wsl-bridge.ts -> main/sandbox/sandbox-bootstrap.ts',
  'main/sandbox/lima-bridge.ts -> main/sandbox/sandbox-bootstrap.ts',
]);

function runtimeImportCycles(): string[] {
  const files = walk(SRC).filter((f) => !f.endsWith('.d.ts'));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    graph.set(
      file,
      runtimeImportsOf(file)
        .map((spec) => resolveImport(file, spec))
        .filter((r): r is string => Boolean(r))
        .filter(
          (r) =>
            !ALLOWED_RUNTIME_CYCLE_EDGES.has(
              `${path.relative(SRC, file)} -> ${path.relative(SRC, r)}`
            )
        )
    );
  }
  const color = new Map<string, 0 | 1 | 2>();
  const cycles = new Set<string>();
  const stack: string[] = [];
  const dfs = (u: string): void => {
    color.set(u, 1);
    stack.push(u);
    for (const v of graph.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 0) dfs(v);
      else if (c === 1) {
        const i = stack.indexOf(v);
        cycles.add([...stack.slice(i), v].map((x) => path.relative(SRC, x)).join(' -> '));
      }
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const file of files) {
    if (!color.get(file)) dfs(file);
  }
  return [...cycles];
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

  it('Window.electronAPI is declared once in shared/contracts/electron-api.d.ts', () => {
    // The bridge global is a shared contract: preload implements it, renderer
    // consumes it — so the declaration lives in contracts/, not in preload/.
    const dts = path.join(SRC, 'shared/contracts/electron-api.d.ts');
    expect(fs.existsSync(dts)).toBe(true);
    expect(fs.readFileSync(dts, 'utf8')).toMatch(/electronAPI\s*:\s*ElectronApi/);
  });

  it('gui-operate-server.ts stays a thin MCP adapter over gui-operate/*', () => {
    const src = fs.readFileSync(path.join(SRC, 'main/mcp/gui-operate-server.ts'), 'utf8');
    // The entry owns tool schemas + request dispatch only; platform adapters,
    // vision, planner, and click history live in mcp/gui-operate/*.
    expect(src).toMatch(/from '\.\/gui-operate\//);
    expect(src).not.toMatch(/\bwindowsPerform|\bcallVisionAPI|\bperformMacClickViaQuartz\b/);
    expect(src).not.toMatch(/\bfunction\s+(performClick|takeScreenshot|planGUIActions)\b/);
  });

  it('gui-operate modules keep the one-directional layering', () => {
    const dir = path.join(SRC, 'main/mcp/gui-operate');
    const layerRank = (file: string): number => {
      const name = path.basename(file, '.ts');
      if (name === 'types' || name === 'app-aliases') return 0;
      if (name === 'env') return 1;
      if (name === 'windows') return 2;
      if (name === 'display') return 3;
      if (name === 'macos') return 4;
      if (name === 'click-history') return 5;
      if (name === 'actions') return 6;
      if (name === 'vision') return 7;
      if (name === 'planner') return 8;
      return 8;
    };
    const offenders: string[] = [];
    for (const file of walk(dir)) {
      const rank = layerRank(file);
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from '\.\/([a-z-]+)\.js'/g)) {
        const dep = path.join(dir, `${match[1]}.ts`);
        if (fs.existsSync(dep) && layerRank(dep) >= rank) {
          offenders.push(`${path.relative(SRC, file)} -> ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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

  it('metadata schema DDL lives only in the migration layer', () => {
    // Repositories own row access; CREATE/ALTER/INDEX belong in
    // store/migrations.ts so schema changes are versioned and auditable.
    const offenders: string[] = [];
    for (const file of walk(path.join(DATA_STORE, 'repositories'))) {
      const src = fs.readFileSync(file, 'utf8');
      if (/\bCREATE\s+(TABLE|INDEX)|\bALTER\s+TABLE/i.test(src)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    // The context keeps only the physical-table helper (`CREATE TABLE ... AS
    // SELECT`) and the `ensureMetadataColumn` primitive used by migrations —
    // no metadata-table DDL.
    const ctxSrc = fs.readFileSync(path.join(DATA_STORE, 'data-store-context.ts'), 'utf8');
    if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|CREATE\s+INDEX/i.test(ctxSrc)) {
      offenders.push('main/data/store/data-store-context.ts');
    }
    expect(offenders).toEqual([]);
  });
});

describe('module cycle detection', () => {
  it('src/ has no runtime import cycles outside documented lazy boundaries', () => {
    expect(runtimeImportCycles()).toEqual([]);
  });
});

describe('renderer data feature layering', () => {
  const DATA_FEATURE = path.join(SRC, 'renderer/features/data');
  const ADAPTER = path.join(DATA_FEATURE, 'api/data-client.ts');

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  function electronApiTouches(dir: string, allowFile?: string): string[] {
    const offenders: string[] = [];
    for (const file of walk(dir)) {
      if (allowFile && file === allowFile) continue;
      if (/\belectronAPI\b/.test(stripComments(fs.readFileSync(file, 'utf8')))) {
        offenders.push(path.relative(SRC, file));
      }
    }
    return offenders;
  }

  it('features/data code never touches window.electronAPI outside api/data-client.ts', () => {
    expect(electronApiTouches(DATA_FEATURE, ADAPTER)).toEqual([]);
  });

  it('data-view components go through the dataClient adapter, not the bridge', () => {
    const offenders = electronApiTouches(path.join(SRC, 'renderer/components/data-view')).concat(
      electronApiTouches(path.join(SRC, 'renderer/components/workflow-forms'))
    );
    expect(offenders).toEqual([]);
  });

  it('features/data/model stays pure types (no component or IPC imports)', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(DATA_FEATURE, 'model'))) {
      for (const spec of importsOf(file)) {
        if (/components|api\/data-client|electron-api/.test(spec)) {
          offenders.push(`${path.relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('DataView.tsx stays a thin re-export of the feature page', () => {
    const src = fs.readFileSync(path.join(SRC, 'renderer/components/DataView.tsx'), 'utf8');
    expect(src).not.toMatch(/\belectronAPI\b|\buseState\b|\buseEffect\b/);
    expect(src).toMatch(/features\/data\/pages\/DataViewPage/);
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
