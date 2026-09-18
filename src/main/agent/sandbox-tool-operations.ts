import { spawn, type ChildProcess } from 'child_process';
import { posix } from 'path';
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
  // SDK mkdir uses the host's path.dirname, which can emit backslashes on Windows.
  absolutePath = absolutePath.replace(/\\/g, '/');
  if (absolutePath === VIRTUAL_WORKSPACE_PATH) {
    return cwd;
  }
  if (absolutePath.startsWith(`${VIRTUAL_WORKSPACE_PATH}/`)) {
    return `${cwd}${absolutePath.slice(VIRTUAL_WORKSPACE_PATH.length)}`;
  }
  return absolutePath;
}

export function resolveSandboxToolInput(filePath: string, cwd: string): string {
  const input = filePath.replace(/^@/, '').replace(/\\/g, '/');
  // Resolve before the SDK: path.resolve on a Windows host turns a Linux cwd
  // into C:\\home\\..., and SDK tilde expansion would use the Windows home.
  if (/^[A-Za-z]:|^\/\/|^~(?:\/|$)/.test(input)) {
    throw new Error('Use a sandbox-relative path or an absolute Linux path.');
  }
  return resolveSandboxPath(posix.resolve(cwd, input), cwd);
}

function rewriteVirtualWorkspaceReferences(command: string, cwd: string): string {
  let quote: "'" | '"' | null = null;
  let result = '';
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      result += command.slice(i, i + 2);
      i++;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
    }
    if (
      command.startsWith(VIRTUAL_WORKSPACE_PATH, i) &&
      (i === 0 || /[\s'"=(:;&|<>]/.test(command[i - 1])) &&
      (i + VIRTUAL_WORKSPACE_PATH.length === command.length ||
        /[/\s'";)&|<>]/.test(command[i + VIRTUAL_WORKSPACE_PATH.length]))
    ) {
      // Preserve the caller's quoting context; nesting single quotes in an
      // already double-quoted path changes the actual filename.
      result +=
        quote === "'"
          ? cwd.replace(/'/g, "'\\''")
          : quote === '"'
            ? cwd.replace(/[\\$`"]/g, '\\$&')
            : shellQuote(cwd);
      i += VIRTUAL_WORKSPACE_PATH.length - 1;
    } else {
      result += char;
    }
  }
  return result;
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
      // Keep the one-shot error listener: a spawn error may arrive after abort.
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
    child.stdin?.on('error', onError);
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateSandboxProcess(child);
        settleReject(new Error(`timeout:${options.timeoutMs ?? 0}`));
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
      // The SDK supplies the full host environment. Keep the guest's runtime
      // paths; Windows PATH/HOME/TEMP (and macOS runtime paths) are invalid here.
      const guestOwned =
        /^(path|home|userprofile|tmp|temp|tmpdir|shell|pwd|oldpwd|pythonhome|pythonpath|virtual_env|conda_prefix|node_path|ld_library_path|dyld_library_path)$/i;
      return (
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !guestOwned.test(key)
      );
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
  const read = createReadTool(cwd, { operations: createSandboxReadOperations(mode, cwd) });
  const edit = createEditTool(cwd, { operations: createSandboxEditOperations(mode, cwd) });
  const write = createWriteTool(cwd, { operations: createSandboxWriteOperations(mode, cwd) });
  return [
    {
      ...read,
      execute: (id, params, signal, update) =>
        read.execute(
          id,
          { ...params, path: resolveSandboxToolInput(params.path, cwd) },
          signal,
          update
        ),
    },
    createBashTool(cwd, { operations: createSandboxBashOperations(mode) }),
    {
      ...edit,
      execute: (id, params, signal, update) =>
        edit.execute(
          id,
          { ...params, path: resolveSandboxToolInput(params.path, cwd) },
          signal,
          update
        ),
    },
    {
      ...write,
      execute: (id, params, signal, update) =>
        write.execute(
          id,
          { ...params, path: resolveSandboxToolInput(params.path, cwd) },
          signal,
          update
        ),
    },
  ] as ReturnType<typeof createCodingTools>;
}
