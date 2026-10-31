/**
 * OS sandbox for code the app did not write: Linux bubblewrap (firejail fallback), macOS
 * sandbox-exec. The process sees the system runtimes read-only, the folders it works in
 * read-write, a private /tmp and a private HOME; the rest of the user's files are hidden.
 * Network stays available (scripts fetch data). Without a sandbox the user has to allow
 * running unsandboxed (once, remembered) or the run is refused.
 */
import { spawnSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';

export type SandboxKind = 'bwrap' | 'firejail' | 'sandbox-exec' | 'none';

export interface SandboxSpec {
  /** Folders the process may write (package dir, run dir, output dir). */
  writable: string[];
  /** Extra files / folders it may read (the input source of a normalizer). */
  readable?: string[];
  /** Working directory inside the sandbox (must be one of the folders above). */
  cwd: string;
}

export interface WrappedCommand {
  command: string;
  args: string[];
  sandbox: SandboxKind;
  /** Variables the caller must set (HOME → the sandbox's private home). */
  env: Record<string, string>;
}

export class SandboxConsentError extends Error {
  constructor(message = '本机无法隔离运行生成的代码，已拒绝运行（可在弹窗中允许）') {
    super(message);
    this.name = 'SandboxConsentError';
  }
}

let detected: SandboxKind | undefined;
let homeDir: string | undefined;
let consentHandler: ((label: string) => Promise<boolean>) | undefined;
let consentGranted = false;

function mode(): 'auto' | 'off' {
  return process.env.SOPHRON_EXEC_SANDBOX === 'off' ? 'off' : 'auto';
}

function works(command: string, args: string[]): boolean {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 5_000 }).status === 0;
  } catch {
    return false;
  }
}

/** The sandbox this machine supports (probed once). */
export function detectSandbox(): SandboxKind {
  if (mode() === 'off') return 'none';
  if (detected) return detected;
  if (process.platform === 'linux') {
    if (works('bwrap', ['--ro-bind', '/', '/', '--unshare-pid', '--die-with-parent', 'true']))
      detected = 'bwrap';
    else if (works('firejail', ['--quiet', '--noprofile', 'true'])) detected = 'firejail';
    else detected = 'none';
  } else if (process.platform === 'darwin') {
    detected = existsSync('/usr/bin/sandbox-exec') ? 'sandbox-exec' : 'none';
  } else {
    detected = 'none';
  }
  return detected;
}

/** Test hook / settings: forget the probe result. */
export function resetSandboxDetection(kind?: SandboxKind): void {
  detected = kind;
}

/** Private HOME for sandboxed processes (pip / npm caches live here). */
export function configureExecSandbox(options: {
  homeDir?: string;
  confirmUnsandboxed?: (label: string) => Promise<boolean>;
  /** Already allowed earlier (remembered choice). */
  unsandboxedAllowed?: boolean;
}): void {
  if (options.homeDir) homeDir = options.homeDir;
  if ('confirmUnsandboxed' in options) consentHandler = options.confirmUnsandboxed;
  if (options.unsandboxedAllowed !== undefined) consentGranted = options.unsandboxedAllowed;
}

export function sandboxHome(): string {
  const dir = homeDir ?? path.join(os.tmpdir(), 'sophron-exec-home');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Make sure the command may run: with a sandbox always; without one only after the user
 * allowed it (the choice is remembered by the handler). `off` mode (developer setting) skips.
 */
export async function ensureExecAllowed(label: string): Promise<SandboxKind> {
  const kind = detectSandbox();
  if (kind !== 'none' || mode() === 'off' || consentGranted) return kind;
  if (consentHandler && (await consentHandler(label))) {
    consentGranted = true;
    return kind;
  }
  throw new SandboxConsentError();
}

function real(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function unique(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((item): item is string => Boolean(item)).map(real))];
}

/** Runtime folders the process must be able to read (interpreters, Electron for Node). */
export function runtimeReadPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [path.dirname(process.execPath)];
  if (process.resourcesPath) paths.push(process.resourcesPath);
  const resources = path.resolve(process.cwd(), 'resources');
  if (existsSync(resources)) paths.push(resources);
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry) || !existsSync(entry)) continue;
    const resolved = real(entry);
    if (resolved === home || resolved === '/') continue;
    paths.push(resolved);
    // A bin folder under HOME (nvm, ~/.local/node) needs its lib sibling.
    if (resolved.startsWith(home) && path.basename(resolved) === 'bin') {
      const lib = path.join(path.dirname(resolved), 'lib');
      if (existsSync(lib)) paths.push(lib);
    }
  }
  return unique(paths).filter((item) => !SYSTEM_PREFIXES.some((prefix) => isInside(prefix, item)));
}

