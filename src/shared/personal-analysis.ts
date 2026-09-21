import type { PersonalAnalysisConfig } from './personal-analysis-types';

export const EMPTY_PERSONAL_ANALYSIS_CONFIG: PersonalAnalysisConfig = {
  apiOrigin: '',
  apiKey: '',
};

type Translate = (key: string) => string;

export function normalizePersonalAnalysisApiOrigin(value: string | undefined): string {
  return (value?.trim() || '').replace(/\/+$/, '');
}

export function validatePersonalAnalysisConnection(
  form: PersonalAnalysisConfig,
  t: Translate
): {
  error: string | null;
  connection: Pick<PersonalAnalysisConfig, 'apiOrigin' | 'apiKey'> | null;
} {
  const apiOrigin = normalizePersonalAnalysisApiOrigin(form.apiOrigin);
  const apiKey = form.apiKey.trim();

  if (!apiOrigin || !apiKey) {
    return {
      error: t('personalAnalysis.connectionMissingShort'),
      connection: null,
    };
  }

  try {
    const parsed = new URL(apiOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        error: t('personalAnalysis.invalidApiOriginProtocol'),
        connection: null,
      };
    }
  } catch {
    return {
      error: t('personalAnalysis.invalidApiOrigin'),
      connection: null,
    };
  }

  if (/^x-api-key\s*:/i.test(apiKey)) {
    return {
      error: t('personalAnalysis.apiKeyHeaderPrefixError'),
      connection: null,
    };
  }

  return {
    error: null,
    connection: { apiOrigin, apiKey },
  };
}

export function getPersonalAnalysisErrorMessage(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return t('cloudData.errorTimeout');
  }

  if (
    normalized.includes('api key') ||
    normalized.includes('apikey') ||
    normalized.includes('/api/personal/api-keys/token')
  ) {
    return t('cloudData.errorApiKey');
  }

  if (
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('61311002') ||
    normalized.includes('invalid_grant') ||
    normalized.includes('please sign in') ||
    normalized.includes('refresh token')
  ) {
    return t('cloudData.errorAuth');
  }

  if (normalized.includes('403') || normalized.includes('forbidden')) {
    return t('cloudData.errorPermission');
  }

  if (
    normalized.includes('network') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed')
  ) {
    return t('cloudData.errorNetwork');
  }

  return message || t('cloudData.errorUnknown');
}

export function hasPersonalAnalysisConnection(
  config: PersonalAnalysisConfig | null | undefined
): boolean {
  return Boolean(
    config?.apiOrigin?.trim() && config.apiKey?.trim() && config.connectionStatus !== 'disconnected'
  );
}
