import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import {
  scriptManifestSchema,
  type ScriptManifest,
  type ScriptPackagePending,
  type ScriptPackageRunInfo,
  type ScriptPackageSummary,
  type ScriptTestRunResult,
} from '../../../shared/automation/script-package';
import { failureReason, runProcess, type ProcessResult } from './process';
import { readScriptOutput, type ParsedScriptOutput } from './output';

/** App-owned folder inside each package: deps state, last good output, AI drafts. */
export const STATE_DIR = '.sophron';
const PENDING_DIR = 'pending';
const RUNTIME_DIRS = new Set([STATE_DIR, '.venv', 'node_modules', '__pycache__', '.git']);
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PACKAGE_ID_PATTERN = /^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,79}$/;

interface PackageState {
  depsHash?: string;
  runtimeVersion?: string;
  lastSuccess?: ScriptPackageRunInfo;
  lastError?: { at: number; message: string };
  pending?: ScriptPackagePending;
}

export interface ScriptRunOutput extends ParsedScriptOutput {
  /** Stable copy of the last successful output (imported into the raw table). */
  csvPath: string;
  durationMs: number;
  installedDeps: boolean;
  log: string;
}

export class ScriptPackageError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'deps' | 'timeout' | 'script' | 'output',
    /** Tail of the process output, for the AI / test-run details. */
    readonly log?: string
  ) {
    super(message);
  }
}

export interface ScriptPackageServiceOptions {
  rootDir: string;
  now?: () => number;
  /** Override interpreters (tests). */
  python?: { command: string; args: string[] };
  node?: { command: string; env?: NodeJS.ProcessEnv };
  npmCommand?: string;
}

