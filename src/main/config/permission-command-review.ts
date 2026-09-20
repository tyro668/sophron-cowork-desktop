import type { AutoReviewResult } from './permission-auto-review';

// Running local project code is part of normal development, like build/test.
// Elevated access, destructive commands and remote writes still need consent.
const LOCAL_COMMANDS = new Set([
  'pwd',
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'wc',
  'rg',
  'grep',
  'find',
  'fd',
  'stat',
  'file',
  'du',
  'df',
  'which',
  'where',
  'whoami',
  'date',
  'echo',
  'printf',
  'sort',
  'uniq',
  'cut',
  'tr',
  'diff',
  'cmp',
  'jq',
  'yq',
  'sed',
  'tee',
  'cd',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'sleep',
  'true',
  'false',
  'test',
  'node',
  'nodejs',
  'python',
  'python3',
  'ruby',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'tsc',
  'vite',
  'vitest',
  'jest',
  'eslint',
  'prettier',
  'pytest',
  'pip',
  'pip3',
  'uv',
  'cargo',
  'go',
  'rustc',
  'make',
  'cmake',
  'git',
  'curl',
  'wget',
]);

/** Keep quoted words intact and review every command-list/pipeline segment.
 * Unsupported expansion goes to model review; nothing is executed here. */
function tokenize(command: string): string[][] | null {
  if (/[`\0]|\$[({]|[<>]\(/.test(command)) return null;
  const segments: string[][] = [[]];
  let word = '';
  let quote = '';
  const flush = () => {
    if (word) segments[segments.length - 1].push(word);
    word = '';
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      if (++i >= command.length) return null;
      if (command[i] !== '\n') word += command[i];
    } else if (quote) {
      if (char === quote) quote = '';
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/[;|&\n]/.test(char)) {
      flush();
      if (segments[segments.length - 1].length) segments.push([]);
    } else if (char === '>' || char === '<') {
      flush();
      word = char;
      if (command[i + 1] === char) word += command[++i];
      flush();
    } else if (/\s/.test(char)) flush();
    else word += char;
  }
  if (quote) return null;
  flush();
  return segments.filter((segment) => segment.length);
}

export function reviewShellCommand(
  command: string,
  isSensitivePath: (value: string, readOnly?: boolean) => boolean
): AutoReviewResult {
  const ask = (reason: AutoReviewResult['reason']): AutoReviewResult => ({
    decision: 'ask',
    reason,
  });
  const segments = tokenize(command);
  if (!segments?.length) return ask('tool_needs_confirmation');
  let unresolved: AutoReviewResult | undefined;
  for (const segment of segments) {
    const reviewed = reviewSegment(segment, segments, isSensitivePath);
    if (reviewed.decision === 'allow') continue;
    if (
      reviewed.reason !== 'tool_needs_confirmation' &&
      reviewed.reason !== 'arguments_need_confirmation'
    )
      return reviewed;
    unresolved ??= reviewed;
  }
  return unresolved ?? { decision: 'allow', reason: 'local_command' };
}

function reviewSegment(
  segment: string[],
  segments: string[][],
  isSensitivePath: (value: string, readOnly?: boolean) => boolean
): AutoReviewResult {
  const ask = (reason: AutoReviewResult['reason']): AutoReviewResult => ({
    decision: 'ask',
    reason,
  });
  const words = [...segment];
  if (words[0] === 'env') words.shift();
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] || '')) {
    if (/^(?:PATH|NODE_OPTIONS|BASH_ENV|ENV|LD_\w+|DYLD_\w+|PYTHONPATH)=/.test(words[0]))
      return ask('privileged_operation');
    words.shift();
  }
  const executable = words.shift() || '';
  const name =
    executable
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/i, '')
      .toLowerCase() || '';
  if (
    /^(?:sudo|su|doas|runas|chmod|chown|chgrp|mount|umount|launchctl|systemctl|reg|netsh|sc|shutdown|reboot|kill|killall|pkill)$/.test(
      name
    )
  )
    return ask('privileged_operation');
  if (/^(?:rm|rmdir|del|erase|remove-item|format|mkfs|dd|shred|diskutil|fdisk)$/.test(name))
    return ask('destructive_operation');
  if (!LOCAL_COMMANDS.has(name)) return ask('tool_needs_confirmation');
  if (
    executable.includes('/') &&
    !/^\/(?:usr\/(?:local\/)?bin|bin|opt\/homebrew\/bin)\//.test(executable)
  )
    return ask('tool_needs_confirmation');
  if (words.some((word) => /^\$/.test(word))) return ask('arguments_need_confirmation');
  const readOnly =
    /^(?:pwd|ls|dir|cat|head|tail|wc|rg|grep|fd|stat|file|du|df|which|where|whoami|date|sort|uniq|cut|tr|diff|cmp)$/.test(
      name
    ) && !words.some((word) => word === '>' || word === '>>');
  if (words.some((word) => !/^https?:\/\//i.test(word) && isSensitivePath(word, readOnly)))
    return ask('sensitive_path');
  if (words.includes('<<')) return ask('tool_needs_confirmation');
  if (name === 'find' && words.some((word) => /^-(?:delete|exec|execdir|ok|okdir)$/.test(word)))
    return ask('destructive_operation');
  if (
    name === 'sed' &&
    words.some((word) => /(?:^|;)\s*(?:\d+)?[erw](?:\s|$)|\/[ew][gIp]*$/.test(word))
  )
    return ask('tool_needs_confirmation');
  const safePythonModule =
    /^python\d*$/.test(name) &&
    words[0] === '-m' &&
    /^(?:pytest|unittest|compileall|json\.tool|venv)$/.test(words[1] || '');
  if (
    /^(?:node|nodejs|python\d*|ruby|bun)$/.test(name) &&
    !safePythonModule &&
    words.some((word) => /^-(?:c|e|p|r|m)|^--(?:eval|print|require|import)/.test(word))
  )
    return ask('tool_needs_confirmation');
  if (name === 'git') {
    if (
      words.some((word) =>
        /^(?:push|reset|clean|restore|checkout|rebase|config|credential|filter-branch|gc)$/.test(
          word
        )
      ) ||
      words.includes('-c') ||
      words.some((word) => /^--(?:exec-path|git-dir|work-tree)/.test(word))
    )
      return ask('destructive_operation');
    if (words.some((word) => /^(?:--delete|-d|-D|--force|-f|--amend)$/.test(word)))
      return ask('destructive_operation');
  }
  if (
    !readOnly &&
    words.some((word) =>
      /(?:^|[:_-])(?:publish|deploy|release|upload|uninstall|remove|prune|reset|destroy|wipe)(?:$|[:_-])|^--(?:system|force|delete)$/.test(
        word
      )
    )
  )
    return ask('external_side_effect');
  if (
    /^(?:npm|pnpm|yarn|bun|pip\d*|uv)$/.test(name) &&
    words.some((word) => /^(?:--global(?:=|$)|-g|--system$)/.test(word))
  )
    return ask('privileged_operation');
  // Package executors are wrappers, not proof that the nested command is safe.
  const nestedIndex =
    name === 'npx'
      ? 0
      : /^(?:npm|pnpm|yarn|bun|uv)$/.test(name) && /^(?:exec|dlx|x)$/.test(words[0] || '')
        ? 1
        : -1;
  if (nestedIndex >= 0) {
    const nested = words.slice(nestedIndex);
    while (/^(?:--yes|-y|--)$/.test(nested[0] || '')) nested.shift();
    if (!nested.length || nested[0].startsWith('-')) return ask('tool_needs_confirmation');
    const reviewed = reviewShellCommand(
      nested.map((word) => `'${word.replace(/'/g, `'\\''`)}'`).join(' '),
      isSensitivePath
    );
    if (reviewed.decision === 'ask') return reviewed;
  }
  if (name === 'curl' || name === 'wget') {
    if (
      words.some((word) =>
        /^(?:--data.*|--json|--form.*|--upload-file|--post.*|--body.*|--method.*|--request.*|-[dFTX].*)$/.test(
          word
        )
      )
    )
      return ask('external_side_effect');
    if (segments.some((other) => /^(?:sh|bash|zsh|python\d*|node)$/.test(other[0])))
      return ask('external_side_effect');
  }
  return { decision: 'allow', reason: 'local_command' };
}
