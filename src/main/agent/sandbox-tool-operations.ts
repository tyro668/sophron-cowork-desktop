import { spawn, type ChildProcess } from 'child_process';
import {
  createBashTool,
  createCodingTools,
  createEditTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from '@mariozechner/pi-coding-agent';
import { getLimaInstanceName } from '../sandbox/lima-instance-name';

const VIRTUAL_WORKSPACE_PATH = '/workspace';
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export type SandboxToolMode =
  | {
      type: 'wsl';
      distro: string;
    }
  | {
      type: 'lima';
      instanceName?: string;
    };

interface SandboxCommandResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveSandboxPath(absolutePath: string, cwd: string): string {
  if (absolutePath === VIRTUAL_WORKSPACE_PATH) {
    return cwd;
  }
  if (absolutePath.startsWith(`${VIRTUAL_WORKSPACE_PATH}/`)) {
    return `${cwd}${absolutePath.slice(VIRTUAL_WORKSPACE_PATH.length)}`;
  }
  return absolutePath;
}

function rewriteVirtualWorkspaceReferences(command: string, cwd: string): string {
  return command.replace(/\/workspace(?=\/|\s|$)/g, shellQuote(cwd));
}

function buildSandboxShellInvocation(
  mode: SandboxToolMode,
  script: string
): {
  command: string;
  args: string[];
} {
  if (mode.type === 'wsl') {
    return {
      command: 'wsl',
      args: ['-d', mode.distro, '-e', '/bin/bash', '-lc', script],
    };
  }

  return {
    command: 'limactl',
    args: ['shell', mode.instanceName || getLimaInstanceName(), '--', '/bin/bash', '-lc', script],
  };
}

function terminateSandboxProcess(child: ChildProcess): void {
  if (child.pid) {
    try {
      child.kill('SIGTERM');
      return;
    } catch {
      // Fall through to the generic kill path below.
    }
  }

  try {
    child.kill();
  } catch {
    // Ignore; the process may have already exited.
  }
}

function runSandboxShell(
  mode: SandboxToolMode,
  script: string,
  options: {
    input?: Buffer | string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onData?: (data: Buffer) => void;
  } = {}
): Promise<SandboxCommandResult> {
  const invocation = buildSandboxShellInvocation(mode, script);

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('close', onClose);
      child.off('error', onError);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const settleResolve = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    };

    function onStdout(data: Buffer) {
      stdout.push(data);
      options.onData?.(data);
    }

    function onStderr(data: Buffer) {
      stderr.push(data);
      options.onData?.(data);
    }

    function onAbort() {
      terminateSandboxProcess(child);
      settleReject(new Error('aborted'));
    }

    function onError(error: Error) {
      settleReject(error);
    }

    function onClose(code: number | null) {
      if (options.signal?.aborted) {
        settleReject(new Error('aborted'));
        return;
      }
      if (timedOut) {
        settleReject(new Error(`timeout:${options.timeoutMs ?? 0}`));
        return;
      }
      settleResolve(code);
    }

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('close', onClose);
    child.once('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateSandboxProcess(child);
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

async function runCheckedSandboxShell(
  mode: SandboxToolMode,
  script: string,
  options?: Parameters<typeof runSandboxShell>[2]
): Promise<SandboxCommandResult> {
  const result = await runSandboxShell(mode, script, options);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString('utf-8').trim();
    const stdout = result.stdout.toString('utf-8').trim();
    throw new Error(stderr || stdout || `Sandbox command exited with code ${result.exitCode}`);
  }
  return result;
}

function buildEnvExports(env?: NodeJS.ProcessEnv): string {
  if (!env) return '';

  return Object.entries(env)
    .filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string';
    })
    .map(([key, value]) => `export ${key}=${shellQuote(value)};`)
    .join(' ');
}

function createSandboxReadOperations(mode: SandboxToolMode, cwd: string): ReadOperations {
  return {
    readFile: async (absolutePath) => {
      const path = resolveSandboxPath(absolutePath, cwd);
      const result = await runCheckedSandboxShell(mode, `base64 -w 0 ${shellQuote(path)}`);
      return Buffer.from(result.stdout.toString('utf-8').trim(), 'base64');
    },
    access: async (absolutePath) => {
      const path = resolveSandboxPath(absolutePath, cwd);
      await runCheckedSandboxShell(mode, `test -r ${shellQuote(path)}`);
    },
    detectImageMimeType: async (absolutePath) => {
      try {
        const path = resolveSandboxPath(absolutePath, cwd);
        const result = await runCheckedSandboxShell(
          mode,
          `file --mime-type -b ${shellQuote(path)}`
        );
        const mimeType = result.stdout.toString('utf-8').trim();
        return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
      } catch {
        return null;
      }
    },
  };
}

function createSandboxWriteOperations(mode: SandboxToolMode, cwd: string): WriteOperations {
  return {
    writeFile: async (absolutePath, content) => {
      const path = resolveSandboxPath(absolutePath, cwd);
      const encoded = Buffer.from(content, 'utf-8').toString('base64');
      await runCheckedSandboxShell(mode, `base64 -d > ${shellQuote(path)}`, {
        input: encoded,
      });
    },
    mkdir: async (dir) => {
      const path = resolveSandboxPath(dir, cwd);
      await runCheckedSandboxShell(mode, `mkdir -p ${shellQuote(path)}`);
    },
  };
}

function createSandboxEditOperations(mode: SandboxToolMode, cwd: string): EditOperations {
  const readOps = createSandboxReadOperations(mode, cwd);
  const writeOps = createSandboxWriteOperations(mode, cwd);

  return {
    readFile: readOps.readFile,
    writeFile: writeOps.writeFile,
    access: async (absolutePath) => {
      const path = resolveSandboxPath(absolutePath, cwd);
      await runCheckedSandboxShell(
        mode,
        `test -r ${shellQuote(path)} && test -w ${shellQuote(path)}`
      );
    },
  };
}

function createSandboxBashOperations(mode: SandboxToolMode): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const timeoutMs = timeout && timeout > 0 ? timeout * 1000 : undefined;
      const envExports = buildEnvExports(env);
      const rewrittenCommand = rewriteVirtualWorkspaceReferences(command, cwd);
      const script = `${envExports} cd ${shellQuote(cwd)} && ${rewrittenCommand}`;
      const result = await runSandboxShell(mode, script, {
        onData,
        signal,
        timeoutMs,
      });
      return { exitCode: result.exitCode };
    },
  };
}

export function createSandboxCodingTools(
  cwd: string,
  mode: SandboxToolMode
): ReturnType<typeof createCodingTools> {
  return [
    createReadTool(cwd, { operations: createSandboxReadOperations(mode, cwd) }),
    createBashTool(cwd, { operations: createSandboxBashOperations(mode) }),
    createEditTool(cwd, { operations: createSandboxEditOperations(mode, cwd) }),
    createWriteTool(cwd, { operations: createSandboxWriteOperations(mode, cwd) }),
  ] as ReturnType<typeof createCodingTools>;
}
