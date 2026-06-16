export const BUILTIN_LLM_CONFIG_SET_ID = 'default';
export const BUILTIN_LLM_PROVIDER = 'sophron';
export const BUILTIN_LLM_CONFIG_SET_PREFIX = 'builtin-llm:';

export function makeBuiltinLlmConfigSetId(modelId: string): string {
  return `${BUILTIN_LLM_CONFIG_SET_PREFIX}${encodeURIComponent(modelId)}`;
}

export function parseBuiltinLlmConfigSetId(configSetId?: string | null): string | null {
  if (!configSetId?.startsWith(BUILTIN_LLM_CONFIG_SET_PREFIX)) {
    return null;
  }

  const encoded = configSetId.slice(BUILTIN_LLM_CONFIG_SET_PREFIX.length);
  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
