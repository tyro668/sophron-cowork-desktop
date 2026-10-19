/**
 * Conservative detection of shell commands that only read information.
 *
 * Used for user-facing wording (the permission dialog must not claim that
 * `ls` "may modify your system"); it is NOT a security boundary and never
 * grants permission on its own. Anything not recognised is treated as
 * potentially modifying.
 */

const READ_ONLY_PROGRAMS = new Set([
  'basename',
  'cat',
  'cd',
  'column',
  'cut',
  'date',
  'df',
  'diff',
  'dirname',
  'du',
  'echo',
  'file',
  'grep',
  'egrep',
  'fgrep',
  'head',
  'hexdump',
  'id',
  'jq',
  'less',
  'ls',
  'md5sum',
  'more',
  'nl',
  'od',
  'pdfinfo',
  'pdftotext',
  'printf',
  'pwd',
  'readlink',
  'realpath',
  'rg',
  'sha1sum',
  'sha256sum',
  'sort',
  'stat',
  'strings',
  'tail',
  'test',
  'tr',
  'tree',
  'true',
  'type',
  'uname',
  'uniq',
  'wc',
  'which',
  'whoami',
  'xxd',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'branch',
  'diff',
  'log',
  'ls-files',
  'remote',
  'rev-parse',
  'show',
  'status',
]);

const SAFE_GIT_LISTING_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current']);

/** Flags that turn an otherwise read-only program into a writer/executor. */
const UNSAFE_ARGS: Record<string, RegExp> = {
  find: /(^|\s)-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/,
  sort: /(^|\s)(-o\b|--output)/,
  tree: /(^|\s)-o\b/,
  git: /(^|\s)(-c\b|--output)/,
};

function splitSegments(command: string): string[] | null {
  // Any redirection, substitution, heredoc or background job makes the
  // command non-trivial to reason about: treat as potentially modifying.
  // `2>/dev/null` and `2>&1` are the only redirections tolerated.
  const withoutHarmless = command.replace(/\b2>\s*(\/dev\/null|&1)/g, ' ');
  if (/[<>`]|\$\(|(^|[^&])&($|[^&])/.test(withoutHarmless)) return null;
  return withoutHarmless
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isReadOnlySegment(segment: string): boolean {
  const words = segment.split(/\s+/);
  // Skip leading VAR=value assignments.
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const program = (words[0] ?? '').replace(/^.*\//, '');
  if (!program) return false;
  const rest = words.slice(1).join(' ');
  if (UNSAFE_ARGS[program]?.test(` ${rest}`)) return false;
  if (program === 'find') return true;
  if (program === 'git') {
    const sub = words.slice(1).find((word) => !word.startsWith('-'));
    if (!sub || !READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return false;
    // `git branch <name>` / `git remote add …` change state: only listing flags.
    if (sub === 'branch' || sub === 'remote') {
      const args = words.slice(words.indexOf(sub) + 1);
      return args.every((arg) => SAFE_GIT_LISTING_FLAGS.has(arg));
    }
    return true;
  }
  return READ_ONLY_PROGRAMS.has(program);
}

export function isReadOnlyShellCommand(command: string | null | undefined): boolean {
  if (!command || !command.trim()) return false;
  const segments = splitSegments(command);
  if (!segments || segments.length === 0) return false;
  return segments.every(isReadOnlySegment);
}
