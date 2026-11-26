/**
 * Skills resolution and sync for the agent runner: builtin/user/configured
 * skills directories, runtime-plugin skill paths, and bundled-executable
 * prompt hints. Extracted from AgentRunner — runner delegates here.
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ServerEvent } from '../../shared/contracts';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { configStore } from '../config/config-store';
import { log, logWarn } from '../utils/logger';
import { getAppStorageDir } from '../utils/app-storage';
import { resolveBuiltinSkillsPath } from '../utils/builtin-skills-path';
import { getBundledNodePaths, resolveBundledPythonBinDir } from './agent-runner-env';

export interface AgentRunnerSkillsDeps {
  skillsAdapter?: SkillsAdapter;
  pluginRuntimeService?: PluginRuntimeService;
  sendToRenderer: (event: ServerEvent) => void;
}

export class AgentRunnerSkills {
  private setupComplete = false;

  constructor(private readonly deps: AgentRunnerSkillsDeps) {}

  invalidateSetup(): void {
    this.setupComplete = false;
  }

  prepareRuntimeDirectory(): string {
    const appAgentDir = this.getAppAgentDir();
    if (this.setupComplete) return appAgentDir;
    if (!fs.existsSync(appAgentDir)) {
      fs.mkdirSync(appAgentDir, { recursive: true });
    }

    const appSkillsDir = this.getRuntimeSkillsDir();
    if (!fs.existsSync(appSkillsDir)) {
      fs.mkdirSync(appSkillsDir, { recursive: true });
    }

    // Copy built-in skills to app agent skills directory if they don't exist
    const builtinSkillsPath = this.getBuiltinSkillsPath();
    if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
      // Symlinks into .asar archives don't work at the OS level (ENOTDIR),
      // so always copy when the source is inside an asar archive.
      // Use regex to match .asar/ but NOT .asar.unpacked/ (which is a real directory).
      const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
      const builtinSkills = fs.readdirSync(builtinSkillsPath);
      for (const skillName of builtinSkills) {
        const builtinSkillPath = path.join(builtinSkillsPath, skillName);
        const userSkillPath = path.join(appSkillsDir, skillName);

        // Clean up broken symlinks pointing into .asar from previous versions
        try {
          const lstat = fs.lstatSync(userSkillPath);
          if (lstat.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(userSkillPath);
            if (/\.asar[/\\]/.test(linkTarget)) {
              fs.unlinkSync(userSkillPath);
              log(`[AgentRunner] Removed broken asar symlink: ${userSkillPath}`);
            }
          }
        } catch {
          // Path doesn't exist — fine, we'll create it below
        }

        // Only set up if it's a directory and doesn't exist in app directory
        if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
          if (sourceInsideAsar) {
            // Source is inside .asar — must copy (symlinks to asar paths fail at OS level)
            this.copyDirectorySync(builtinSkillPath, userSkillPath);
            log(`[AgentRunner] Copied built-in skill from asar: ${skillName}`);
          } else {
            // Source is a real directory — symlink for space efficiency
            try {
              fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
              log(`[AgentRunner] Linked built-in skill: ${skillName}`);
            } catch (err) {
              logWarn(`[AgentRunner] Failed to symlink ${skillName}, copying instead:`, err);
              this.copyDirectorySync(builtinSkillPath, userSkillPath);
            }
          }
        }
      }
    }

    this.syncUserSkillsToAppDir(appSkillsDir);
    this.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
    this.setupComplete = true;
    return appAgentDir;
  }

  getBundledPathHints(): string {
    if (!app.isPackaged) return '';

    const hints: string[] = [];

    const nodePaths = getBundledNodePaths();
    if (nodePaths) {
      hints.push(`- node: ${nodePaths.node}`);
      hints.push(`- npx: ${nodePaths.npx}`);
    }

    const pythonBinDir = resolveBundledPythonBinDir();
    if (pythonBinDir) {
      const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python3';
      const pipExe = process.platform === 'win32' ? 'pip.exe' : 'pip3';
      hints.push(`- python3: ${path.join(pythonBinDir, pythonExe)}`);
      if (fs.existsSync(path.join(pythonBinDir, pipExe))) {
        hints.push(`- pip3: ${path.join(pythonBinDir, pipExe)}`);
      }
    }

    if (hints.length === 0) return '';

    return `<bundled_executables>
This application bundles its own executables. When executing commands, prefer these absolute paths:
${hints.join('\n')}
</bundled_executables>`;
  }

  /** Fallback skill path resolution when SkillsAdapter is not provided. */
  private legacySkillPaths(): string[] {
    const paths: string[] = [];
    const builtin = this.getBuiltinSkillsPath();
    if (builtin && fs.existsSync(builtin)) paths.push(builtin);
    const global = this.getConfiguredGlobalSkillsDir();
    if (global && fs.existsSync(global)) paths.push(global);
    return paths;
  }

  async resolveSkillPaths(sessionId?: string): Promise<string[]> {
    const basePaths = this.deps.skillsAdapter
      ? this.deps.skillsAdapter.getSkillPaths()
      : this.legacySkillPaths();
    const mergedPaths = new Set(
      basePaths.filter((item): item is string => Boolean(item && fs.existsSync(item)))
    );
    const appliedPlugins: Array<{ name: string; path: string }> = [];

    if (this.deps.pluginRuntimeService) {
      try {
        const runtimePlugins = await this.deps.pluginRuntimeService.getEnabledRuntimePlugins();
        for (const plugin of runtimePlugins) {
          if (!plugin.componentsEnabled.skills || plugin.componentCounts.skills <= 0) {
            continue;
          }
          const runtimeSkillsPath = path.join(plugin.runtimePath, 'skills');
          if (!fs.existsSync(runtimeSkillsPath)) {
            continue;
          }
          mergedPaths.add(runtimeSkillsPath);
          appliedPlugins.push({ name: plugin.name, path: runtimeSkillsPath });
        }
      } catch (error) {
        logWarn('[AgentRunner] Failed to resolve runtime plugin skill paths:', error);
      }
    }

    if (sessionId && appliedPlugins.length > 0) {
      this.deps.sendToRenderer({
        type: 'plugins.runtimeApplied',
        payload: { sessionId, plugins: appliedPlugins },
      });
    }

    return Array.from(mergedPaths);
  }

  /**
   * Get the built-in skills directory (shipped with the app)
   */
  getBuiltinSkillsPath(): string {
    // In development, skills are in the project's assets/skills directory
    // In production, they're extracted via extraResources to resources/skills
    const found = resolveBuiltinSkillsPath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      moduleDir: __dirname,
    });
    if (found) {
      log('[AgentRunner] Found built-in skills at:', found);
    } else {
      logWarn('[AgentRunner] No built-in skills directory found');
    }
    return found;
  }

  getAppAgentDir(): string {
    return getAppStorageDir();
  }

  getRuntimeSkillsDir(): string {
    return path.join(this.getAppAgentDir(), 'skills');
  }

  private getConfiguredGlobalSkillsDir(): string {
    const configuredPath = (configStore.get('globalSkillsPath') || '').trim();
    if (!configuredPath) {
      return this.getRuntimeSkillsDir();
    }

    const resolvedPath = path.resolve(configuredPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }
      if (fs.statSync(resolvedPath).isDirectory()) {
        return resolvedPath;
      }
      logWarn(
        '[AgentRunner] Configured skills path is not a directory, fallback to runtime path:',
        resolvedPath
      );
    } catch (error) {
      logWarn(
        '[AgentRunner] Configured skills path is unavailable, fallback to runtime path:',
        resolvedPath,
        error
      );
    }

    return this.getRuntimeSkillsDir();
  }

  private getExternalClaudeSkillsDir(): string {
    return path.join(app.getPath('home'), '.claude', 'skills');
  }

  syncUserSkillsToAppDir(appSkillsDir: string): void {
    const userSkillsDir = this.getExternalClaudeSkillsDir();
    if (!fs.existsSync(userSkillsDir)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(userSkillsDir, entry.name);
      const targetPath = path.join(appSkillsDir, entry.name);

      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.lstatSync(targetPath);
          if (!stat.isSymbolicLink()) {
            continue;
          }
          fs.unlinkSync(targetPath);
        } catch {
          continue;
        }
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[AgentRunner] Failed to import user skill:', entry.name, copyErr);
        }
      }
    }
  }

  syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir: string): void {
    const configuredSkillsDir = this.getConfiguredGlobalSkillsDir();
    if (configuredSkillsDir === runtimeSkillsDir) {
      return;
    }
    if (!fs.existsSync(configuredSkillsDir) || !fs.statSync(configuredSkillsDir).isDirectory()) {
      return;
    }

    const entries = fs.readdirSync(configuredSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(configuredSkillsDir, entry.name);
      const targetPath = path.join(runtimeSkillsDir, entry.name);
      try {
        if (fs.existsSync(targetPath)) {
          // Use lstatSync so we don't follow symlinks — check the entry itself
          const stat = fs.lstatSync(targetPath);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(targetPath);
          } else {
            fs.rmSync(targetPath, { recursive: true, force: true });
          }
        }
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[AgentRunner] Failed to sync configured skill:', entry.name, copyErr);
        }
      }
    }
  }

  copyDirectorySync(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source);
    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        this.copyDirectorySync(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }
}
