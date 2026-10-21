import { homedir } from 'os';
import { isAbsolute, resolve } from 'path';

/**
 * Hard guard (independent of permission mode) that keeps agent tools away
 * from the app's own internal storage: the SQLite metadata DB (cowork.db),
 * DuckDB workspace files, raw-table normalizer artifacts and app config.
 * Agents must go through the data_* tools, which validate inputs and keep the
 * metadata consistent.
 */

export const APP_DATA_GUARD_REASON =
  "Blocked: direct access to the app's internal data store (cowork.db, DuckDB files, " +
  'the app data directory or app config files) is not allowed — editing it bypasses validation ' +
  'and can corrupt pipelines and tables. Use the official data tools instead, e.g. ' +
  'data_create_pipeline to create a pipeline, data_apply_workflow_plan to define its nodes, ' +
  'data_run_pipeline to run it and data_preview_table to read results.';

const WRITE_TOOLS = new Set(['write', 'edit', 'write_file', 'edit_file', 'create_file']);
const COMMAND_TOOLS = new Set(['bash', 'shell', 'execute_command', 'run_command', 'exec_command']);
const CONFIG_FILES = [
  'config.json',
  'desktop-auth.json',
  'mcp-config.json',
  'remote-config.json',
  'plugin-registry.json',
];
const DB_FILE = /(?:^|[\\/'"\s=(])(?:cowork\.db|workspace\.duckdb)(?:-wal|-shm|-journal|\.wal)?\b/i;

export interface AppDataGuardOptions {
  /** Electron userData directory (e.g. ~/.config/sophron). */
  userDataDir: string;
  /** Current working directory for relative paths. */
  cwd?: string;
  /** Home directory used to recognise ~/ and $HOME/ forms (defaults to os.homedir()). */
  homeDir?: string;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function isProtectedAppDataPath(target: string, options: AppDataGuardOptions): boolean {
  if (!target.trim()) return false;
  const root = norm(resolve(options.userDataDir));
  const abs = norm(isAbsolute(target) ? resolve(target) : resolve(options.cwd ?? root, target));
  if (DB_FILE.test('/' + abs.split('/').pop())) return true;
  if (
    /\.(?:duckdb|db|sqlite3?)(?:-wal|-shm|-journal|\.wal)?$/i.test(abs) &&
    abs.startsWith(root + '/')
  ) {
    return true;
  }
  if (abs === `${root}/data` || abs.startsWith(`${root}/data/`)) return true;
  return CONFIG_FILES.some((file) => abs === `${root}/${file}`);
}

function commandTouchesAppData(command: string, options: AppDataGuardOptions): boolean {
  if (DB_FILE.test(command)) return true;
  const root = norm(resolve(options.userDataDir));
  const text = norm(command.replace(/\\/g, '/'));
  const roots = [root];
  const home = norm(options.homeDir ?? homedir());
  if (home && root.startsWith(home + '/'))
    roots.push('~' + root.slice(home.length), '$HOME' + root.slice(home.length));
  for (const r of roots) {
    let index = text.indexOf(r);
    while (index !== -1) {
      const rest = text.slice(index + r.length);
      // Paths into the user's working directory (DefaultWorkingDir, memory, …) stay allowed;
      // the app data dir itself, its data/ folder and config files do not.
      if (/^\/data(?:\/|\b)/.test(rest)) return true;
      if (CONFIG_FILES.some((file) => rest.startsWith('/' + file))) return true;
      index = text.indexOf(r, index + r.length);
    }
  }
  // Relative access after cd-ing into (or running from) the app data dir.
  const cwd = options.cwd ? norm(resolve(options.cwd)) : '';
  if (
    (cwd === root || roots.some((r) => text.includes(r))) &&
    /(?:^|[\s'"=(])\.?\/?data\/(?:cowork|workspace|raw-table-normalizers|cloud-imports)/.test(text)
  )
    return true;
  return false;
}

/** Returns a block reason if the tool call targets protected app storage, else null. */
export function checkAppDataAccess(
  toolName: string,
  input: Record<string, unknown>,
  options: AppDataGuardOptions
): string | null {
  const name = toolName.toLowerCase();
  if (WRITE_TOOLS.has(name)) {
    const target = input.path ?? input.file_path ?? input.filePath;
    if (typeof target === 'string' && isProtectedAppDataPath(target, options)) {
      return APP_DATA_GUARD_REASON;
    }
    return null;
  }
  if (name === 'apply_patch') {
    const patch = input.patch ?? input.input;
    if (typeof patch !== 'string') return null;
    for (const match of patch.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+)$/gm
    )) {
      if (isProtectedAppDataPath(match[1].trim(), options)) return APP_DATA_GUARD_REASON;
    }
    return null;
  }
  if (COMMAND_TOOLS.has(name)) {
    const command = input.command ?? input.cmd ?? input.script;
    const text = Array.isArray(command) ? command.join(' ') : command;
    if (typeof text === 'string' && commandTouchesAppData(text, options))
      return APP_DATA_GUARD_REASON;
  }
  return null;
}

let cachedUserDataDir: string | null | undefined;

/** Electron userData dir, resolved lazily so pure unit tests need no electron. */
export function resolveAppUserDataDir(): string | null {
  if (cachedUserDataDir !== undefined) return cachedUserDataDir;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath?: (name: string) => string } };
    cachedUserDataDir = electron.app?.getPath?.('userData') ?? null;
  } catch {
    cachedUserDataDir = null;
  }
  return cachedUserDataDir;
}
