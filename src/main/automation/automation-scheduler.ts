import { existsSync, watch, type FSWatcher } from 'fs';
import { basename, dirname } from 'path';
import type { AutomationService } from './automation-service';
import type { Automation } from '../../shared/automation/types';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TABLE_WATCH_DEBOUNCE_MS = 2_000;

export interface RawTableWatchTarget {
  rawTableId: string;
  sourcePath: string;
  kind: 'file' | 'dir';
}

interface AutomationSchedulerOptions {
  now?: () => number;
  resolveProjectCwd?: (projectId: string) => string | null;
  /** Maps watchable raw-table ids (cloud.sync runOnChange links) to sources. */
  resolveRawTableWatchTargets?: (rawTableIds: string[]) => Promise<RawTableWatchTarget[]>;
  /** Re-imports the table's stored source into DuckDB — the commit fires links. */
  reimportRawTable?: (rawTableId: string) => Promise<void>;
}

interface FileWatcherRecord {
  signature: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class AutomationScheduler {
  private readonly service: AutomationService;
  private readonly now: () => number;
  private readonly resolveProjectCwd?: (projectId: string) => string | null;
  private readonly resolveRawTableWatchTargets?: (
    rawTableIds: string[]
  ) => Promise<RawTableWatchTarget[]>;
  private readonly reimportRawTable?: (rawTableId: string) => Promise<void>;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private readonly fileWatchers = new Map<string, FileWatcherRecord>();
  private readonly tableWatchers = new Map<string, FileWatcherRecord>();
  private tableWatchSyncing = false;
  private tableWatchPending = false;

  constructor(
    service: AutomationService,
    optionsOrNow: AutomationSchedulerOptions | (() => number) = {}
  ) {
    this.service = service;
    if (typeof optionsOrNow === 'function') {
      this.now = optionsOrNow;
      this.resolveProjectCwd = undefined;
      this.resolveRawTableWatchTargets = undefined;
      this.reimportRawTable = undefined;
    } else {
      this.now = optionsOrNow.now ?? (() => Date.now());
      this.resolveProjectCwd = optionsOrNow.resolveProjectCwd;
      this.resolveRawTableWatchTargets = optionsOrNow.resolveRawTableWatchTargets;
      this.reimportRawTable = optionsOrNow.reimportRawTable;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.syncFileWatchers();
    void this.syncTableWatchers();
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const record of this.fileWatchers.values()) {
      record.watcher.close();
      if (record.timer) clearTimeout(record.timer);
    }
    this.fileWatchers.clear();
    for (const record of this.tableWatchers.values()) {
      record.watcher.close();
      if (record.timer) clearTimeout(record.timer);
    }
    this.tableWatchers.clear();
  }

  reschedule(): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.syncFileWatchers();
    void this.syncTableWatchers();
    this.scheduleNextTick();
  }

  /** Re-resolves which raw tables need file watching (e.g. after a source path changes). */
  refreshTableWatchers(): void {
    if (!this.running) return;
    void this.syncTableWatchers();
  }

  // File-backed raw tables linked via runOnChange cloud.sync inputs get a
  // watcher: a source-file change re-imports into DuckDB, and that commit is
  // what fans out to the linked automations.
  private async syncTableWatchers(): Promise<void> {
    if (this.tableWatchSyncing) {
      this.tableWatchPending = true;
      return;
    }
    this.tableWatchSyncing = true;
    try {
      const watchedIds = new Set<string>();
      for (const automation of this.service.list({ status: 'all' }).automations) {
        if (!automation.enabled || automation.status === 'paused') continue;
        for (const node of automation.actionGraph.nodes) {
          if (
            node.type === 'cloud.sync' &&
            node.config.direction === 'input' &&
            node.config.runOnChange === true &&
            typeof node.config.rawTableId === 'string'
          ) {
            watchedIds.add(node.config.rawTableId);
          }
        }
      }
      const targets = this.resolveRawTableWatchTargets
        ? await this.resolveRawTableWatchTargets([...watchedIds])
        : [];
      const desired = new Map(
        targets.map((target) => [
          target.rawTableId,
          { target, signature: JSON.stringify({ path: target.sourcePath, kind: target.kind }) },
        ])
      );
      for (const [rawTableId, record] of this.tableWatchers) {
        const next = desired.get(rawTableId);
        if (next && next.signature === record.signature) continue;
        record.watcher.close();
        if (record.timer) clearTimeout(record.timer);
        this.tableWatchers.delete(rawTableId);
      }
      for (const [rawTableId, next] of desired) {
        if (this.tableWatchers.has(rawTableId)) continue;
        this.tableWatchers.set(rawTableId, this.createTableWatcher(next.target, next.signature));
      }
    } catch (error) {
      console.warn('[Automation] Raw table watcher sync failed:', error);
    } finally {
      this.tableWatchSyncing = false;
      if (this.tableWatchPending) {
        this.tableWatchPending = false;
        void this.syncTableWatchers();
      }
    }
  }

