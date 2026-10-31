import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import {
  manifestColumnNames,
  scriptManifestSchema,
  type ScriptManifest,
  type ScriptPackageEditorState,
  type ScriptChatOrigin,
  type ScriptPackageFile,
  type ScriptPackageRunInfo,
  type ScriptPackageSummary,
  type ScriptPackageVersion,
  type ScriptPackageVersionDetail,
  type ScriptTestRunResult,
  type ScriptVersionSource,
} from '../../../shared/automation/script-package';
import { failureReason, runProcess, type ProcessResult } from './process';
import { buildExecEnv } from '../../exec-guard/env';
import { SECRET_NAME_PATTERN, scriptSecretScope } from '../../exec-guard/secret-store';
import { knownSecretValues, redactOutput } from '../../exec-guard/redact';
import { describeLocalHostRefs, findLocalHostRefs } from '../../../shared/network-policy';
import {
  describeSecretLeaks,
  detectSecretCandidates,
  findSecretsInFiles,
  replaceSecrets,
} from '../../../shared/secrets';
import { parseCsv, readScriptOutput, type ParsedScriptOutput } from './output';
import {
  findReusableDraft,
  VersionRepo as PackageRepo,
  PUBLISHED_TAG,
} from '../../versioning/git-repo';
import {
  normalizeScriptManifest,
  type ScriptAgentPhase,
  type ScriptFilesGenerator,
} from './generator';
import {
  changedFilePaths,
  evaluatePass,
  extractRunNotices,
  normalizeManifestColumns,
} from '../../../shared/fix-error';
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import type {
  ScriptDraftCheck,
  ScriptGenerateDraftInput,
  ScriptGenerateDraftResult,
  ScriptGenerateProgressEvent,
  ScriptRuntime,
} from '../../../shared/automation/script-package';
import {
  MemoryScriptVersionStore,
  type ScriptVersionRecord,
  type ScriptVersionStore,
} from './version-store';

/** App-owned folder inside each package (git-ignored): run dirs, deps state, last output. */
export const STATE_DIR = '.sophron';
const RUNTIME_DIRS = new Set([STATE_DIR, '.venv', 'node_modules', '__pycache__', '.git']);
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PACKAGE_ID_PATTERN = /^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,79}$/;
const PREVIEW_ROWS = 200;
/** 规则生成: fix turns after the agent's own iterations when the final trial run fails. */
export const AUTO_FIX_ROUNDS = 3;
const DEFAULT_CHECK_TIMEOUT_MS = 120_000;

export interface GenerateDraftOptions {
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: (event: Omit<ScriptGenerateProgressEvent, 'progressId'>) => void;
  /** 取消 in the editor. */
  signal?: AbortSignal;
  /** Automation whose failed run asked for this AI 修复. */
  automationId?: string;
  /** Self-test timeout; an automation repair uses its node's timeout. */
  checkTimeoutMs?: number;
}

/** Limits on automation-triggered AI 修复 per package. */
export interface AutoRepairPolicy {
  cooldownMs: number;
  dailyCap: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface PackageState {
  depsHash?: string;
  runtimeVersion?: string;
  /** Commit materialised in a run directory. */
  commit?: string;
  lastSuccess?: ScriptPackageRunInfo;
  lastError?: { at: number; message: string };
  /** Display name set in the editor (overrides manifest.name). */
  displayName?: string;
  editor?: ScriptPackageEditorState;
  /** 对话「转成脚本」 origin of the package. */
  origin?: ScriptChatOrigin;
  /** When automation runs started an AI 修复 (last 24 h). */
  repairAttempts?: number[];
}

export interface ScriptRunOutput extends ParsedScriptOutput {
  /** Passed with yellow warnings (on_empty fallback used, single-value columns, …). */
  warnings?: string[];
  /** Stable copy of the last successful output (imported into the raw table). */
  csvPath: string;
  durationMs: number;
  installedDeps: boolean;
  log: string;
  version?: number;
}

export class ScriptPackageError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'deps' | 'timeout' | 'script' | 'output',
    /** Tail of the process output, for the AI / test-run details. */
    readonly log?: string,
    /** Exit code of the entry for script failures. */
    readonly exitCode?: number
  ) {
    super(message);
  }
}

export interface ScriptPackageServiceOptions {
  rootDir: string;
  /** Version metadata (DB); defaults to in-memory. */
  versions?: ScriptVersionStore;
  now?: () => number;
  /** Override interpreters (tests). */
  python?: { command: string; args: string[] };
  node?: { command: string; env?: NodeJS.ProcessEnv };
  npmCommand?: string;
  /** Package secrets (API keys) injected as environment variables at run time. */
  secrets?: {
    env(scope: string): Record<string, string>;
    set?(scope: string, name: string, value: string): unknown;
    deleteScope?(scope: string): void;
  };
}

export interface SaveDraftOptions {
  source: ScriptVersionSource;
  rulePrompt?: string;
  baseVersion?: number | null;
  sessionId?: string;
  automationId?: string;
  rows?: number;
}

export interface SaveDraftResult {
  summary: ScriptPackageSummary;
  version: ScriptPackageVersion;
  /** False when nothing changed and the existing newest version was returned. */
  created: boolean;
  /** True when an earlier draft of the same source was overwritten. */
  replaced: boolean;
}

/** Which tree a trial run executes. */
export type ScriptRunTarget = number | 'published' | 'working';

/**
 * Script packages: every package folder is a git repo (isomorphic-git). Each version is a
 * commit; the version automations run carries the tag `vN` and the moving tag `published`.
 * The folder itself is the working tree users open and edit; automations and trial runs
 * execute a checkout of a commit under `.sophron/run/`, never the working tree.
 */
export class ScriptPackageService {
  readonly rootDir: string;
  private readonly now: () => number;
  private readonly store: ScriptVersionStore;
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Packages whose working tree is being edited by an AI repair session. */
  private readonly repairing = new Set<string>();

  constructor(private readonly options: ScriptPackageServiceOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? (() => Date.now());
    this.store = options.versions ?? new MemoryScriptVersionStore();
  }

  packageDir(id: string): string {
    if (!PACKAGE_ID_PATTERN.test(id))
      throw new ScriptPackageError(`脚本包名称无效：${id}`, 'invalid');
    return path.join(this.rootDir, id);
  }

  private repo(id: string): PackageRepo {
    return new PackageRepo(this.packageDir(id));
  }

