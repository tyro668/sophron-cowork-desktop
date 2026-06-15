export type DesktopAuthEnvironment = 'dev' | 'prod';

export const DESKTOP_AUTH_ORIGINS: Record<DesktopAuthEnvironment, string> = {
  dev: 'http://127.0.0.1:3000',
  prod: 'https://api.sophron.ai',
};

export function getDesktopAuthEnvironment(): DesktopAuthEnvironment {
  return process.env.VITE_DEV_SERVER_URL ? 'dev' : 'prod';
}

export function normalizeDesktopAuthOrigin(value: string | null | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

export function resolveDesktopAuthOrigin(configuredOrigin?: string | null): string {
  const configured = normalizeDesktopAuthOrigin(configuredOrigin);
  if (configured) {
    return configured;
  }

  const environmentOverride = normalizeDesktopAuthOrigin(process.env.SOPHRON_DESKTOP_AUTH_ORIGIN);
  if (environmentOverride) {
    return environmentOverride;
  }

  return DESKTOP_AUTH_ORIGINS[getDesktopAuthEnvironment()];
}