  private createTableWatcher(target: RawTableWatchTarget, signature: string): FileWatcherRecord {
    const record: FileWatcherRecord = { signature, watcher: null as never, timer: null };
    const fire = () => {
      if (record.timer) clearTimeout(record.timer);
      record.timer = setTimeout(() => {
        record.timer = null;
        void this.reimportRawTable?.(target.rawTableId).catch((error) => {
          console.warn('[Automation] Raw table reimport failed:', target.rawTableId, error);
        });
      }, TABLE_WATCH_DEBOUNCE_MS);
    };
    record.watcher =
      target.kind === 'dir'
        ? watchWorkspace(target.sourcePath, () => fire())
        : watch(dirname(target.sourcePath), (_eventType, filename) => {
            // Watch the parent dir so atomic save-rename swaps keep firing.
            if (filename && filename.toString() !== basename(target.sourcePath)) return;
            fire();
          });
    return record;
  }

  private scheduleNextTick(): void {
    if (!this.running || this.ticking) return;
    if (this.timer) clearTimeout(this.timer);
    const nextRunAt = this.service
      .list({ status: 'all' })
      .automations.filter((automation) => automation.enabled && automation.status !== 'paused')
      .map((automation) => automation.nextRunAt)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right)[0];
    const delay = nextRunAt === undefined ? 60_000 : Math.max(0, nextRunAt - this.now());
    this.timer = setTimeout(
      () => {
        void this.tick();
      },
      Math.min(delay, MAX_TIMER_DELAY_MS)
    );
  }

  private syncFileWatchers(): void {
    const desired = new Map<string, { automation: Automation; cwd: string; signature: string }>();
    for (const automation of this.service.list({ status: 'all' }).automations) {
      if (!isFileChangeAutomation(automation)) continue;
      const projectId = automation.trigger.projectId || automation.projectId;
      if (!projectId) continue;
      const cwd = this.resolveProjectCwd?.(projectId);
      if (!cwd || !existsSync(cwd)) continue;
      const signature = JSON.stringify({
        cwd,
        patterns: automation.trigger.patterns,
        debounceMs: automation.trigger.debounceMs,
      });
      desired.set(automation.id, { automation, cwd, signature });
    }

    for (const [automationId, record] of this.fileWatchers) {
      const next = desired.get(automationId);
      if (next && next.signature === record.signature) continue;
      record.watcher.close();
      if (record.timer) clearTimeout(record.timer);
      this.fileWatchers.delete(automationId);
    }

    for (const [automationId, next] of desired) {
      if (this.fileWatchers.has(automationId)) continue;
      this.fileWatchers.set(
        automationId,
        this.createFileWatcher(next.automation, next.cwd, next.signature)
      );
    }
  }

  private createFileWatcher(
    automation: Automation,
    cwd: string,
    signature: string
  ): FileWatcherRecord {
    const trigger = automation.trigger.kind === 'file_change' ? automation.trigger : null;
    const debounceMs = trigger?.debounceMs ?? 30_000;
    const patterns = trigger?.patterns ?? ['**/*'];
    const record: FileWatcherRecord = {
      signature,
      watcher: watchWorkspace(cwd, (filename) => {
        const relativePath = typeof filename === 'string' ? filename : (filename?.toString() ?? '');
        if (!matchesAnyPattern(relativePath, patterns)) return;
        if (record.timer) clearTimeout(record.timer);
        record.timer = setTimeout(() => {
          record.timer = null;
          void this.service.runTriggered(automation.id, 'file_change');
        }, debounceMs);
      }),
      timer: null,
    };
    return record;
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.running || this.ticking) return;
    this.ticking = true;
    let failed = false;
    try {
      await this.service.runDueAutomations();
    } catch (error) {
      failed = true;
      console.warn('[Automation] Scheduler tick failed:', error);
    } finally {
      this.ticking = false;
      if (failed && this.running) {
        this.timer = setTimeout(() => {
          void this.tick();
        }, 5000);
      } else {
        this.scheduleNextTick();
      }
    }
  }
}

function isFileChangeAutomation(
  automation: Automation
): automation is Automation & { trigger: Extract<Automation['trigger'], { kind: 'file_change' }> } {
  return (
    automation.enabled &&
    automation.status !== 'paused' &&
    automation.trigger.kind === 'file_change'
  );
}

function matchesAnyPattern(relativePath: string, patterns: string[]): boolean {
  if (!relativePath) return true;
  const normalizedPath = relativePath.replaceAll('\\', '/');
  return (
    patterns.length === 0 || patterns.some((pattern) => globToRegExp(pattern).test(normalizedPath))
  );
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replaceAll('\\', '/') || '**/*';
  if (normalized === '**/*' || normalized === '**') {
    return /^.*$/;
  }
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
}

function watchWorkspace(
  cwd: string,
  listener: (filename: string | Buffer | null) => void
): FSWatcher {
  try {
    return watch(cwd, { recursive: true }, (_eventType, filename) => listener(filename));
  } catch {
    return watch(cwd, (_eventType, filename) => listener(filename));
  }
}