  /** A free folder name for a new package called `name`. */
  async newPackageId(name: string): Promise<string> {
    const base =
      name
        .trim()
        .replace(/[\\/:*?"<>|\s]+/g, '_')
        .replace(/^[._]+/, '')
        .slice(0, 60) || 'script';
    for (let index = 1; index < 1000; index += 1) {
      const id = index === 1 ? base : `${base}_${index}`;
      // Version rows can outlive a folder deleted outside the app: never reuse their id.
      if (!existsSync(path.join(this.rootDir, id)) && this.store.list(id).length === 0) return id;
    }
    return `${base}_${this.now()}`;
  }

  async list(): Promise<ScriptPackageSummary[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const result: ScriptPackageSummary[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory() || !PACKAGE_ID_PATTERN.test(entry.name)) continue;
      if (!existsSync(path.join(this.rootDir, entry.name, 'manifest.json'))) continue;
      seen.add(entry.name);
      result.push(await this.summary(entry.name));
    }
    // Versions whose folder was deleted outside the app: listed as missing so they can be deleted.
    for (const id of this.store.packageIds()) {
      if (seen.has(id) || !PACKAGE_ID_PATTERN.test(id)) continue;
      if (existsSync(path.join(this.rootDir, id, 'manifest.json'))) continue;
      result.push({ ...(await this.summaryUnsynced(id, this.packageDir(id))), missing: true });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** Summary of a package; first picks up edits made in the folder as a 手动修改 draft. */
  async summary(id: string): Promise<ScriptPackageSummary> {
    const dir = this.packageDir(id);
    try {
      await this.sync(id);
    } catch {
      // An unreadable working tree still lists; the manifest error below explains it.
    }
    return this.summaryUnsynced(id, dir);
  }

  private async summaryUnsynced(id: string, dir: string): Promise<ScriptPackageSummary> {
    const state = await this.readState(dir);
    const records = this.store.list(id);
    const published = records.find((record) => record.status === 'published');
    const draft = [...records]
      .reverse()
      .find((record) => record.status === 'draft' && record.version > (published?.version ?? 0));
    const base = {
      id,
      dir,
      lastSuccess: state.lastSuccess,
      lastError: state.lastError,
      published: published && toVersion(published),
      draft: draft && toVersion(draft),
      versionCount: records.length,
      ...(state.origin ? { origin: state.origin } : {}),
    };
    let manifest: ScriptManifest;
    try {
      manifest = await this.readManifest(dir);
    } catch (error) {
      return {
        ...base,
        name: state.displayName ?? id,
        entry: published?.entry ?? '',
        runtime: published?.runtime ?? 'python',
        depsReady: false,
        invalid: error instanceof Error ? error.message : String(error),
      };
    }
    const runDir = this.runDir(dir, 'published');
    const runState = await this.readState(runDir);
    let depsFile: ScriptPackageSummary['depsFile'];
    let depsReady = Boolean(published);
    if (published) {
      const files = await this.repo(id)
        .treeIndex(published.commit)
        .catch(() => new Map<string, string>());
      const runtime = published.runtime;
      const file = runtime === 'python' ? 'requirements.txt' : 'package.json';
      depsFile = files.has(file) ? file : undefined;
      if (depsFile) {
        const materialised = runState.commit === published.commit;
        depsReady =
          materialised &&
          runState.depsHash ===
            (await this.depsHash(runDir, { ...manifest, runtime }).catch(() => undefined)) &&
          this.depsInstalled(runDir, runtime);
      }
    }
    return {
      ...base,
      name: state.displayName ?? manifest.name,
      description: manifest.description,
      entry: published?.entry ?? manifest.entry,
      runtime: published?.runtime ?? manifest.runtime,
      runtimeVersion: runState.runtimeVersion ?? state.runtimeVersion,
      depsFile,
      depsReady,
    };
  }

  // ── versions ─────────────────────────────────────────────────────────

  /** Version history (newest first) with each version's git diff against the published one. */
  async listVersions(id: string): Promise<ScriptPackageVersion[]> {
    // Folder edits show up in the history as a 手动修改 draft, like in summary().
    await this.sync(id).catch(() => undefined);
    const repo = this.repo(id);
    const records = this.store.list(id);
    const published = records.find((record) => record.status === 'published');
    const result: ScriptPackageVersion[] = [];
    for (const record of records.reverse()) {
      const version = toVersion(record);
      if (published && record.version !== published.version) {
        version.diff = await repo.diff(published.commit, record.commit).catch(() => undefined);
      }
      result.push(version);
    }
    return result;
  }

  async versionDetail(id: string, versionNumber: number): Promise<ScriptPackageVersionDetail> {
    const record = this.requireRecord(id, versionNumber);
    const repo = this.repo(id);
    const published = this.store.list(id).find((item) => item.status === 'published');
    const files = await repo.readFiles(record.commit);
    return {
      ...toVersion(record),
      files,
      ...(published && published.version !== record.version
        ? { diff: await repo.diff(published.commit, record.commit) }
        : {}),
    };
  }

  /**
   * Commit the working tree (optionally replaced by `files`) as a draft. Repeated drafts
   * from AI repair, manual edits and chat overwrite the newest unpublished draft of the
   * same source instead of piling up versions.
   */
  saveDraft(
    id: string,
    options: SaveDraftOptions & { files?: ScriptPackageFile[] }
  ): Promise<SaveDraftResult> {
    return this.withLock(id, () => this.saveDraftUnlocked(id, options));
  }

  private async saveDraftUnlocked(
    id: string,
    options: SaveDraftOptions & { files?: ScriptPackageFile[] }
  ): Promise<SaveDraftResult> {
    const dir = this.packageDir(id);
    const repo = new PackageRepo(dir);
    await this.ensureRepo(id);
    if (options.files) await writeWorkingFiles(dir, options.files);
    await repo.ensure();
    const manifest = await this.readManifest(dir).catch((error: unknown) => {
      throw new ScriptPackageError(
        `manifest.json 无效：${error instanceof Error ? error.message : String(error)}`,
        'invalid'
      );
    });
    if (!existsSync(path.join(dir, manifest.entry))) {
      throw new ScriptPackageError(`入口文件不存在：${manifest.entry}`, 'invalid');
    }
    // Secrets never enter git history: they live in the secret store and arrive as env vars.
    const leaks = await this.secretLeaks(id);
    if (leaks.length > 0) throw new ScriptPackageError(describeSecretLeaks(leaks), 'invalid');
    options = { ...options, rulePrompt: this.sanitizePrompt(id, options.rulePrompt) };
    const records = this.store.list(id);
    const published = records.find((record) => record.status === 'published');
    const reusable = findReusableDraft(records, options.source, {
      alwaysNew: options.source === 'rule',
    });
    const nextVersion = reusable?.version ?? (records.at(-1)?.version ?? 0) + 1;
    const commit = await repo.commitAll(
      `v${nextVersion} ${SOURCE_LABEL[options.source]}${
        options.rulePrompt ? `\n\n${options.rulePrompt.slice(0, 2000)}` : ''
      }`,
      reusable ? { replace: reusable.commit } : {}
    );
    const now = this.now();
    if (!commit && reusable) {
      // Same content as the draft being overwritten (e.g. a repeated repair arrived at the same
      // fix): keep the commit, refresh what this attempt recorded.
      this.store.update(id, reusable.version, {
        rulePrompt: options.rulePrompt ?? reusable.rulePrompt,
        sessionId: options.sessionId ?? reusable.sessionId,
        automationId: options.automationId ?? reusable.automationId,
        rows: options.rows ?? reusable.rows,
        updatedAt: now,
      });
      return {
        summary: await this.summaryUnsynced(id, dir),
        version: toVersion(this.requireRecord(id, reusable.version)),
        created: false,
        replaced: true,
      };
    }
    if (!commit) {
      const latest = records.at(-1);
      if (latest) {
        return {
          summary: await this.summaryUnsynced(id, dir),
          version: toVersion(latest),
          created: false,
          replaced: false,
        };
      }
    }
    const oid = commit ?? (await repo.head());
    if (!oid) throw new ScriptPackageError('无法提交脚本包版本', 'invalid');
    const fields = {
      commit: oid,
      status: 'draft' as const,
      source: options.source,
      entry: manifest.entry,
      runtime: manifest.runtime,
      rulePrompt: options.rulePrompt,
      baseVersion:
        options.baseVersion === undefined ? (published?.version ?? null) : options.baseVersion,
      sessionId: options.sessionId,
      automationId: options.automationId,
      rows: options.rows,
      updatedAt: now,
    };
    if (reusable) this.store.update(id, reusable.version, fields);
    else this.store.insert({ packageId: id, version: nextVersion, createdAt: now, ...fields });
    const saved = this.requireRecord(id, nextVersion);
    return {
      summary: await this.summaryUnsynced(id, dir),
      version: toVersion(saved),
      created: true,
      replaced: Boolean(reusable),
    };
  }

  // ── AI drafts (规则生成 / AI 修复) ───────────────────────────────────

  /**
   * Hand the package folder to an editor agent: pending folder edits are saved first, then the
   * working tree is replaced by `files` (the base version, or nothing for a new package).
   * Folder syncing pauses until endAgentEdit.
   */
  private beginAgentEdit(id: string, files: ScriptPackageFile[]): Promise<string> {
    return this.withLock(id, async () => {
      if (this.repairing.has(id)) throw new ScriptPackageError('AI 正在修改这个脚本包', 'invalid');
      const dir = this.packageDir(id);
      await mkdir(dir, { recursive: true });
      await this.ensureRepo(id);
      const repo = new PackageRepo(dir);
      if ((await repo.head()) && (await repo.changedPaths()).length > 0) {
        await this.saveDraftUnlocked(id, { source: 'manual' }).catch(() => undefined);
      }
      await writeWorkingFiles(dir, files);
      this.repairing.add(id);
      return dir;
    });
  }

  /** Commit the agent's working tree as a draft, or put the folder back as it was. */
  private endAgentEdit(
    id: string,
    save: (SaveDraftOptions & { files?: ScriptPackageFile[] }) | null
  ): Promise<SaveDraftResult | null> {
    return this.withLock(id, async () => {
      try {
        if (save) return await this.saveDraftUnlocked(id, save);
        const dir = this.packageDir(id);
        const repo = new PackageRepo(dir);
        const head = await repo.head();
        if (head) await repo.checkoutTree(head);
        else if (this.store.list(id).length === 0) await rm(dir, { recursive: true, force: true });
        else await clearWorkingTree(dir);
        return null;
      } finally {
        this.repairing.delete(id);
      }
    });
  }

  /**
   * Delete a package for good: its version rows, folder (git repo included) and secrets.
   * The caller checks that no automation still runs it.
   */
  deletePackage(id: string): Promise<void> {
    return this.withLock(id, async () => {
      if (this.repairing.has(id)) throw new ScriptPackageError('AI 正在修改这个脚本包', 'invalid');
      const dir = this.packageDir(id);
      await rm(dir, { recursive: true, force: true });
      this.store.deletePackage(id);
      this.options.secrets?.deleteScope?.(scriptSecretScope(id));
    });
  }

  /**
   * Book an automation-triggered AI 修复: refused during the cooldown after the previous one
   * or once the package had `dailyCap` repairs in the last 24 hours.
   */
  reserveAutoRepair(
    id: string,
    now: number,
    policy: AutoRepairPolicy
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.withLock(id, async () => {
      const dir = this.packageDir(id);
      const state = await this.readState(dir);
      const recent = (state.repairAttempts ?? []).filter((at) => now - at < DAY_MS);
      const last = recent.length > 0 ? Math.max(...recent) : null;
      if (last != null && now - last < policy.cooldownMs) {
        const minutes = Math.ceil((policy.cooldownMs - (now - last)) / 60_000);
        return {
          ok: false as const,
          reason: `距上次修复不足 ${formatTimeout(policy.cooldownMs)}，${minutes} 分钟后再试`,
        };
      }
      if (recent.length >= policy.dailyCap) {
        return { ok: false as const, reason: `24 小时内已自动修复 ${policy.dailyCap} 次` };
      }
      await this.patchState(dir, { repairAttempts: [...recent, now] });
      return { ok: true as const };
    });
  }

  /** Trial-run the working tree with the pass verdict (what the agent's self-test sees). */
  async checkWorkingTree(
    id: string,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS
  ): Promise<ScriptDraftCheck> {
    const leaks = await this.secretLeaks(id);
    if (leaks.length > 0)
      return { passed: false, reason: describeSecretLeaks(leaks), durationMs: 0 };
    const run = await this.testRun(id, { timeoutMs, target: 'working' });
    return {
      passed: run.ok,
      ...(run.ok ? {} : { reason: run.error ?? '试运行失败' }),
      rows: run.rows,
      columns: run.columns,
      preview: run.preview ?? previewFromLog(run.log),
      previewRows: run.previewRows,
      log: run.log,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      ...(run.warnings?.length ? { warnings: run.warnings } : {}),
    };
  }

  /** Files of the package working tree (runtime folders and .gitignore excluded). */
  private async workingFiles(id: string): Promise<ScriptPackageFile[]> {
    return readWorkingFiles(this.packageDir(id));
  }

  /** Validate the agent's manifest, pin name/runtime and write it back. */
  private async normalizeWorkingManifest(
    id: string,
    input: { name: string; runtime: ScriptRuntime }
  ): Promise<ScriptPackageFile[]> {
    const files = await this.workingFiles(id);
    const content = normalizeScriptManifest(files, input);
    await writeFile(path.join(this.packageDir(id), 'manifest.json'), content, 'utf8');
    return files.map((file) => (file.path === 'manifest.json' ? { ...file, content } : file));
  }

  /**
   * 交给 AI 修复 from the editor: an agent turn that edits the current draft (baseVersion) from
   * the trial-run failure, verifying against the live source and self-testing. The result is
   * saved as the AI 修复 draft, which later fixes overwrite.
   */
  private async fixDraft(
    input: ScriptGenerateDraftInput,
    generator: ScriptFilesGenerator,
    options: GenerateDraftOptions
  ): Promise<ScriptGenerateDraftResult> {
    const emit = options.onProgress ?? (() => undefined);
    const fix = input.fix!;
    let started: string | null = null;
    try {
      if (!input.packageId) throw new ScriptPackageError('修复需要已有脚本包', 'invalid');
      if (input.baseVersion == null)
        throw new ScriptPackageError('修复需要基于一个版本', 'invalid');
      const id = input.packageId;
      emit({ phase: 'source_summary', kind: 'message', text: '读取报错与当前草稿的文件。' });
      const summary = await this.summary(id);
      const base = await this.versionDetail(id, input.baseVersion);
      const files = base.files.filter((file) => file.path !== '.gitignore');
      const name = input.name?.trim() || summary.name;
      const dir = await this.beginAgentEdit(id, files);
      started = id;
      const outcome = await generator.fix({
        name,
        runtime: base.runtime,
        rulePrompt: base.source === 'rule' || base.source === 'chat' ? base.rulePrompt : undefined,
        files,
        baseLabel: `v${base.version}（${STATUS_LABEL[base.status]}）`,
        request: {
          error: fix.error,
          log: fix.log,
          exitCode: fix.exitCode,
          durationMs: fix.durationMs,
          note: fix.note,
          round: fix.round,
          maxRounds: fix.maxRounds,
          previousAttempts: fix.previousAttempts,
        },
        workspace: {
          dir,
          test: () => this.checkWorkingTree(id, options.checkTimeoutMs),
          secrets: this.secretEnv(id),
        },
        runtimeConfig: options.runtimeConfig,
        signal: options.signal,
        onProgress: (phase, text) => emit({ phase, kind: 'message', text }),
      });
      if (outcome.stop === 'error' && outcome.selfTests === 0)
        throw new ScriptPackageError(`AI 修复失败：${outcome.error ?? '模型出错'}`, 'invalid');
      const after = await this.normalizeWorkingManifest(id, { name, runtime: base.runtime });
      const changedFiles = changedFilePaths(files, after);
      if (changedFiles.length === 0)
        throw new ScriptPackageError('AI 修复没有改动任何文件', 'invalid');
      emit({
        phase: 'saving',
        kind: 'message',
        text: `修改 ${changedFiles.join('、')}，写入 AI 修复草稿。`,
      });
      const check = await this.checkWorkingTree(id, options.checkTimeoutMs);
      const saved = await this.endAgentEdit(id, {
        source: 'ai_repair',
        rulePrompt: [
          outcome.summary,
          `报错：${outcome.payload?.error ?? fix.error}`,
          fix.note ? `补充：${fix.note}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        baseVersion: base.version,
        rows: check.passed ? check.rows : undefined,
        ...(options.automationId ? { automationId: options.automationId } : {}),
      });
      started = null;
      if (!saved) throw new ScriptPackageError('保存 AI 修复草稿失败', 'invalid');
      emit({
        phase: 'complete',
        kind: 'message',
        text: `${saved.replaced ? '已覆盖' : '已保存'} v${saved.version.version} AI 修复草稿`,
      });
      return {
        summary: await this.summaryUnsynced(id, this.packageDir(id)),
        version: await this.versionDetail(id, saved.version.version),
        changedFiles,
        fixSummary: outcome.summary,
        replaced: saved.replaced,
        check,
        agentSummary: outcome.summary,
      };
    } catch (error) {
      if (started) await this.endAgentEdit(started, null).catch(() => undefined);
      emit({ phase: 'error', kind: 'message', text: errorText(error) });
      throw error;
    }
  }

  /**
   * 规则生成: an agent explores the source, writes the package into its folder and self-tests
   * until the trial run passes. A final trial run checks the result; when it still fails, up to
   * AUTO_FIX_ROUNDS fix turns continue from that failure. The result is saved as one draft.
   */
  async generateDraft(
    input: ScriptGenerateDraftInput,
    generator: ScriptFilesGenerator,
    options: GenerateDraftOptions = {}
  ): Promise<ScriptGenerateDraftResult> {
    const emit = options.onProgress ?? (() => undefined);
    if (input.fix) return this.fixDraft(input, generator, options);
    let started: string | null = null;
    try {
      const name = input.name?.trim() || '';
      const id = input.packageId || (await this.newPackageId(name || '新脚本包'));
      const existing = Boolean(input.packageId);
      let baseFiles: ScriptPackageFile[] = [];
      let lastError: string | undefined;
      let displayName = name;
      emit({ phase: 'source_summary', kind: 'message', text: `脚本包：${name || id}` });
      if (existing) {
        const summary = await this.summary(id);
        displayName = name || summary.name;
        lastError = summary.lastError?.message;
        if (input.baseVersion != null) {
          const base = await this.versionDetail(id, input.baseVersion);
          baseFiles = base.files.filter((file) => file.path !== '.gitignore');
          emit({
            phase: 'source_summary',
            kind: 'message',
            text: `基于 v${base.version}（${STATUS_LABEL[base.status]}）修改 · ${baseFiles.length} 个文件`,
          });
        } else {
          emit({ phase: 'source_summary', kind: 'message', text: '从头生成' });
        }
        if (lastError)
          emit({ phase: 'source_summary', kind: 'message', text: `最近一次失败：${lastError}` });
      } else {
        emit({ phase: 'source_summary', kind: 'message', text: '新建脚本包，从头生成' });
      }
      emit({
        phase: 'source_summary',
        kind: 'message',
        text: `语言：${input.runtime === 'node' ? 'Node.js' : 'Python'} · 智能体可联网探查、写文件、试运行`,
      });
      const packageName = displayName || id;
      // Key-like strings in the rule / references become stored secrets before the model sees them.
      const captured = this.captureSecrets(id, input);
      input = { ...input, rulePrompt: captured.rulePrompt, references: captured.references };
      if (captured.saved.length > 0)
        emit({
          phase: 'source_summary',
          kind: 'message',
          text: `已把 ${captured.saved.join('、')} 存为加密密钥（运行时作为环境变量提供，不发送给 AI）`,
        });
      const dir = await this.beginAgentEdit(id, baseFiles);
      started = id;
      const workspace = {
        dir,
        test: () => this.checkWorkingTree(id, options.checkTimeoutMs),
        secrets: this.secretEnv(id),
      };
      const onProgress = (phase: ScriptAgentPhase, text: string) =>
        emit({ phase, kind: 'message', text });
      const outcome = await generator.generate({
        name: packageName,
        rulePrompt: input.rulePrompt,
        runtime: input.runtime,
        baseFiles,
        baseLabel: input.baseVersion != null ? `v${input.baseVersion}` : undefined,
        lastError,
        ...(input.origin ? { fromConversation: true, references: input.references ?? [] } : {}),
        workspace,
        runtimeConfig: options.runtimeConfig,
        signal: options.signal,
        onProgress,
      });
      if (outcome.stop === 'error' && !existsSync(path.join(dir, 'manifest.json')))
        throw new ScriptPackageError(`生成失败：${outcome.error ?? '模型出错'}`, 'invalid');
      if (outcome.stop === 'max_turns' || outcome.stop === 'timeout')
        emit({
          phase: 'verify',
          kind: 'message',
          text: `智能体${outcome.error ?? '已停止'}，检查当前结果`,
        });
      let files = await this.normalizeWorkingManifest(id, {
        name: packageName,
        runtime: input.runtime,
      });
      emit({ phase: 'verify', kind: 'message', text: '最终试运行…' });
      let check = await workspace.test();
      emit({ phase: 'verify', kind: 'message', text: checkLine(check) });
      let summaryText = outcome.summary;
      const attempts: string[] = [];
      let rounds = 0;
      while (!check.passed && rounds < AUTO_FIX_ROUNDS && !options.signal?.aborted) {
        rounds += 1;
        attempts.push(`第 ${rounds} 轮前：${check.reason ?? ''}`.slice(0, 1800));
        emit({
          phase: 'verify',
          kind: 'message',
          text: `自动修复 第 ${rounds} / ${AUTO_FIX_ROUNDS} 轮：${check.reason ?? ''}`,
        });
        const fixed = await generator.fix({
          name: packageName,
          runtime: input.runtime,
          rulePrompt: input.rulePrompt,
          files,
          baseLabel: '本次生成的草稿',
          request: {
            error: `${check.reason ?? '试运行失败'}${check.preview ? `\n输出预览：\n${check.preview}` : ''}`,
            log: check.log,
            exitCode: check.exitCode,
            durationMs: check.durationMs,
            round: rounds,
            maxRounds: AUTO_FIX_ROUNDS,
            previousAttempts: attempts,
          },
          workspace,
          runtimeConfig: options.runtimeConfig,
          signal: options.signal,
          onProgress,
        });
        if (fixed.summary) summaryText = fixed.summary;
        files = await this.normalizeWorkingManifest(id, {
          name: packageName,
          runtime: input.runtime,
        });
        check = await workspace.test();
        emit({ phase: 'verify', kind: 'message', text: checkLine(check) });
      }
      options.signal?.throwIfAborted();
      emit({ phase: 'saving', kind: 'message', text: `保存为草稿 · ${files.length} 个文件` });
      const saved = await this.endAgentEdit(id, {
        source: input.origin ? 'chat' : 'rule',
        ...(input.origin ? { sessionId: input.origin.sessionId } : {}),
        rulePrompt: input.rulePrompt,
        baseVersion: input.baseVersion,
        rows: check.passed ? check.rows : undefined,
      });
      started = null;
      if (!saved) throw new ScriptPackageError('保存草稿失败', 'invalid');
      await this.patchState(this.packageDir(id), {
        editor: {
          rulePrompt: input.rulePrompt,
          runtime: input.runtime,
          modelConfigSetId: input.modelConfigSetId,
        },
        ...(input.origin ? { origin: input.origin } : {}),
      });
      emit({ phase: 'complete', kind: 'message', text: `已保存 v${saved.version.version} 草稿` });
      return {
        summary: await this.summaryUnsynced(id, this.packageDir(id)),
        version: await this.versionDetail(id, saved.version.version),
        check,
        agentSummary: summaryText,
        autoFixRounds: rounds,
        ...(captured.saved.length > 0 ? { savedSecrets: captured.saved } : {}),
      };
    } catch (error) {
      if (started) await this.endAgentEdit(started, null).catch(() => undefined);
      emit({ phase: 'error', kind: 'message', text: errorText(error) });
      throw error;
    }
  }

  /**
   * Make `versionNumber` the version automations run: tag it `vN`, move the `published`
   * tag, archive the previously published one. Publishing an older version is a rollback.
   */
  publish(id: string, versionNumber: number): Promise<ScriptPackageSummary> {
    return this.withLock(id, async () => {
      const record = this.requireRecord(id, versionNumber);
      const repo = this.repo(id);
      const now = this.now();
      for (const other of this.store.list(id)) {
        if (other.status === 'published' && other.version !== versionNumber)
          this.store.update(id, other.version, { status: 'archived' });
      }
      await repo.publishTag(versionNumber, record.commit);
      this.store.update(id, versionNumber, { status: 'published', publishedAt: now });
      await this.patchState(this.packageDir(id), { lastError: undefined });
      return this.summaryUnsynced(id, this.packageDir(id));
    });
  }

  deleteVersion(id: string, versionNumber: number): Promise<void> {
    return this.withLock(id, async () => {
      const record = this.requireRecord(id, versionNumber);
      if (record.status === 'published') {
        throw new ScriptPackageError('已发布的版本不能删除', 'invalid');
      }
      this.store.delete(id, versionNumber);
      await this.repo(id).deleteTag(`v${versionNumber}`);
    });
  }

  async setMeta(
    id: string,
    patch: { displayName?: string; editor?: ScriptPackageEditorState }
  ): Promise<ScriptPackageSummary> {
    const dir = this.packageDir(id);
    await this.patchState(dir, {
      ...(patch.displayName !== undefined
        ? { displayName: patch.displayName.trim() || undefined }
        : {}),
      ...(patch.editor !== undefined ? { editor: patch.editor } : {}),
    });
    return this.summary(id);
  }

  async editorState(id: string): Promise<ScriptPackageEditorState | undefined> {
    return (await this.readState(this.packageDir(id))).editor;
  }

  // ── working tree ─────────────────────────────────────────────────────

  /** Save edits made directly in the folder (打开文件夹) as a 手动修改 draft. */
  private sync(id: string): Promise<SaveDraftResult | null> {
    if (this.repairing.has(id)) return Promise.resolve(null);
    return this.withLock(id, async () => {
      if (this.repairing.has(id)) return null;
      const repo = this.repo(id);
      const fresh = await this.ensureRepo(id);
      if (fresh) return null;
      if ((await repo.changedPaths()).length === 0) return null;
      try {
        await this.readManifest(repo.dir);
      } catch {
        return null; // half-edited manifest: wait until it is valid again
      }
      return this.saveDraftUnlocked(id, { source: 'manual' });
    });
  }

  /**
   * Initialise git for a package folder. A folder that has files but no history (written
   * before versioning) becomes v1, published so existing automations keep running.
   * Returns true when it created that first version.
   */
  private async ensureRepo(id: string): Promise<boolean> {
    const repo = this.repo(id);
    const hadGit = repo.exists;
    if (hadGit && (await repo.head())) return false;
    await repo.ensure();
    // Only a folder that predates versioning is migrated; a fresh repo waits for its draft.
    if (hadGit || !existsSync(path.join(repo.dir, 'manifest.json'))) return false;
    if (this.store.list(id).length > 0) return false;
    let manifest: ScriptManifest;
    try {
      manifest = await this.readManifest(repo.dir);
    } catch {
      return false;
    }
    const commit = await repo.commitAll('v1 导入');
    if (!commit) return false;
    const now = this.now();
    this.store.insert({
      packageId: id,
      version: 1,
      commit,
      status: 'published',
      source: 'chat',
      entry: manifest.entry,
      runtime: manifest.runtime,
      baseVersion: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    });
    await repo.publishTag(1, commit);
    return true;
  }

  /**
   * Prepare the working tree for an AI repair: folder edits are saved first, then the
   * published version is checked out so the AI fixes what automations actually run.
   */
  beginRepair(id: string): Promise<string> {
    return this.withLock(id, async () => {
      const dir = this.packageDir(id);
      await this.ensureRepo(id);
      const repo = new PackageRepo(dir);
      if ((await repo.changedPaths()).length > 0) {
        await this.saveDraftUnlocked(id, { source: 'manual' }).catch(() => undefined);
      }
      const published = this.store.list(id).find((record) => record.status === 'published');
      if (published) await repo.checkoutTree(published.commit);
      this.repairing.add(id);
      return dir;
    });
  }

  /** Commit a successful repair as the (single, overwritten) AI 修复 draft, or revert it. */
  finishRepair(
    id: string,
    result: {
      ok: boolean;
      reason: string;
      rows?: number;
      sessionId?: string;
      automationId?: string;
    }
  ): Promise<SaveDraftResult | null> {
    return this.withLock(id, async () => {
      try {
        const dir = this.packageDir(id);
        if (result.ok) {
          return await this.saveDraftUnlocked(id, {
            source: 'ai_repair',
            rulePrompt: result.reason,
            rows: result.rows,
            sessionId: result.sessionId,
            automationId: result.automationId,
          });
        }
        const head = await new PackageRepo(dir).head();
        if (head) await new PackageRepo(dir).checkoutTree(head);
        return null;
      } finally {
        this.repairing.delete(id);
      }
    });
  }

  /** Register a folder written elsewhere (by the AI in its workspace) as a draft version. */
  async importFromDir(
    sourceDir: string,
    id?: string,
    meta: Partial<SaveDraftOptions> = {}
  ): Promise<SaveDraftResult> {
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
    if (path.resolve(target) !== source) {
      // Keep the folder's own pending edits as a manual draft before replacing them.
      if (existsSync(path.join(target, '.git'))) await this.sync(packageId);
    }
    return this.withLock(packageId, async () => {
      await mkdir(target, { recursive: true });
      await this.ensureRepo(packageId);
      if (path.resolve(target) !== source) {
        await clearWorkingTree(target);
        await copyPackageFiles(source, target);
      }
      return this.saveDraftUnlocked(packageId, { source: 'chat', ...meta });
    });
  }

  // ── running ──────────────────────────────────────────────────────────

  /** Dry run of a version (default: published): installs deps, runs, nothing is imported. */
  async testRun(
    id: string,
    options: { timeoutMs: number; target?: ScriptRunTarget }
  ): Promise<ScriptTestRunResult> {
    const startedAt = this.now();
    try {
      const output = await this.run(id, { ...options, dryRun: true });
      const table = parseCsv(output.csv);
      const columns = output.columns;
      const previewRows = table.slice(1, PREVIEW_ROWS + 1).map((row) => {
        const record: Record<string, string> = {};
        columns.forEach((column, index) => (record[column] = row[index] ?? ''));
        return record;
      });
      return {
        ok: true,
        version: output.version,
        rows: output.rows,
        columns,
        durationMs: output.durationMs,
        installedDeps: output.installedDeps,
        preview: output.csv.split(/\r?\n/).slice(0, 6).join('\n'),
        previewRows,
        log: output.log,
        ...(output.warnings?.length ? { warnings: output.warnings } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: this.now() - startedAt,
        installedDeps: false,
        log: error instanceof ScriptPackageError ? error.log : undefined,
        ...(error instanceof ScriptPackageError && error.exitCode !== undefined
          ? { exitCode: error.exitCode }
          : {}),
      };
    }
  }

  /**
   * Run the published version (or, for dry runs, another target): check its commit out
   * into a run directory, install deps when missing or changed, run the entry with a
   * timeout and validate the output. Only a successful real run replaces the stable output.
   */
  run(
    id: string,
    options: { timeoutMs: number; dryRun?: boolean; target?: ScriptRunTarget }
  ): Promise<ScriptRunOutput> {
    return this.withLock(id, () => this.runUnlocked(id, options));
  }

  private async runUnlocked(
    id: string,
    options: { timeoutMs: number; dryRun?: boolean; target?: ScriptRunTarget }
  ): Promise<ScriptRunOutput> {
    const packageDir = this.packageDir(id);
    if (!existsSync(path.join(packageDir, 'manifest.json'))) {
      throw new ScriptPackageError(`找不到脚本包：${id}`, 'invalid');
    }
    await this.ensureRepo(id);
    const target = options.dryRun ? (options.target ?? 'published') : 'published';
    const { dir, record } = await this.checkoutForRun(id, packageDir, target);
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
    // Sandboxed code shares the host network: refuse code addressing this computer's services.
    const local = findLocalHostRefs(await readWorkingFiles(dir).catch(() => []));
    if (local.length > 0) throw new ScriptPackageError(describeLocalHostRefs(local), 'invalid');
    const installedDeps = await this.ensureDeps(dir, manifest);
    const outDir = path.join(packageDir, STATE_DIR, 'runs', String(this.now()));
    await mkdir(outDir, { recursive: true });
    const format = manifest.output?.format ?? 'csv';
    const outputPath = path.join(outDir, `output.${format}`);
    const configPath = path.join(dir, 'config.json');
    const startedAt = this.now();
    const isPublished = target === 'published';
    try {
      const command = this.entryCommand(dir, manifest, entryPath);
      const secretEnv = this.secretEnv(id);
      const result = await runProcess(command.command, command.args, {
        cwd: dir,
        timeoutMs: options.timeoutMs,
        // Allowlisted env only: the app's API keys never reach generated code.
        env: buildExecEnv({
          ...stringEnv(command.env),
          ...secretEnv,
          SOPHRON_OUTPUT: outputPath,
          SOPHRON_PACKAGE_DIR: dir,
          SOPHRON_CONFIG: existsSync(configPath) ? configPath : '',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        }),
        sandbox: { writable: [dir, outDir] },
        redact: Object.values(secretEnv),
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
      if (result.code !== 0)
        throw new ScriptPackageError(
          failureReason(result),
          'script',
          log,
          result.code ?? undefined
        );
      if (!existsSync(outputPath)) {
        throw new ScriptPackageError('脚本没有写出结果文件（SOPHRON_OUTPUT）', 'output', log);
      }
      let parsed: ParsedScriptOutput;
      try {
        parsed = readScriptOutput(
          await readFile(outputPath, 'utf8'),
          format,
          manifestColumnNames(manifest)
        );
      } catch (error) {
        throw new ScriptPackageError(
          error instanceof Error ? error.message : String(error),
          'output',
          log
        );
      }
      // 0 rows / empty expected columns fail like a crash: the raw table keeps its last data.
      const verdict = judgeOutput(parsed, manifest.output?.columns ?? [], log);
      if (!verdict.ok) {
        throw new ScriptPackageError(
          verdict.reason ?? '通过但结果异常',
          'output',
          [log, `输出预览：\n${parsed.csv.split(/\r?\n/).slice(0, 6).join('\n')}`]
            .filter(Boolean)
            .join('\n')
        );
      }
      const csvPath = path.join(packageDir, STATE_DIR, 'output.csv');
      const info = { at: this.now(), rows: parsed.rows, durationMs };
      if (!options.dryRun) {
        await writeFile(csvPath, parsed.csv, 'utf8');
        await this.patchState(packageDir, { lastSuccess: info, lastError: undefined });
      } else if (isPublished) {
        await this.patchState(packageDir, { lastSuccess: info });
      }
      if (record) this.store.update(id, record.version, { rows: parsed.rows });
      return {
        ...parsed,
        csvPath,
        durationMs,
        installedDeps,
        log,
        version: record?.version,
        ...(verdict.warnings?.length ? { warnings: verdict.warnings } : {}),
      };
    } catch (error) {
      if (!options.dryRun) {
        await this.patchState(packageDir, {
          lastError: {
            at: this.now(),
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runDir(packageDir: string, name: 'published' | 'trial'): string {
    return path.join(packageDir, STATE_DIR, 'run', name);
  }

  /** Check the target's tree out into a run directory (deps folders survive). */
  private async checkoutForRun(
    id: string,
    packageDir: string,
    target: ScriptRunTarget
  ): Promise<{ dir: string; record?: ScriptVersionRecord }> {
    const repo = new PackageRepo(packageDir);
    if (target === 'working') {
      const dir = this.runDir(packageDir, 'trial');
      await mkdir(dir, { recursive: true });
      await clearWorkingTree(dir);
      await copyPackageFiles(packageDir, dir);
      await this.patchState(dir, { commit: undefined });
      return { dir };
    }
    let record: ScriptVersionRecord | undefined;
    if (target === 'published') {
      const oid = await repo.resolveTag(PUBLISHED_TAG);
      record = this.store.list(id).find((item) => item.status === 'published');
      if (!oid || !record) {
        throw new ScriptPackageError('脚本包还没有发布版本，请先在编辑器或对话中发布', 'invalid');
      }
      record = { ...record, commit: oid };
    } else {
      record = this.requireRecord(id, target);
    }
    const dir = this.runDir(packageDir, target === 'published' ? 'published' : 'trial');
    const state = await this.readState(dir);
    if (state.commit !== record.commit || !existsSync(path.join(dir, 'manifest.json'))) {
      await repo.checkoutTree(record.commit, dir);
      await this.patchState(dir, { commit: record.commit });
    }
    return { dir, record };
  }

  // ── deps ─────────────────────────────────────────────────────────────

  private depsInstalled(dir: string, runtime: ScriptManifest['runtime']): boolean {
    if (runtime === 'python') return existsSync(venvPython(dir));
    return existsSync(path.join(dir, 'node_modules'));
  }

  private async depsHash(dir: string, manifest: ScriptManifest): Promise<string | undefined> {
    const file = depsFileFor(manifest, dir);
    if (!file) return undefined;
    const content = await readFile(path.join(dir, file), 'utf8');
    const lock = path.join(dir, 'package-lock.json');
    const lockContent =
      manifest.runtime === 'node' && existsSync(lock) ? await readFile(lock, 'utf8') : '';
    return createHash('sha256')
      .update(`${manifest.runtime}\n${content}\n${lockContent}`)
      .digest('hex');
  }

  /** Returns true when an install ran. The deps hash is tracked in the run dir's state. */
  private async ensureDeps(dir: string, manifest: ScriptManifest): Promise<boolean> {
    const hash = await this.depsHash(dir, manifest);
    const state = await this.readState(dir);
    if (!hash) {
      if (!state.runtimeVersion)
        await this.patchState(dir, { runtimeVersion: await this.runtimeVersion(dir, manifest) });
      return false;
    }
    if (state.depsHash === hash && this.depsInstalled(dir, manifest.runtime)) return false;
    const fail = (step: string, result: ProcessResult) => {
      const hint =
        step === 'npm' && result.code === -1 && /ENOENT/.test(result.stderr)
          ? '找不到 npm，安装带依赖的 Node 脚本需要本机安装 Node.js（含 npm）'
          : failureReason(result);
      throw new ScriptPackageError(`依赖安装失败（${step}）：${hint}`, 'deps', processLog(result));
    };
    if (manifest.runtime === 'python') {
      await rm(path.join(dir, '.venv'), { recursive: true, force: true });
      const python = this.systemPython();
      const venv = await runProcess(python.command, [...python.args, '-m', 'venv', '.venv'], {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT_MS,
        sandbox: { writable: [dir] },
      });
      if (venv.code !== 0) fail('venv', venv);
      const pip = await runProcess(
        venvPython(dir),
        ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'],
        { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS, sandbox: { writable: [dir] } }
      );
      if (pip.code !== 0) fail('pip', pip);
    } else {
      const npm = this.options.npmCommand ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm');
      // A committed lockfile installs exactly; otherwise do not write one into the checkout.
      const args = existsSync(path.join(dir, 'package-lock.json'))
        ? ['ci', '--no-audit', '--no-fund', '--omit=dev']
        : ['install', '--no-audit', '--no-fund', '--omit=dev', '--no-package-lock'];
      const install = await runProcess(npm, args, {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT_MS,
        sandbox: { writable: [dir] },
      });
      if (install.code !== 0) fail('npm', install);
    }
    await this.patchState(dir, {
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
        env: buildExecEnv(stringEnv(node.env)),
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
    const node = this.options.node ?? { command: process.execPath };
    // The exec env is an allowlist, so Electron's run-as-node flag must be set explicitly.
    return node.command === process.execPath && process.versions.electron
      ? { ...node, env: { ELECTRON_RUN_AS_NODE: '1', ...node.env } }
      : node;
  }

  /**
   * Store the secrets the user confirmed (plus, unless reviewed, key-like strings found in the
   * rule prompt / references) under the package and replace them by ${SECRET:NAME}.
   */
  private captureSecrets(
    id: string,
    input: ScriptGenerateDraftInput
  ): { rulePrompt: string; references?: ScriptGenerateDraftInput['references']; saved: string[] } {
    const scope = scriptSecretScope(id);
    const existing = this.secretEnv(id);
    const taken = new Set(Object.keys(existing));
    const provided = (input.secrets ?? []).filter(
      (item) => item.value?.trim() && SECRET_NAME_PATTERN.test(item.name)
    );
    for (const item of provided) taken.add(item.name);
    const text = [input.rulePrompt, ...(input.references ?? []).map((file) => file.content)].join(
      '\n'
    );
    const detected = input.secretsReviewed
      ? []
      : detectSecretCandidates(text)
          .filter(
            (item) =>
              !provided.some((known) => known.value === item.value) &&
              !Object.values(existing).includes(item.value)
          )
          .map((item) => {
            let name = item.name;
            for (let index = 2; taken.has(name); index += 1) name = `${item.name}_${index}`;
            taken.add(name);
            return { name, value: item.value };
          });
    const saved = [...provided, ...detected];
    for (const item of saved) this.options.secrets?.set?.(scope, item.name, item.value);
    const replacements = [
      ...saved,
      ...Object.entries(existing).map(([name, value]) => ({ name, value })),
    ];
    return {
      rulePrompt: replaceSecrets(input.rulePrompt, replacements),
      ...(input.references
        ? {
            references: input.references.map((file) => ({
              ...file,
              content: replaceSecrets(file.content, replacements),
            })),
          }
        : {}),
      saved: saved.map((item) => item.name),
    };
  }

  /** Key-like literals or stored secret values in the package's working files. */
  private async secretLeaks(id: string) {
    const files = await readWorkingFiles(this.packageDir(id)).catch(() => []);
    return findSecretsInFiles(files, [
      ...Object.values(this.secretEnv(id)),
      ...knownSecretValues(),
    ]);
  }

  /** Stored secret values become ${SECRET:NAME}; other key-like strings are redacted. */
  sanitizePrompt(id: string, text: string | undefined): string | undefined {
    if (!text) return text;
    const replacements = Object.entries(this.secretEnv(id)).map(([name, value]) => ({
      name,
      value,
    }));
    return redactOutput(replaceSecrets(text, replacements));
  }

  /** NAME → value of the package's secrets (empty without a secret store). */
  secretEnv(id: string): Record<string, string> {
    return this.options.secrets?.env(scriptSecretScope(id)) ?? {};
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

  /** Last real run's output (the table automations import), for the editor's 数据 tab. */
  async lastOutput(
    id: string
  ): Promise<{ columns: string[]; rows: Array<Record<string, string>>; total: number } | null> {
    const file = path.join(this.packageDir(id), STATE_DIR, 'output.csv');
    if (!existsSync(file)) return null;
    const table = parseCsv(await readFile(file, 'utf8'));
    const columns = (table[0] ?? []).map((column) => column.trim());
    return {
      columns,
      total: Math.max(0, table.length - 1),
      rows: table.slice(1, PREVIEW_ROWS + 1).map((row) => {
        const record: Record<string, string> = {};
        columns.forEach((column, index) => (record[column] = row[index] ?? ''));
        return record;
      }),
    };
  }

  // ── state ────────────────────────────────────────────────────────────

  private requireRecord(id: string, versionNumber: number): ScriptVersionRecord {
    const record = this.store.list(id).find((item) => item.version === versionNumber);
    if (!record) throw new ScriptPackageError(`找不到版本 v${versionNumber}`, 'invalid');
    return record;
  }

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

const STATUS_LABEL = { draft: '草稿', published: '已发布', archived: '已归档' } as const;

export const SOURCE_LABEL: Record<ScriptVersionSource, string> = {
  chat: '对话生成',
  rule: '规则生成',
  ai_repair: 'AI 修复',
  manual: '手动修改',
};

function toVersion(record: ScriptVersionRecord): ScriptPackageVersion {
  const { packageId: _packageId, automationId: _automationId, commit, ...rest } = record;
  return { ...rest, commit: commit.slice(0, 7) };
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

/** Remove everything except runtime folders (and .gitignore stays only if re-copied). */
async function clearWorkingTree(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir)) {
    if (RUNTIME_DIRS.has(entry) || entry === '.gitignore') continue;
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

async function writeWorkingFiles(dir: string, files: ScriptPackageFile[]): Promise<void> {
  await clearWorkingTree(dir);
  for (const file of files) {
    const rel = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.split('/').some((part) => part === '..' || RUNTIME_DIRS.has(part))) continue;
    const target = path.join(dir, ...rel.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
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
function stringEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string | undefined> {
  return { ...(env ?? {}) };
}

function processLog(result: { stdout: string; stderr: string }): string {
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  return text.length > 4000 ? text.slice(-4000) : text;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkLine(check: ScriptDraftCheck): string {
  return check.passed
    ? `✓ 试运行通过：${check.rows ?? 0} 行 · ${check.columns?.length ?? 0} 列`
    : `✕ 试运行未通过：${check.reason ?? ''}`;
}

/** The 输出预览 block a failed verdict appends to the run log. */
function previewFromLog(log: string | undefined): string | undefined {
  const index = log?.lastIndexOf('输出预览：\n') ?? -1;
  return log && index >= 0 ? log.slice(index + '输出预览：\n'.length) : undefined;
}

/** Shared pass criteria (evaluatePass) applied to a parsed script output. */
export function judgeOutput(
  parsed: ParsedScriptOutput,
  manifestColumns: NonNullable<NonNullable<ScriptManifest['output']>['columns']>,
  log?: string
): { ok: boolean; reason?: string; warnings?: string[] } {
  const table = parseCsv(parsed.csv);
  const columns = parsed.columns;
  const rows = table.slice(1, 501).map((row) => {
    const record: Record<string, string> = {};
    columns.forEach((column, index) => (record[column] = row[index] ?? ''));
    return record;
  });
  return evaluatePass({
    ok: true,
    columns,
    rows,
    totalRows: parsed.rows,
    raggedRows: parsed.raggedRows,
    notices: extractRunNotices(log),
    expectedColumns: normalizeManifestColumns(manifestColumns),
  });
}

/** Read the files of a working tree (runtime folders, .gitignore and binary-looking files skipped). */
async function readWorkingFiles(dir: string, prefix = ''): Promise<ScriptPackageFile[]> {
  const result: ScriptPackageFile[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (RUNTIME_DIRS.has(entry.name) || (!prefix && entry.name === '.gitignore')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await readWorkingFiles(full, rel)));
    else if (entry.isFile()) {
      const content = await readFile(full);
      if (content.includes(0)) continue;
      result.push({ path: rel, content: content.toString('utf8') });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
