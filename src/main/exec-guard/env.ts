/**
 * Environment for code the app did not write (generated scripts, normalizers, pip / npm, agent
 * shells): an allowlist of system variables plus SOPHRON_* and proxy settings. App secrets (model
 * API keys etc.) never reach these processes; package secrets are passed explicitly as `extra`.
 */
const SYSTEM_VARS = new Set([
  'PATH',
  'Path',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Windows: processes fail to start or resolve paths without these.
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
]);
const PROXY_VAR = /^(https?|all|no|ftp)_proxy$/i;
const LOCALE_VAR = /^LC_[A-Z]+$/;
const PACKAGE_INDEX_VAR =
  /^(PIP_INDEX_URL|PIP_EXTRA_INDEX_URL|PIP_TRUSTED_HOST|PIP_CERT|NPM_CONFIG_REGISTRY|npm_config_registry|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|NODE_EXTRA_CA_CERTS)$/;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION|AUTH)/i;

export function isAllowedExecVar(name: string): boolean {
  if (SYSTEM_VARS.has(name) || PROXY_VAR.test(name) || LOCALE_VAR.test(name)) return true;
  if (PACKAGE_INDEX_VAR.test(name)) return true;
  return name.startsWith('SOPHRON_') && !SECRET_NAME.test(name);
}

/** Allowlisted variables of `base`, then `extra` (package secrets, SOPHRON_OUTPUT, …) on top. */
export function buildExecEnv(
  extra: Record<string, string | undefined> = {},
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && isAllowedExecVar(name)) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}
