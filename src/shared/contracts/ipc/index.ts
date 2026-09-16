/**
 * Cross-process ipc contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
import type { AppConfig } from '../config';
import type {
  ContentBlock,
  Message,
  PermissionRequest,
  PermissionResult,
  PermissionRule,
  Project,
  Session,
  SessionStatus,
  SudoPasswordRequest,
  TraceStep,
} from '../session';
import type { SkillsStorageChangeEvent } from '../skills';

// IPC Event types
export type ClientEvent =
  | {
      type: 'session.start';
      payload: {
        title: string;
        prompt: string;
        cwd?: string;
        allowedTools?: string[];
        permissionRules?: PermissionRule[];
        content?: ContentBlock[];
        memoryEnabled?: boolean;
        selectedSkillNames?: string[];
      };
    }
  | {
      type: 'session.continue';
      payload: {
        sessionId: string;
        prompt: string;
        permissionRules?: PermissionRule[];
        content?: ContentBlock[];
        selectedSkillNames?: string[];
      };
    }
  | { type: 'session.stop'; payload: { sessionId: string } }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
  | { type: 'session.list'; payload: Record<string, never> }
  | { type: 'session.getMessages'; payload: { sessionId: string } }
  | { type: 'session.getTraceSteps'; payload: { sessionId: string } }
  | { type: 'project.rename'; payload: { projectId: string; name: string | null } }
  | { type: 'project.renameByCwd'; payload: { cwd: string; name: string | null } }
  | { type: 'project.delete'; payload: { projectId: string } }
  | { type: 'permission.response'; payload: { toolUseId: string; result: PermissionResult } }
  | { type: 'sudo.password.response'; payload: { toolUseId: string; password: string | null } }
  | { type: 'settings.update'; payload: Record<string, unknown> }
  | { type: 'folder.select'; payload: Record<string, never> }
  | { type: 'workdir.get'; payload: Record<string, never> }
  | { type: 'workdir.set'; payload: { path: string; sessionId?: string } }
  | { type: 'workdir.select'; payload: { sessionId?: string; currentPath?: string } };

// Sandbox setup types (app startup)
export type SandboxSetupPhase =
  | 'checking' // Checking WSL/Lima availability
  | 'creating' // Creating Lima instance (macOS only)
  | 'starting' // Starting Lima instance (macOS only)
  | 'installing_node' // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip' // Installing pip
  | 'installing_deps' // Installing skill dependencies (markitdown, pypdf, etc.)
  | 'ready' // Ready to use
  | 'skipped' // No sandbox needed (native mode)
  | 'error'; // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

// Sandbox sync types (per-session file sync)
export type SandboxSyncPhase =
  | 'starting_agent' // Starting WSL/Lima agent
  | 'syncing_files' // Syncing files to sandbox
  | 'syncing_skills' // Copying skills
  | 'ready' // Sync complete
  | 'error'; // Sync failed

export interface SandboxSyncStatus {
  sessionId: string;
  phase: SandboxSyncPhase;
  message: string;
  detail?: string;
  fileCount?: number;
  totalSize?: number;
}

export type ServerEvent =
  | { type: 'stream.message'; payload: { sessionId: string; message: Message } }
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.reset'; payload: { sessionId: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | {
      type: 'stream.executionTime';
      payload: { sessionId: string; messageId: string; executionTimeMs: number };
    }
  | {
      type: 'session.status';
      payload: { sessionId: string; status: SessionStatus; error?: string };
    }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<Session> } }
  | { type: 'session.list'; payload: { sessions: Session[]; projects?: Project[] } }
  | { type: 'project.list'; payload: { projects: Project[] } }
  | { type: 'project.update'; payload: { project: Project } }
  | { type: 'project.delete'; payload: { projectId: string } }
  | { type: 'permission.request'; payload: PermissionRequest }
  | { type: 'permission.dismiss'; payload: { toolUseId: string } }
  | { type: 'sudo.password.request'; payload: SudoPasswordRequest }
  | { type: 'sudo.password.dismiss'; payload: { toolUseId: string } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | {
      type: 'trace.update';
      payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> };
    }
  | { type: 'folder.selected'; payload: { path: string } }
  | { type: 'config.status'; payload: { isConfigured: boolean; config: AppConfig } }
  | { type: 'sandbox.progress'; payload: SandboxSetupProgress }
  | { type: 'sandbox.sync'; payload: SandboxSyncStatus }
  | { type: 'skills.storageChanged'; payload: SkillsStorageChangeEvent }
  | {
      type: 'plugins.runtimeApplied';
      payload: { sessionId: string; plugins: Array<{ name: string; path: string }> };
    }
  | { type: 'workdir.changed'; payload: { path: string } }
  | { type: 'session.contextInfo'; payload: { sessionId: string; contextWindow: number } }
  | {
      type: 'navigate.to';
      payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string };
    }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | {
      type: 'error';
      payload: {
        message: string;
        code?: 'CONFIG_REQUIRED_ACTIVE_SET';
        action?: 'open_api_settings';
      };
    };