const SYSTEM_PREFIXES = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/etc', '/opt'];

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function bwrapArgs(spec: SandboxSpec, home: string): string[] {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    '--share-net',
    '--ro-bind',
    '/usr',
    '/usr',
  ];
  for (const dir of ['/bin', '/sbin', '/lib', '/lib32', '/lib64']) {
    if (!existsSync(dir)) continue;
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink()) args.push('--symlink', readlinkSync(dir), dir);
    else args.push('--ro-bind', dir, dir);
  }
  args.push(
    '--ro-bind-try',
    '/etc',
    '/etc',
    '--ro-bind-try',
    '/opt',
    '/opt',
    '--ro-bind-try',
    '/run/systemd/resolve',
    '/run/systemd/resolve',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp'
  );
  for (const dir of unique([...runtimeReadPaths(), ...(spec.readable ?? [])])) {
    if (existsSync(dir)) args.push('--ro-bind', dir, dir);
  }
  for (const dir of unique([home, ...spec.writable])) {
    if (existsSync(dir)) args.push('--bind', dir, dir);
  }
  args.push('--setenv', 'HOME', home, '--chdir', real(spec.cwd));
  return args;
}

function firejailArgs(spec: SandboxSpec, home: string): string[] {
  const userHome = os.homedir();
  const writable = unique([home, ...spec.writable]);
  const readable = unique([...runtimeReadPaths(), ...(spec.readable ?? [])]);
  const args = ['--quiet', '--noprofile', '--nonewprivs', '--nogroups', '--caps.drop=all'];
  if (!writable.some((dir) => isInside('/tmp', dir))) args.push('--private-tmp');
  for (const dir of [...writable, ...readable]) {
    if (isInside(userHome, dir)) args.push(`--whitelist=${dir}`);
  }
  for (const dir of readable) args.push(`--read-only=${dir}`);
  return args;
}

function sbString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** sandbox-exec profile: no writes outside the work folders, no reads of the user's HOME. */
export function macProfile(spec: SandboxSpec, home: string): string {
  const writable = unique([home, ...spec.writable]);
  const readable = unique([...runtimeReadPaths(), ...(spec.readable ?? []), ...writable]);
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (regex #"^/dev/tty") ${writable.map((dir) => `(subpath ${sbString(dir)})`).join(' ')})`,
    `(deny file-read* (subpath ${sbString(real(os.homedir()))}))`,
    `(allow file-read* ${readable.map((dir) => `(subpath ${sbString(dir)})`).join(' ')})`,
  ].join('\n');
}

/** Wrap `command args` for the sandbox this machine has (unchanged when there is none). */
export function wrapCommand(command: string, args: string[], spec: SandboxSpec): WrappedCommand {
  const kind = detectSandbox();
  const home = sandboxHome();
  const env = { HOME: home };
  if (kind === 'bwrap')
    return {
      command: 'bwrap',
      args: [...bwrapArgs(spec, home), '--', command, ...args],
      sandbox: kind,
      env,
    };
  if (kind === 'firejail')
    return {
      command: 'firejail',
      args: [...firejailArgs(spec, home), '--', command, ...args],
      sandbox: kind,
      env,
    };
  if (kind === 'sandbox-exec')
    return {
      command: '/usr/bin/sandbox-exec',
      args: ['-p', macProfile(spec, home), command, ...args],
      sandbox: kind,
      env,
    };
  return { command, args, sandbox: 'none', env: {} };
}

/** `bash -c` for a shell command string inside the sandbox (agent bash). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function wrapShellCommand(script: string, spec: SandboxSpec): string {
  const wrapped = wrapCommand('/bin/bash', ['-c', script], spec);
  if (wrapped.sandbox === 'none') return script;
  const env = Object.entries(wrapped.env).map(([name, value]) => `${name}=${shellQuote(value)}`);
  return `exec env ${[...env, wrapped.command, ...wrapped.args].map((part, index) => (index < env.length ? part : shellQuote(part))).join(' ')}`;
}