export class ScriptPackageService {
  readonly rootDir: string;
  private readonly now: () => number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: ScriptPackageServiceOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? (() => Date.now());
  }

  packageDir(id: string): string {
    if (!PACKAGE_ID_PATTERN.test(id))
      throw new ScriptPackageError(`脚本包名称无效：${id}`, 'invalid');
    return path.join(this.rootDir, id);
  }

  async list(): Promise<ScriptPackageSummary[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const result: ScriptPackageSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PACKAGE_ID_PATTERN.test(entry.name)) continue;
      if (!existsSync(path.join(this.rootDir, entry.name, 'manifest.json'))) continue;
      result.push(await this.summary(entry.name));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async summary(id: string): Promise<ScriptPackageSummary> {
    const dir = this.packageDir(id);
    const state = await this.readState(dir);
    let manifest: ScriptManifest;
    try {
      manifest = await this.readManifest(dir);
    } catch (error) {
      return {
        id,
        name: id,
        dir,
        entry: '',
        runtime: 'python',
        depsReady: false,
        invalid: error instanceof Error ? error.message : String(error),
      };
    }
    const depsFile = depsFileFor(manifest, dir);
    const depsHash = await this.depsHash(dir, manifest);
    return {
      id,
      name: manifest.name,
      description: manifest.description,
      dir,
      entry: manifest.entry,
      runtime: manifest.runtime,
      runtimeVersion: state.runtimeVersion,
      depsFile,
      depsReady: !depsFile || (state.depsHash === depsHash && this.depsInstalled(dir, manifest)),
      lastSuccess: state.lastSuccess,
      lastError: state.lastError,
      pending: state.pending && existsSync(this.pendingDir(dir)) ? state.pending : undefined,
    };
  }

  /** Dry run: installs deps if needed and runs the entry; nothing is imported. */
  async testRun(
    id: string,
    options: { timeoutMs: number; pending?: boolean }
  ): Promise<ScriptTestRunResult> {
    const startedAt = this.now();
    try {
      const output = await this.run(id, { ...options, dryRun: true });
      return {
        ok: true,
        rows: output.rows,
        columns: output.columns,
        durationMs: output.durationMs,
        installedDeps: output.installedDeps,
        preview: output.csv.split(/\r?\n/).slice(0, 6).join('\n'),
        log: output.log,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: this.now() - startedAt,
        installedDeps: false,
        log: error instanceof ScriptPackageError ? error.log : undefined,
      };
    }
  }

  /**
   * Install deps when missing or changed, run the entry with a timeout and validate the output.
   * Only a successful real run replaces the stable output file, so failures keep the old data.
   */
  run(
    id: string,
    options: { timeoutMs: number; dryRun?: boolean; pending?: boolean }
  ): Promise<ScriptRunOutput> {
    return this.withLock(id, () => this.runUnlocked(id, options));
  }

  private async runUnlocked(
    id: string,
    options: { timeoutMs: number; dryRun?: boolean; pending?: boolean }
  ): Promise<ScriptRunOutput> {
    const packageDir = this.packageDir(id);
    if (!existsSync(path.join(packageDir, 'manifest.json'))) {
      throw new ScriptPackageError(`找不到脚本包：${id}`, 'invalid');
    }
    const dir = options.pending ? this.pendingDir(packageDir) : packageDir;
    if (options.pending && !existsSync(dir)) {
      throw new ScriptPackageError('没有待确认的新版本', 'invalid');
    }
    const manifest = await this.readManifest(dir).catch((error: unknown) => {
      throw new ScriptPackageError(
        `manifest.json 无效：${error instanceof Error ? error.message : String(error)}`,
        'invalid'
      );
    });
    const entryPath = path.join(dir, manifest.entry);
    if (!existsSync(entryPath)) {
      throw new ScriptPackageError(`入口文件不存在：${manifest.entry}`, 'invalid');
    }
    const installedDeps = await this.ensureDeps(
      dir,
      manifest,
      options.pending ? undefined : packageDir
    );
    const runDir = path.join(packageDir, STATE_DIR, 'runs', String(this.now()));
    await mkdir(runDir, { recursive: true });
    const format = manifest.output?.format ?? 'csv';
    const outputPath = path.join(runDir, `output.${format}`);
    const configPath = path.join(dir, 'config.json');
    const startedAt = this.now();
    try {
      const command = this.entryCommand(dir, manifest, entryPath);
      const result = await runProcess(command.command, command.args, {
        cwd: dir,
        timeoutMs: options.timeoutMs,
        env: {
          ...process.env,
          ...command.env,
          SOPHRON_OUTPUT: outputPath,
          SOPHRON_PACKAGE_DIR: dir,
          SOPHRON_CONFIG: existsSync(configPath) ? configPath : '',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      });
      const durationMs = this.now() - startedAt;
      const log = processLog(result);
      if (result.timedOut) {
        throw new ScriptPackageError(
          `运行超时（${formatTimeout(options.timeoutMs)}）`,
          'timeout',
          log
        );
      }
      if (result.code !== 0) throw new ScriptPackageError(failureReason(result), 'script', log);
      if (!existsSync(outputPath)) {
        throw new ScriptPackageError('脚本没有写出结果文件（SOPHRON_OUTPUT）', 'output', log);
      }
      let parsed: ParsedScriptOutput;
      try {
        parsed = readScriptOutput(
          await readFile(outputPath, 'utf8'),
          format,
          manifest.output?.columns ?? []
        );
      } catch (error) {
        throw new ScriptPackageError(
          error instanceof Error ? error.message : String(error),
          'output',
          log
        );
      }
      const csvPath = path.join(packageDir, STATE_DIR, 'output.csv');
      if (!options.dryRun) {
        await writeFile(csvPath, parsed.csv, 'utf8');
        await this.patchState(packageDir, {
          lastSuccess: { at: this.now(), rows: parsed.rows, durationMs },
          lastError: undefined,
        });
      } else if (!options.pending) {
        await this.patchState(packageDir, {
          lastSuccess: { at: this.now(), rows: parsed.rows, durationMs },
        });
      }
      return { ...parsed, csvPath, durationMs, installedDeps, log };
    } catch (error) {
      if (!options.dryRun && !options.pending) {
        await this.patchState(packageDir, {
          lastError: {
            at: this.now(),
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    } finally {
      await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── deps ──────────────────────────────────────────────────────────────

  private depsInstalled(dir: string, manifest: ScriptManifest): boolean {
    if (manifest.runtime === 'python') return existsSync(venvPython(dir));
    return existsSync(path.join(dir, 'node_modules'));
  }

  private async depsHash(dir: string, manifest: ScriptManifest): Promise<string | undefined> {
    const file = depsFileFor(manifest, dir);
    if (!file) return undefined;
    const content = await readFile(path.join(dir, file), 'utf8');
    return createHash('sha256').update(`${manifest.runtime}\n${content}`).digest('hex');
  }

  /** Returns true when an install ran. `stateDir` is where the deps hash is tracked. */
  private async ensureDeps(
    dir: string,
    manifest: ScriptManifest,
    statePackageDir?: string
  ): Promise<boolean> {
    const hash = await this.depsHash(dir, manifest);
    const stateOwner = statePackageDir ?? dir;
    const state = await this.readState(stateOwner);
    if (!hash) {
      if (!state.runtimeVersion)
        await this.patchState(stateOwner, {
          runtimeVersion: await this.runtimeVersion(dir, manifest),
        });
      return false;
    }
    if (state.depsHash === hash && this.depsInstalled(dir, manifest)) return false;
    const fail = (step: string, result: ProcessResult) => {
      throw new ScriptPackageError(`依赖安装失败（${step}）：${failureReason(result)}`, 'deps');
    };
    if (manifest.runtime === 'python') {
      await rm(path.join(dir, '.venv'), { recursive: true, force: true });
      const python = this.systemPython();
      const venv = await runProcess(python.command, [...python.args, '-m', 'venv', '.venv'], {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (venv.code !== 0) fail('venv', venv);
      const pip = await runProcess(
        venvPython(dir),
        ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'],
        { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS }
      );
      if (pip.code !== 0) fail('pip', pip);
    } else {
      const npm = this.options.npmCommand ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm');
      const install = await runProcess(npm, ['install', '--no-audit', '--no-fund', '--omit=dev'], {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (install.code !== 0) fail('npm', install);
    }
    await this.patchState(stateOwner, {
      depsHash: hash,
      runtimeVersion: await this.runtimeVersion(dir, manifest),
    });
    return true;
  }

  private async runtimeVersion(dir: string, manifest: ScriptManifest): Promise<string | undefined> {
    if (manifest.runtime === 'node') {
      const node = this.nodeCommand();
      const result = await runProcess(node.command, ['--version'], {
        cwd: dir,
        timeoutMs: 15_000,
        env: { ...process.env, ...node.env },
      });
      const match = /v?(\d+)\.\d+/.exec(result.stdout);
      return match ? `Node ${match[1]}` : undefined;
    }
    const python = existsSync(venvPython(dir))
      ? { command: venvPython(dir), args: [] as string[] }
      : this.systemPython();
    const result = await runProcess(python.command, [...python.args, '--version'], {
      cwd: dir,
      timeoutMs: 15_000,
    });
    const match = /Python (\d+\.\d+)/.exec(`${result.stdout}${result.stderr}`);
    return match ? `Python ${match[1]}` : undefined;
  }

  private systemPython(): { command: string; args: string[] } {
    if (this.options.python) return this.options.python;
    return process.platform === 'win32'
      ? { command: 'py', args: ['-3'] }
      : { command: 'python3', args: [] };
  }

  private nodeCommand(): { command: string; env?: NodeJS.ProcessEnv } {
    // Electron's own binary runs plain Node scripts — no system Node required.
    return this.options.node ?? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }

  private entryCommand(
    dir: string,
    manifest: ScriptManifest,
    entryPath: string
  ): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
    if (manifest.runtime === 'node') {
      const node = this.nodeCommand();
      return { command: node.command, args: [entryPath], env: node.env };
    }
    if (existsSync(venvPython(dir))) return { command: venvPython(dir), args: [entryPath] };
    const python = this.systemPython();
    return { command: python.command, args: [...python.args, entryPath] };
  }

  // ── pending AI versions ─────────────────────────────────────────────

  /** `.sophron/pending/<id>`: the folder name doubles as the repair session's project name. */
  pendingDir(packageDir: string): string {
    return path.join(packageDir, STATE_DIR, PENDING_DIR, path.basename(packageDir));
  }

  /** Fresh editable copy of the package for an AI repair; returns its folder. */
  async preparePending(id: string, errorText: string): Promise<string> {
    const dir = this.packageDir(id);
    const pending = this.pendingDir(dir);
    await rm(path.dirname(pending), { recursive: true, force: true });
    await copyPackageFiles(dir, pending);
    await writeFile(path.join(pending, 'LAST_ERROR.txt'), `${errorText}\n`, 'utf8');
    await this.patchState(dir, { pending: undefined });
    return pending;
  }

  async markPending(id: string, pending: ScriptPackagePending): Promise<void> {
    const dir = this.packageDir(id);
    await rm(path.join(this.pendingDir(dir), 'LAST_ERROR.txt'), { force: true });
    await this.patchState(dir, { pending });
  }

  async discardPending(id: string): Promise<void> {
    const dir = this.packageDir(id);
    await this.withLock(id, async () => {
      await rm(path.dirname(this.pendingDir(dir)), { recursive: true, force: true });
      await this.patchState(dir, { pending: undefined });
    });
  }

  /** Replace the active version with the confirmed AI version. */
  async confirmPending(id: string): Promise<ScriptPackageSummary> {
    const dir = this.packageDir(id);
    await this.withLock(id, async () => {
      const pending = this.pendingDir(dir);
      if (!existsSync(pending)) throw new ScriptPackageError('没有待确认的新版本', 'invalid');
      await this.readManifest(pending);
      for (const entry of await readdir(dir)) {
        if (!RUNTIME_DIRS.has(entry))
          await rm(path.join(dir, entry), { recursive: true, force: true });
      }
      await copyPackageFiles(pending, dir);
      await rm(path.dirname(pending), { recursive: true, force: true });
      await this.patchState(dir, { pending: undefined, lastError: undefined });
    });
    return this.summary(id);
  }

  /** Register a folder written elsewhere (e.g. by the AI in its workspace) as a package. */
  async importFromDir(sourceDir: string, id?: string): Promise<ScriptPackageSummary> {
    const source = path.resolve(sourceDir);
    if (!(await stat(source).catch(() => null))?.isDirectory()) {
      throw new ScriptPackageError(`目录不存在：${sourceDir}`, 'invalid');
    }
    const manifest = await this.readManifest(source);
    if (!existsSync(path.join(source, manifest.entry))) {
      throw new ScriptPackageError(`入口文件不存在：${manifest.entry}`, 'invalid');
    }
    const packageId = (id ?? path.basename(source)).trim();
    const target = this.packageDir(packageId);
    if (path.resolve(target) === source) return this.summary(packageId);
    await this.withLock(packageId, async () => {
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(target)) {
        if (!RUNTIME_DIRS.has(entry))
          await rm(path.join(target, entry), { recursive: true, force: true });
      }
      await copyPackageFiles(source, target);
    });
    return this.summary(packageId);
  }

  // ── state ────────────────────────────────────────────────────────────

  private async readManifest(dir: string): Promise<ScriptManifest> {
    const raw = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const parsed = scriptManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ScriptPackageError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        'invalid'
      );
    }
    return parsed.data;
  }

  private async readState(dir: string): Promise<PackageState> {
    try {
      return JSON.parse(await readFile(path.join(dir, STATE_DIR, 'state.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  private async patchState(dir: string, patch: Partial<PackageState>): Promise<void> {
    const next = { ...(await this.readState(dir)), ...patch };
    for (const key of Object.keys(next) as Array<keyof PackageState>) {
      if (next[key] === undefined) delete next[key];
    }
    await mkdir(path.join(dir, STATE_DIR), { recursive: true });
    await writeFile(path.join(dir, STATE_DIR, 'state.json'), JSON.stringify(next, null, 2), 'utf8');
  }

  private async withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
}

function venvPython(dir: string): string {
  return process.platform === 'win32'
    ? path.join(dir, '.venv', 'Scripts', 'python.exe')
    : path.join(dir, '.venv', 'bin', 'python');
}

function depsFileFor(
  manifest: ScriptManifest,
  dir: string
): 'requirements.txt' | 'package.json' | undefined {
  const file = manifest.runtime === 'python' ? 'requirements.txt' : 'package.json';
  return existsSync(path.join(dir, file)) ? file : undefined;
}

async function copyPackageFiles(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (RUNTIME_DIRS.has(entry)) continue;
    await cp(path.join(from, entry), path.join(to, entry), {
      recursive: true,
      filter: (src) =>
        !path
          .relative(from, src)
          .split(path.sep)
          .some((part) => RUNTIME_DIRS.has(part)),
    });
  }
}

export function formatTimeout(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}

/** Last few KB of the entry's stdout/stderr (never includes the env). */
function processLog(result: { stdout: string; stderr: string }): string {
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  return text.length > 4000 ? text.slice(-4000) : text;
}
