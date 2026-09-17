/**
 * Bundled-toolchain environment for the agent runner: resolves packaged
 * node/python/tool bin directories and enriches process.env.PATH for
 * packaged builds (login-shell and registry fallbacks included).
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { log, logWarn } from '../utils/logger';
import { getDefaultShell } from '../utils/shell-resolver';

export const VIRTUAL_WORKSPACE_PATH = '/workspace';

/**
 * Estimate chars-per-token ratio based on content language.
 * CJK characters tokenize at ~1.5 chars/token vs ~4 for English.
 */
export function estimateCharsPerToken(sampleText: string): number {
  if (!sampleText || sampleText.length === 0) return 4;
  const sample = sampleText.substring(0, 500);
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || [])
    .length;
  const cjkRatio = cjkCount / sample.length;
  return 4 - cjkRatio * 2.5; // Range: 1.5 (pure CJK) ~ 4 (pure English)
}

// Bundled node/npx paths never change at runtime — resolve once.
let cachedBundledNodePaths: { node: string; npx: string } | null | undefined = undefined;

export function getBundledNodePaths(): { node: string; npx: string } | null {
  if (cachedBundledNodePaths !== undefined) {
    return cachedBundledNodePaths;
  }
  const platform = process.platform;
  const arch = process.arch;
  let resourcesPath: string;
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    resourcesPath = path.join(projectRoot, 'resources', 'node', `${platform}-${arch}`);
  } else {
    resourcesPath = path.join(process.resourcesPath, 'node');
  }
  const binDir = platform === 'win32' ? resourcesPath : path.join(resourcesPath, 'bin');
  const nodePath = path.join(binDir, platform === 'win32' ? 'node.exe' : 'node');
  const npxPath = path.join(binDir, platform === 'win32' ? 'npx.cmd' : 'npx');
  cachedBundledNodePaths =
    fs.existsSync(nodePath) && fs.existsSync(npxPath) ? { node: nodePath, npx: npxPath } : null;
  return cachedBundledNodePaths;
}

/**
 * Resolve bundled Python bin directory path (if available).
 * Checks packaged and dev layouts, returns the bin dir containing python3.
 */
export function resolveBundledPythonBinDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    if (platform === 'darwin') {
      candidates.push(path.join(projectRoot, 'resources', 'python', `darwin-${arch}`, 'bin'));
    }
    candidates.push(path.join(projectRoot, 'resources', 'python', 'bin'));
  } else {
    // Packaged layout: Resources/python/bin/python3
    candidates.push(path.join(process.resourcesPath, 'python', 'bin'));
  }

  const pythonExe = platform === 'win32' ? 'python.exe' : 'python3';
  for (const binDir of candidates) {
    if (fs.existsSync(path.join(binDir, pythonExe))) return binDir;
  }
  return null;
}

/**
 * Resolve bundled tools directory (cliclick etc., macOS only).
 */
export function resolveBundledToolsBinDir(): string | null {
  if (process.platform !== 'darwin') return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    candidates.push(path.join(projectRoot, 'resources', 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(projectRoot, 'resources', 'tools', 'bin'));
  } else {
    candidates.push(path.join(process.resourcesPath, 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(process.resourcesPath, 'tools', 'bin'));
  }

  for (const binDir of candidates) {
    if (fs.existsSync(binDir)) return binDir;
  }
  return null;
}

/**
 * One-time enrichment of process.env.PATH for build (production) mode.
 *
 * In dev mode, Electron inherits the user's full shell PATH, so Skill commands
 * like `python3` and `node` just work. In build mode, `process.env.PATH` is
 * minimal (often just `/usr/bin:/bin`).
 *
 * This function:
 * 1. Restores the user's login-shell PATH (safe: uses execFileSync, not execSync)
 * 2. Prepends bundled Node, Python, and tools bin dirs (highest priority)
 * 3. Deduplicates all entries
 * 4. Writes the result back to `process.env.PATH`
 *
 * Called once before the first `createCodingTools()` — subsequent calls are no-ops.
 */
let pathEnriched = false;

export async function enrichProcessPathForBuild(): Promise<void> {
  if (pathEnriched) return;
  pathEnriched = true;

  if (!app.isPackaged) {
    log('[AgentRunner] Dev mode — skipping PATH enrichment');
    return;
  }

  const platform = process.platform;
  const delimiter = platform === 'win32' ? ';' : ':';
  const currentPaths = (process.env.PATH || '').split(delimiter).filter((p: string) => p.trim());

  // 1. Restore user's login-shell PATH
  let shellPaths: string[] = [];
  if (platform === 'darwin' || platform === 'linux') {
    try {
      const shell = getDefaultShell();
      const output = (
        execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, HOME: os.homedir() },
        }) as string
      ).trim();
      if (output) {
        shellPaths = output.split(':').filter((p: string) => p.trim());
        log(`[AgentRunner] Restored ${shellPaths.length} paths from login shell`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore shell PATH: ${message}`);
    }
  } else if (platform === 'win32') {
    try {
      const output = (
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { encoding: 'utf-8', timeout: 5000 }
        ) as string
      ).trim();
      if (output) {
        shellPaths = output.split(';').filter((p: string) => p.trim());
        log(`[AgentRunner] Restored ${shellPaths.length} paths from Windows registry`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore Windows PATH: ${message}`);
    }
  }

  // 2. Collect bundled bin directories (highest priority)
  const bundledDirs: string[] = [];

  const nodePaths = getBundledNodePaths();
  if (nodePaths) {
    bundledDirs.push(path.dirname(nodePaths.node));
  }

  const pythonBinDir = resolveBundledPythonBinDir();
  if (pythonBinDir) {
    bundledDirs.push(pythonBinDir);
  }

  const toolsBinDir = resolveBundledToolsBinDir();
  if (toolsBinDir) {
    bundledDirs.push(toolsBinDir);
  }

  // 3. Merge: bundled (highest) → shell → current process, deduplicate
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of [...bundledDirs, ...shellPaths, ...currentPaths]) {
    const normalized = platform === 'win32' ? p.toLowerCase() : p;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(p);
    }
  }

  process.env.PATH = merged.join(delimiter);
  log(
    `[AgentRunner] Enriched process.env.PATH for build mode: ${bundledDirs.length} bundled + ${shellPaths.length} shell + ${currentPaths.length} process → ${merged.length} total`
  );
}
