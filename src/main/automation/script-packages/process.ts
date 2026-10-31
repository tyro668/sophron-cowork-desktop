import { spawn } from 'child_process';
import { buildExecEnv } from '../../exec-guard/env';
import { redactOutput } from '../../exec-guard/redact';
import { ensureExecAllowed, wrapCommand, type SandboxSpec } from '../../exec-guard/sandbox';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const TAIL_LIMIT = 16_000;

function tail(text: string): string {
  return text.length > TAIL_LIMIT ? text.slice(-TAIL_LIMIT) : text;
}

export interface RunProcessOptions {
  cwd: string;
  /** Defaults to the allowlisted exec environment (never the app's full env). */
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Run inside the OS sandbox with these folders (generated code, pip / npm). */
  sandbox?: Omit<SandboxSpec, 'cwd'>;
  /** Extra values to redact from stdout / stderr (package secrets). */
  redact?: string[];
  signal?: AbortSignal;
}

/**
 * Spawn without a shell; on timeout / abort the whole process tree is killed. Sandboxed runs
 * need a sandbox or the user's consent (SandboxConsentError otherwise). Output is redacted.
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions
): Promise<ProcessResult> {
  let spawnCommand = command;
  let spawnArgs = args;
  let env = options.env ?? buildExecEnv();
  if (options.sandbox) {
    await ensureExecAllowed(command);
    const wrapped = wrapCommand(command, args, { ...options.sandbox, cwd: options.cwd });
    spawnCommand = wrapped.command;
    spawnArgs = wrapped.args;
    env = { ...env, ...wrapped.env };
  }
  const result = await spawnProcess(spawnCommand, spawnArgs, { ...options, env });
  return {
    ...result,
    stdout: redactOutput(result.stdout, options.redact),
    stderr: redactOutput(result.stderr, options.redact),
  };
}

function spawnProcess(
  command: string,
  args: string[],
  options: RunProcessOptions & { env: NodeJS.ProcessEnv }
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: !isWindows,
      windowsHide: true,
      // npm / py launchers are .cmd shims on Windows.
      shell: isWindows && /\.(cmd|bat)$/i.test(command),
    });
    const kill = () => {
      if (!child.pid) return;
      try {
        if (isWindows) spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const onAbort = () => kill();
    if (options.signal?.aborted) kill();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = tail(stdout + chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString());
    });
    const finish = (code: number | null, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr: extra ? `${stderr}\n${extra}` : stderr, timedOut });
    };
    child.on('error', (error) => finish(-1, error.message));
    child.on('close', (code) => finish(code));
  });
}

/** Last meaningful stderr/stdout line, e.g. Python's "ValueError: …" after a traceback. */
export function failureReason(result: ProcessResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const stderrLines = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pick = stderrLines.at(-1) ?? lines.at(-1);
  if (!pick) return `退出码 ${result.code}`;
  return pick.length > 160 ? `${pick.slice(0, 159)}…` : pick;
}
