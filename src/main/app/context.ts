/**
 * @module main/app/context
 *
 * Shared mutable runtime state for the main process. Services are constructed
 * in app/bootstrap.ts and consumed by feature IPC modules under features/*.
 * A single mutable object keeps call-site semantics identical to the previous
 * module-level `let` variables while making the dependencies explicit.
 */
import type { BrowserWindow, Tray } from 'electron';
import { resolveDesktopAuthOrigin } from '../config/desktop-auth-config';
import { DesktopAuthService } from '../auth/desktop-auth-service';
import type { DatabaseInstance } from '../db/database';
import type { DataPipelineStore } from '../data/data-pipeline-store';
import type { DataCommandService } from '../data/data-command-service';
import type { DataPipelineLlmUsageRecorder } from '../data/data-pipeline-llm-usage-recorder';
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
  dataPipelineStore: DataPipelineStore | null;
  dataCommandService: DataCommandService | null;
  recordDataPipelineLlmUsage: DataPipelineLlmUsageRecorder | undefined;
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
  dataPipelineStore: null,
  dataCommandService: null,
  recordDataPipelineLlmUsage: undefined,
  updateService: null,
  isInstallingUpdate: false,
  startupUpdateCheckScheduled: false,
  tray: null,
  isCleaningUp: false,
  currentWorkingDir: null,
};

export const desktopAuthService = new DesktopAuthService(() => resolveDesktopAuthOrigin());
