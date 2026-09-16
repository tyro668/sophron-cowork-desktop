/**
 * @module main/app/context
 *
 * Shared mutable runtime state for the main process. Services are constructed
 * in app/bootstrap.ts and consumed by feature IPC modules under features/*.
 * A single mutable object keeps call-site semantics identical to the previous
 * module-level `let` variables while making the dependencies explicit.
 */
import type { BrowserWindow, Tray } from 'electron';
import { configStore } from '../config/config-store';
import { resolveDesktopAuthOrigin } from '../config/desktop-auth-config';
import { DesktopAuthService } from '../auth/desktop-auth-service';
import type { DatabaseInstance } from '../db/database';
import type { DataTaskStore } from '../data/data-task-store';
import type { DataCommandService } from '../data/data-command-service';
import type { DataTaskLlmUsageRecorder } from '../data/data-task-llm-usage-recorder';
import type { SessionManager } from '../session/session-manager';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { MemoryService } from '../memory/memory-service';
import type { AutomationStore } from '../automation/automation-store';
import type { AutomationService } from '../automation/automation-service';
import type { AutomationScheduler } from '../automation/automation-scheduler';
import type { UpdateService } from '../update/update-service';

export interface AppContext {
  /** Primary application window (null when closed). */
  mainWindow: BrowserWindow | null;
  sessionManager: SessionManager | null;
  appDatabase: DatabaseInstance | null;
  skillsManager: SkillsManager | null;
  pluginRuntimeService: PluginRuntimeService | null;
  memoryService: MemoryService | null;
  automationStore: AutomationStore | null;
  automationService: AutomationService | null;
  automationScheduler: AutomationScheduler | null;
  dataTaskStore: DataTaskStore | null;
  dataCommandService: DataCommandService | null;
  recordDataTaskLlmUsage: DataTaskLlmUsageRecorder | undefined;
  updateService: UpdateService | null;
  /** Set while a downloaded update is being installed — skips quit cleanup. */
  isInstallingUpdate: boolean;
  startupUpdateCheckScheduled: boolean;
  /** Tray instance (kept here to prevent GC). */
  tray: Tray | null;
  /** Guards cleanupSandboxResources against re-entry. */
  isCleaningUp: boolean;
  /** Current working directory (persisted between sessions). */
  currentWorkingDir: string | null;
}

export const appContext: AppContext = {
  mainWindow: null,
  sessionManager: null,
  appDatabase: null,
  skillsManager: null,
  pluginRuntimeService: null,
  memoryService: null,
  automationStore: null,
  automationService: null,
  automationScheduler: null,
  dataTaskStore: null,
  dataCommandService: null,
  recordDataTaskLlmUsage: undefined,
  updateService: null,
  isInstallingUpdate: false,
  startupUpdateCheckScheduled: false,
  tray: null,
  isCleaningUp: false,
  currentWorkingDir: null,
};

export const desktopAuthService = new DesktopAuthService(() =>
  resolveDesktopAuthOrigin(configStore.get('personalAnalysis')?.apiOrigin)
);
