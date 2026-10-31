/**
 * Key-like strings in user text and generated files. Rule descriptions and chat quotes have
 * them replaced by ${SECRET:NAME} placeholders before they reach the model; generated files
 * must not contain them at all (they would land in git history).
 */
export const SECRET_PLACEHOLDER = /\$\{SECRET:([A-Z][A-Z0-9_]{1,63})\}/g;

export interface SecretCandidate {
  value: string;
  /** Suggested variable name, e.g. API_KEY. */
  name: string;
}

export interface SecretReplacement {
  value: string;
  name: string;
}

/** Random-looking token: long, no spaces, letters and digits, not an identifier or URL. */
export function looksLikeSecretValue(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 12 || /\s/.test(value)) return false;
  if (/^\$\{/.test(value) || /^https?:/i.test(value)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return false; // ENV_VAR_NAME
  if (/^\d[\d.:/-]*$/.test(value)) return false; // numbers, dates, ids
  if (/^[a-z]+([_.-][a-z]+)*$/i.test(value)) return false; // words
  const letters = /[A-Za-z]/.test(value);
  const digits = /\d/.test(value);
  return (letters && digits) || value.length >= 32;
}

const CONTEXT =
  /(api[ _-]?key|apikey|app[ _-]?key|app[ _-]?secret|access[ _-]?key|secret[ _-]?key|client[ _-]?secret|token|secret|key|password|passwd|密钥|秘钥|令牌|口令|密码)\s*(?:是|为|:|：|=)\s*["'“‘`]?([A-Za-z0-9_\-.+/=~]{12,})/gi;
const URL_PARAM =
  /[?&](key|apikey|api_key|appkey|app_key|token|access_token|secret|password|sign|signature)=([^&\s"'`#<>]{8,})/gi;
const KNOWN_PREFIX =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[abpr]|glpat|AKIA)[-_]?[A-Za-z0-9_-]{16,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/g;

function nameFor(label: string): string {
  const key = label.toLowerCase().replace(/[ _-]/g, '');
  if (/password|passwd|密码|口令/.test(key)) return 'PASSWORD';
  if (/secret/.test(key)) return 'API_SECRET';
  if (/token|令牌|bearer/.test(key)) return 'API_TOKEN';
  return 'API_KEY';
}

/** Key-like values in `text` with suggested names (unique, in order of appearance). */
export function detectSecretCandidates(text: string): SecretCandidate[] {
  const found = new Map<string, string>();
  const add = (value: string, label: string) => {
    const trimmed = value.replace(/["'”’`.,;，。；]+$/, '');
    if (!trimmed || found.has(trimmed) || SECRET_PLACEHOLDER.test(trimmed)) return;
    SECRET_PLACEHOLDER.lastIndex = 0;
    found.set(trimmed, nameFor(label));
  };
  const source = String(text ?? '');
  for (const match of source.matchAll(CONTEXT))
    if (looksLikeSecretValue(match[2])) add(match[2], match[1]);
  for (const match of source.matchAll(URL_PARAM))
    if (looksLikeSecretValue(match[2]) || match[2].length >= 16) add(match[2], match[1]);
  for (const match of source.matchAll(KNOWN_PREFIX)) add(match[0], 'key');
  for (const match of source.matchAll(JWT)) add(match[0], 'token');
  for (const match of source.matchAll(BEARER)) add(match[1], 'bearer');
  const used = new Set<string>();
  return [...found.entries()].map(([value, base]) => {
    let name = base;
    for (let index = 2; used.has(name); index += 1) name = `${base}_${index}`;
    used.add(name);
    return { value, name };
  });
}

/** Replace each value by ${SECRET:NAME}. */
export function replaceSecrets(text: string, replacements: SecretReplacement[]): string {
  let result = String(text ?? '');
  for (const item of [...replacements].sort((a, b) => b.value.length - a.value.length)) {
    if (item.value) result = result.split(item.value).join(`\${SECRET:${item.name}}`);
  }
  return result;
}

/** ${SECRET:NAME} placeholders used in `text`. */
export function secretPlaceholders(text: string): string[] {
  return [
    ...new Set([...String(text ?? '').matchAll(SECRET_PLACEHOLDER)].map((match) => match[1])),
  ];
}

export interface SecretLeak {
  path: string;
  line: number;
  /** Masked value, e.g. rvwF…3210. */
  preview: string;
}

export function maskSecret(value: string): string {
  return value.length <= 8 ? '****' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const FILE_ASSIGN =
  /["']?([\w-]*(?:api[_-]?key|apikey|app[_-]?key|secret|token|password|passwd|access[_-]?key)[\w-]*)["']?\s*[:=]\s*["']([^"'\n]{12,})["']/gi;

/** Known secret values or key-like literals assigned to key/token fields in package files. */
export function findSecretsInFiles(
  files: Array<{ path: string; content: string }>,
  knownValues: string[] = []
): SecretLeak[] {
  const known = knownValues.map((value) => value.trim()).filter((value) => value.length >= 8);
  const leaks: SecretLeak[] = [];
  for (const file of files) {
    if (file.path.startsWith('.sophron/') || file.path === '.gitignore') continue;
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const hit =
        known.find((value) => line.includes(value)) ??
        [...line.matchAll(FILE_ASSIGN)]
          .map((match) => match[2])
          .find((value) => looksLikeSecretValue(value)) ??
        line.match(KNOWN_PREFIX)?.[0] ??
        line.match(JWT)?.[0];
      if (hit) leaks.push({ path: file.path, line: index + 1, preview: maskSecret(hit) });
    });
  }
  return leaks;
}

export function describeSecretLeaks(leaks: SecretLeak[]): string {
  const first = leaks
    .slice(0, 3)
    .map((leak) => `${leak.path}:${leak.line}（${leak.preview}）`)
    .join('、');
  return `文件中出现了密钥明文：${first}。密钥只能在运行时从环境变量读取，不能写进文件`;
}
