import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
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
  workspaceRoot?: string;
}

export interface RunInputTableNormalizerProjectResult {
  workDir: string;
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
  const workDir = workDirState.workDir;
  const outputDir = join(workDir, 'output');
  const contextPath = join(workDir, 'context.json');
  const manifestPath = join(workDir, 'manifest.json');
  const startedAt = Date.now();
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    writeProjectFiles(workDir, input.version.files);
    fs.writeFileSync(contextPath, JSON.stringify(input.context, null, 2), 'utf8');

    const variables = createCommandVariables({
      workDir,
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
        const cwd = resolveProjectCwd(workDir, step.cwd);
        const result = await runCommand(
          command,
          cwd,
          input.timeoutMs
        );
        steps.push({ command, cwd, ...result });
        stdout += result.stdout;
        stderr += result.stderr;
      }
    }

    const entrypointCommand = interpolateCommand(input.version.entrypoint.command, variables);
    const entrypointCwd = resolveProjectCwd(workDir, input.version.entrypoint.cwd);
    const entrypointResult = await runCommand(
      entrypointCommand,
      entrypointCwd,
      input.timeoutMs
    );
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
    if (workDirState.cleanupWorkDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function createNormalizerWorkDir(input: RunInputTableNormalizerProjectInput): {
  workDir: string;
  cleanupWorkDir: boolean;
} {
  if (!input.workspaceRoot) {
    return {
      workDir: fs.mkdtempSync(join(os.tmpdir(), 'sophron-normalizer-')),
      cleanupWorkDir: true,
    };
  }
  const versionRoot = join(
    input.workspaceRoot,
    sanitizePathSegment(input.version.artifactId),
    sanitizePathSegment(input.version.id)
  );
  fs.mkdirSync(versionRoot, { recursive: true });
  return {
    workDir: fs.mkdtempSync(join(versionRoot, `${Date.now()}-`)),
    cleanupWorkDir: false,
  };
}

function writeProjectFiles(workDir: string, files: DataInputTableNormalizerArtifactVersion['files']) {
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
  if (!resolved.startsWith(`${resolve(workDir)}${pathSeparator()}`) && resolved !== resolve(workDir)) {
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
  workDir: string;
  outputDir: string;
  contextPath: string;
  manifestPath: string;
  runtime: DataNormalizerRuntime;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  usePreparedRuntime: boolean;
}): Record<string, string> {
  const runtime = input.runtime.executable ?? input.runtime.language;
  const envDir = join(input.workDir, '.normalizer-env');
  const envPython =
    process.platform === 'win32'
      ? join(envDir, 'Scripts', 'python.exe')
      : join(envDir, 'bin', 'python');
  const preparedRuntime = input.usePreparedRuntime
    ? normalizePreparedRuntime(input.dependencyPrepare?.preparedRuntime, envPython) ?? runtime
    : runtime;
  return {
    runtime,
    preparedRuntime,
    envDir,
    envPython,
    context: input.contextPath,
    manifest: input.manifestPath,
    outputDir: input.outputDir,
  };
}

function normalizePreparedRuntime(value: string | undefined, envPython: string): string | undefined {
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
      env: process.env,
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

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 96);
  return sanitized || 'unknown';
}
