import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path';
import type {
  DataInputTableNormalizerArtifactVersion,
  DataNormalizerDependencyPrepareConfig,
  DataNormalizerRuntime,
} from '../../renderer/types';
import {
  parseInputTableNormalizerManifest,
  type InputTableNormalizerManifest,
} from '../../shared/input-table-normalizer/manifest';

export interface RunInputTableNormalizerProjectInput {
  version: DataInputTableNormalizerArtifactVersion;
  context: Record<string, unknown>;
  prepareDependencies?: boolean;
  timeoutMs?: number;
  projectRoot?: string;
  workspaceRoot?: string;
}

export interface RunInputTableNormalizerProjectResult {
  workDir: string;
  projectDir: string;
  cleanupWorkDir: boolean;
  outputDir: string;
  manifestPath: string;
  manifest: InputTableNormalizerManifest;
  stdout: string;
  stderr: string;
  steps: InputTableNormalizerRunStep[];
  durationMs: number;
}

export interface InputTableNormalizerRunStep {
  command: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export async function runInputTableNormalizerProject(
  input: RunInputTableNormalizerProjectInput
): Promise<RunInputTableNormalizerProjectResult> {
  const workDirState = createNormalizerWorkDir(input);
  const projectDir = workDirState.projectDir;
  const workDir = workDirState.runDir;
  const outputDir = join(workDir, 'output');
  const contextPath = join(workDir, 'context.json');
  const manifestPath = join(workDir, 'manifest.json');
  const startedAt = Date.now();
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    writeProjectFiles(projectDir, input.version.files);
    fs.writeFileSync(contextPath, JSON.stringify(input.context, null, 2), 'utf8');

    const variables = createCommandVariables({
      projectDir,
      workDir: projectDir,
      runDir: workDir,
      outputDir,
      contextPath,
      manifestPath,
      runtime: input.version.runtime,
      dependencyPrepare: input.version.dependencyPrepare,
      usePreparedRuntime: input.prepareDependencies === true,
    });
    let stdout = '';
    let stderr = '';
    const steps: InputTableNormalizerRunStep[] = [];
    if (input.prepareDependencies && input.version.dependencyPrepare) {
      for (const step of input.version.dependencyPrepare.steps) {
        const command = interpolateCommand(step.command, variables);
        const cwd = resolveProjectCwd(projectDir, step.cwd);
        const result = await runCommand(command, cwd, input.timeoutMs);
        steps.push({ command, cwd, ...result });
        stdout += result.stdout;
        stderr += result.stderr;
      }
    }

    const entrypointCommand = interpolateCommand(input.version.entrypoint.command, variables);
    const entrypointCwd = resolveProjectCwd(projectDir, input.version.entrypoint.cwd);
    const entrypointResult = await runCommand(entrypointCommand, entrypointCwd, input.timeoutMs);
    steps.push({ command: entrypointCommand, cwd: entrypointCwd, ...entrypointResult });
    stdout += entrypointResult.stdout;
    stderr += entrypointResult.stderr;

    if (!fs.existsSync(manifestPath)) {
      throw new Error('Normalizer did not write a manifest file');
    }
    const manifest = parseInputTableNormalizerManifest(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    );
    const outputPath = resolveManifestOutputPath(outputDir, manifest.output);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Normalizer output file does not exist: ${basename(outputPath)}`);
    }

    return {
      workDir,
      projectDir,
      cleanupWorkDir: workDirState.cleanupWorkDir,
      outputDir,
      manifestPath,
      manifest: {
        ...manifest,
        output: outputPath,
      },
      stdout,
      stderr,
      steps,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    cleanupNormalizerWorkDir(workDirState);
    throw error;
  }
}

function cleanupNormalizerWorkDir(workDirState: NormalizerWorkDirState): void {
  if (workDirState.cleanupProjectDir) {
    fs.rmSync(workDirState.projectDir, { recursive: true, force: true });
  } else if (workDirState.cleanupWorkDir) {
    fs.rmSync(workDirState.runDir, { recursive: true, force: true });
  }
}

interface NormalizerWorkDirState {
  projectDir: string;
  runDir: string;
  cleanupProjectDir: boolean;
  cleanupWorkDir: boolean;
}

function createNormalizerWorkDir(
  input: RunInputTableNormalizerProjectInput
): NormalizerWorkDirState {
  if (input.projectRoot) {
    const projectDir = input.projectRoot;
    const runDir = input.workspaceRoot
      ? createVersionRunDir(input.workspaceRoot, input.version)
      : fs.mkdtempSync(join(os.tmpdir(), 'sophron-normalizer-run-'));
    return {
      projectDir,
      runDir,
      cleanupProjectDir: false,
      cleanupWorkDir: !input.workspaceRoot,
    };
  }

  if (!input.workspaceRoot) {
    const projectDir = fs.mkdtempSync(join(os.tmpdir(), 'sophron-normalizer-'));
    return {
      projectDir,
      runDir: projectDir,
      cleanupProjectDir: true,
      cleanupWorkDir: true,
    };
  }

  const projectDir = createVersionRunDir(input.workspaceRoot, input.version);
  return {
    projectDir,
    runDir: projectDir,
    cleanupProjectDir: false,
    cleanupWorkDir: false,
  };
}

function createVersionRunDir(
  workspaceRoot: string,
  version: DataInputTableNormalizerArtifactVersion
): string {
  const versionRoot = join(
    workspaceRoot,
    sanitizePathSegment(version.artifactId),
    sanitizePathSegment(version.id)
  );
  fs.mkdirSync(versionRoot, { recursive: true });
  return fs.mkdtempSync(join(versionRoot, `${Date.now()}-`));
}

function writeProjectFiles(
  workDir: string,
  files: DataInputTableNormalizerArtifactVersion['files']
) {
  for (const file of files) {
    const targetPath = resolveSafeProjectPath(workDir, file.path);
    fs.mkdirSync(dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, 'utf8');
  }
}

function resolveSafeProjectPath(workDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`Normalizer project file path must be relative: ${filePath}`);
  }
  const resolved = resolve(workDir, filePath);
  if (
    !resolved.startsWith(`${resolve(workDir)}${pathSeparator()}`) &&
    resolved !== resolve(workDir)
  ) {
    throw new Error(`Normalizer project file escapes project root: ${filePath}`);
  }
  return resolved;
}

function resolveProjectCwd(workDir: string, cwd: string | undefined): string {
  return cwd ? resolveSafeProjectPath(workDir, cwd) : workDir;
}

function resolveManifestOutputPath(outputDir: string, output: string): string {
  const resolved = isAbsolute(output) ? resolve(output) : resolve(outputDir, output);
  const root = resolve(outputDir);
  if (!resolved.startsWith(`${root}${pathSeparator()}`) && resolved !== root) {
    throw new Error('Normalizer manifest output must stay inside the output directory');
  }
  return resolved;
}

function createCommandVariables(input: {
  projectDir: string;
  workDir: string;
  runDir: string;
  outputDir: string;
  contextPath: string;
  manifestPath: string;
  runtime: DataNormalizerRuntime;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  usePreparedRuntime: boolean;
}): Record<string, string> {
  const runtime = input.runtime.executable ?? input.runtime.language;
  const envDir = join(input.projectDir, '.normalizer-env');
  const envPython =
    process.platform === 'win32'
      ? join(envDir, 'Scripts', 'python.exe')
      : join(envDir, 'bin', 'python');
  const preparedRuntime = input.usePreparedRuntime
    ? (normalizePreparedRuntime(input.dependencyPrepare?.preparedRuntime, envPython) ?? runtime)
    : runtime;
  return {
    runtime,
    preparedRuntime,
    projectDir: input.projectDir,
    runDir: input.runDir,
    envDir,
    envPython,
    context: input.contextPath,
    manifest: input.manifestPath,
    outputDir: input.outputDir,
  };
}

function normalizePreparedRuntime(
  value: string | undefined,
  envPython: string
): string | undefined {
  if (!value) return undefined;
  return value.replace(/\$\{envPython\}/g, envPython);
}

function interpolateCommand(command: string[], variables: Record<string, string>): string[] {
  return command.map((part) =>
    part.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => variables[name] ?? '')
  );
}

async function runCommand(
  command: string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  if (command.length === 0 || !command[0]) {
    throw new Error('Normalizer command is empty');
  }
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: createNormalizerCommandEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Normalizer command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout, stderr, exitCode: 0, durationMs: Date.now() - startedAt });
      } else {
        const exitCode = code ?? 1;
        reject(
          new Error(
            `Normalizer command failed with exit code ${exitCode}: ${stderr || command.join(' ')}`
          )
        );
      }
    });
  });
}

function createNormalizerCommandEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const bundledBinDirs = resolveBundledRuntimeBinDirs();
  if (bundledBinDirs.length === 0) return env;

  const currentPath = env.PATH || '';
  const existingPaths = currentPath.split(delimiter).filter((part) => part.trim().length > 0);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...bundledBinDirs, ...existingPaths]) {
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  env.PATH = merged.join(delimiter);
  return env;
}

function resolveBundledRuntimeBinDirs(): string[] {
  const candidates: Array<string | null> = [];
  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    candidates.push(resolveBundledNodeBinDir(join(resourcesPath, 'node')));
    candidates.push(resolveBundledPythonBinDir(join(resourcesPath, 'python')));
  }

  for (const projectRoot of resolveProjectRootCandidates()) {
    const platformArch = resolveBundledRuntimePlatformArch();
    candidates.push(resolveBundledNodeBinDir(join(projectRoot, 'resources', 'node', platformArch)));
    candidates.push(
      resolveBundledPythonBinDir(join(projectRoot, 'resources', 'python', platformArch))
    );
  }

  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (!candidate || seen.has(candidate)) return [];
    seen.add(candidate);
    return [candidate];
  });
}

function resolveBundledNodeBinDir(nodeRoot: string): string | null {
  const binDir = process.platform === 'win32' ? nodeRoot : join(nodeRoot, 'bin');
  const nodePath = join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
  return fs.existsSync(nodePath) ? binDir : null;
}

function resolveBundledPythonBinDir(pythonRoot: string): string | null {
  const binDir = process.platform === 'win32' ? pythonRoot : join(pythonRoot, 'bin');
  const pythonPath = join(binDir, process.platform === 'win32' ? 'python.exe' : 'python3');
  return fs.existsSync(pythonPath) ? binDir : null;
}

function resolveBundledRuntimePlatformArch(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return `win32-${arch}`;
  if (process.platform === 'darwin') return `darwin-${arch}`;
  return `linux-${arch}`;
}

function resolveProjectRootCandidates(): string[] {
  const candidates = [
    process.cwd(),
    resolve(__dirname, '..', '..'),
    resolve(__dirname, '..', '..', '..'),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 96);
  return sanitized || 'unknown';
}
