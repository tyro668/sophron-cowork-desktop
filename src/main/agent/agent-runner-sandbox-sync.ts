/**
 * Sandbox filesystem sync for a run: when WSL or Lima isolation is active,
 * mirror the working directory into the sandbox and copy skills over. Returns
 * the sandbox path so the runner can rewrite cwd and scrub paths in output.
 */
import { execFileSync } from 'child_process';
import type { Session, ServerEvent } from '../../shared/contracts';
import type { AgentRunnerSkills } from './agent-runner-skills';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { pathConverter } from '../sandbox/wsl-bridge';
import { SandboxSync } from '../sandbox/sandbox-sync';
import * as fs from 'fs';
import { getLimaInstanceName } from '../sandbox/lima-instance-name';
import { log, logError } from '../utils/logger';

export interface SandboxSyncResult {
  sandboxPath: string | null;
  useSandboxIsolation: boolean;
  sandbox: ReturnType<typeof getSandboxAdapter>;
}

export async function initSandboxSyncForRun(args: {
  session: Session;
  workingDir: string | undefined;
  sendToRenderer: (event: ServerEvent) => void;
  skills: AgentRunnerSkills;
}): Promise<SandboxSyncResult> {
  const { session, workingDir, sendToRenderer, skills } = args;
  let sandboxPath: string | null = null;
  let useSandboxIsolation = false;
  // Initialize sandbox sync if WSL mode is active
  const sandbox = getSandboxAdapter();

  if (sandbox.isWSL && sandbox.wslStatus?.distro && workingDir) {
    log('[AgentRunner] WSL mode active, initializing sandbox sync...');

    // Only show sync UI for new sessions (first message)
    const isNewSession = !SandboxSync.hasSession(session.id);

    if (isNewSession) {
      // Notify UI: syncing files (only for new sessions)
      sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId: session.id,
          phase: 'syncing_files',
          message: 'Syncing files to sandbox...',
          detail: 'Copying project files to isolated WSL environment',
        },
      });
    }

    const syncResult = await SandboxSync.initSync(workingDir, session.id, sandbox.wslStatus.distro);

    if (syncResult.success) {
      sandboxPath = syncResult.sandboxPath;
      useSandboxIsolation = true;
      log(`[AgentRunner] Sandbox initialized: ${sandboxPath}`);
      log(`[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`);

      if (isNewSession) {
        // Update UI with file count (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'syncing_skills',
            message: 'Configuring skills...',
            detail: 'Copying built-in skills to sandbox',
            fileCount: syncResult.fileCount,
            totalSize: syncResult.totalSize,
          },
        });
      }

      // Copy skills to sandbox ~/.claude/skills/
      const builtinSkillsPath = skills.getBuiltinSkillsPath();
      try {
        const distro = sandbox.wslStatus!.distro!;
        const sandboxSkillsPath = `${sandboxPath}/.claude/skills`;

        // Create .claude/skills directory in sandbox
        execFileSync('wsl', ['-d', distro, '-e', 'mkdir', '-p', sandboxSkillsPath], {
          encoding: 'utf-8',
          timeout: 10000,
        });

        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          // Use rsync via execFileSync with array args to avoid shell injection
          const wslSourcePath = pathConverter.toWSL(builtinSkillsPath);
          log(
            `[AgentRunner] Copying skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'wsl',
            ['-d', distro, '-e', 'rsync', '-av', wslSourcePath + '/', sandboxSkillsPath + '/'],
            {
              encoding: 'utf-8',
              timeout: 120000, // 2 min timeout for large skill directories
            }
          );
        }

        const appSkillsDir = skills.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }
        skills.syncUserSkillsToAppDir(appSkillsDir);
        skills.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

        if (fs.existsSync(appSkillsDir)) {
          const wslSourcePath = pathConverter.toWSL(appSkillsDir);
          log(
            `[AgentRunner] Copying app skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'wsl',
            ['-d', distro, '-e', 'rsync', '-avL', wslSourcePath + '/', sandboxSkillsPath + '/'],
            {
              encoding: 'utf-8',
              timeout: 120000, // 2 min timeout for large skill directories
            }
          );
        }

        // List copied skills for verification
        const copiedSkills = execFileSync('wsl', ['-d', distro, '-e', 'ls', sandboxSkillsPath], {
          encoding: 'utf-8',
          timeout: 10000,
        })
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);

        log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
        log(`[AgentRunner]   Skills: ${copiedSkills.join(', ')}`);
      } catch (error) {
        logError('[AgentRunner] Failed to copy skills to sandbox:', error);
      }

      if (isNewSession) {
        // Notify UI: sync complete (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'ready',
            message: 'Sandbox ready',
            detail: `Synced ${syncResult.fileCount} files`,
            fileCount: syncResult.fileCount,
            totalSize: syncResult.totalSize,
          },
        });
      }
    } else {
      logError('[AgentRunner] Sandbox sync failed:', syncResult.error);
      log('[AgentRunner] Falling back to /mnt/ access (less secure)');

      if (isNewSession) {
        // Notify UI: error (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'error',
            message: 'Sandbox file sync failed, falling back to direct access mode',
            detail: 'Falling back to direct access mode (less secure)',
          },
        });
      }
    }
  }

  // Initialize sandbox sync if Lima mode is active
  if (sandbox.isLima && sandbox.limaStatus?.instanceRunning && workingDir) {
    log('[AgentRunner] Lima mode active, initializing sandbox sync...');

    const { LimaSync } = await import('../sandbox/lima-sync');

    // Only show sync UI for new sessions (first message)
    const isNewLimaSession = !LimaSync.hasSession(session.id);

    if (isNewLimaSession) {
      // Notify UI: syncing files (only for new sessions)
      sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId: session.id,
          phase: 'syncing_files',
          message: 'Syncing files to sandbox...',
          detail: 'Copying project files to isolated Lima environment',
        },
      });
    }

    const syncResult = await LimaSync.initSync(workingDir, session.id);

    if (syncResult.success) {
      sandboxPath = syncResult.sandboxPath;
      useSandboxIsolation = true;
      log(`[AgentRunner] Sandbox initialized: ${sandboxPath}`);
      log(`[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`);

      if (isNewLimaSession) {
        // Update UI with file count (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'syncing_skills',
            message: 'Configuring skills...',
            detail: 'Copying built-in skills to sandbox',
            fileCount: syncResult.fileCount,
            totalSize: syncResult.totalSize,
          },
        });
      }

      // Copy skills to sandbox ~/.claude/skills/
      const builtinSkillsPath = skills.getBuiltinSkillsPath();
      try {
        const sandboxSkillsPath = `${sandboxPath}/.claude/skills`;

        // Create .claude/skills directory in sandbox
        execFileSync(
          'limactl',
          ['shell', getLimaInstanceName(), '--', 'mkdir', '-p', sandboxSkillsPath],
          {
            encoding: 'utf-8',
            timeout: 10000,
          }
        );

        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          // Use rsync via execFileSync with array args to avoid shell injection
          // Lima mounts /Users directly, so paths are the same
          log(
            `[AgentRunner] Copying skills with rsync: ${builtinSkillsPath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'limactl',
            [
              'shell',
              getLimaInstanceName(),
              '--',
              'rsync',
              '-av',
              builtinSkillsPath + '/',
              sandboxSkillsPath + '/',
            ],
            {
              encoding: 'utf-8',
              timeout: 120000, // 2 min timeout for large skill directories
            }
          );
        }

        const appSkillsDir = skills.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }
        skills.syncUserSkillsToAppDir(appSkillsDir);
        skills.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

        if (fs.existsSync(appSkillsDir)) {
          log(
            `[AgentRunner] Copying app skills with rsync: ${appSkillsDir}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'limactl',
            [
              'shell',
              getLimaInstanceName(),
              '--',
              'rsync',
              '-avL',
              appSkillsDir + '/',
              sandboxSkillsPath + '/',
            ],
            {
              encoding: 'utf-8',
              timeout: 120000, // 2 min timeout for large skill directories
            }
          );
        }

        // List copied skills for verification
        const copiedSkills = execFileSync(
          'limactl',
          ['shell', getLimaInstanceName(), '--', 'ls', sandboxSkillsPath],
          {
            encoding: 'utf-8',
            timeout: 10000,
          }
        )
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);

        log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
        log(`[AgentRunner]   Skills: ${copiedSkills.join(', ')}`);
      } catch (error) {
        logError('[AgentRunner] Failed to copy skills to sandbox:', error);
      }

      if (isNewLimaSession) {
        // Notify UI: sync complete (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'ready',
            message: 'Sandbox ready',
            detail: `Synced ${syncResult.fileCount} files`,
            fileCount: syncResult.fileCount,
            totalSize: syncResult.totalSize,
          },
        });
      }
    } else {
      logError('[AgentRunner] Sandbox sync failed:', syncResult.error);
      log('[AgentRunner] Falling back to direct access (less secure)');

      if (isNewLimaSession) {
        // Notify UI: error (only for new sessions)
        sendToRenderer({
          type: 'sandbox.sync',
          payload: {
            sessionId: session.id,
            phase: 'error',
            message: 'Sandbox file sync failed, falling back to direct access mode',
            detail: 'Falling back to direct access mode (less secure)',
          },
        });
      }
    }
  }

  return { sandboxPath, useSandboxIsolation, sandbox };
}
