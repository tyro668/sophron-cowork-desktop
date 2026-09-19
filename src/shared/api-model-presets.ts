export type SharedProviderType =
  | 'openrouter'
  | 'anthropic'
  | 'custom'
  | 'openai'
  | 'openai-codex'
  | 'deepseek'
  | 'moonshot'
  | 'aliyun'
  | 'zai'
  | 'sophron'
  | 'gemini'
  | 'ollama';

export type SharedCustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type VisibleApiProviderType = Exclude<SharedProviderType, 'custom' | 'gemini' | 'sophron'>;

export const VISIBLE_API_PROVIDER_OPTIONS = [
  'deepseek',
  'moonshot',
  'aliyun',
  'zai',
  'anthropic',
  'openai',
  'openai-codex',
  'openrouter',
  'ollama',
] as const satisfies readonly VisibleApiProviderType[];

export interface SharedProviderPreset {
  name: string;
  baseUrl: string;
  models: Array<{ id: string; name: string }>;
  keyPlaceholder: string;
  keyHint: string;
}

export interface SharedProviderPresets {
  openrouter: SharedProviderPreset;
  anthropic: SharedProviderPreset;
  custom: SharedProviderPreset;
  openai: SharedProviderPreset;
  'openai-codex': SharedProviderPreset;
  deepseek: SharedProviderPreset;
  moonshot: SharedProviderPreset;
  aliyun: SharedProviderPreset;
  zai: SharedProviderPreset;
  sophron: SharedProviderPreset;
  gemini: SharedProviderPreset;
  ollama: SharedProviderPreset;
}

export interface ModelInputGuidance {
  placeholder: string;
  hint: string;
}

export const API_PROVIDER_PRESETS: SharedProviderPresets = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-fable-5.1', name: 'anthropic/claude-fable-5.1' },
      { id: 'anthropic/claude-opus-5', name: 'anthropic/claude-opus-5' },
      { id: 'anthropic/claude-sonnet-5', name: 'anthropic/claude-sonnet-5' },
      { id: 'anthropic/claude-haiku-4.5', name: 'anthropic/claude-haiku-4.5' },
      { id: 'openai/gpt-6-astra', name: 'openai/gpt-6-astra' },
      { id: 'openai/gpt-5.6-sol', name: 'openai/gpt-5.6-sol' },
      { id: 'google/gemini-3.8-flash', name: 'google/gemini-3.8-flash' },
      { id: 'google/gemini-3.1-pro-preview', name: 'google/gemini-3.1-pro-preview' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-fable-5-1', name: 'claude-fable-5-1' },
      { id: 'claude-opus-5', name: 'claude-opus-5' },
      { id: 'claude-sonnet-5', name: 'claude-sonnet-5' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
      { id: 'claude-opus-4-8', name: 'claude-opus-4-8' },
      { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-6-astra', name: 'gpt-6-astra' },
      { id: 'gpt-5.6-sol', name: 'gpt-5.6-sol' },
      { id: 'gpt-5.6-terra', name: 'gpt-5.6-terra' },
      { id: 'gpt-5.6-luna', name: 'gpt-5.6-luna' },
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
      { id: 'gpt-5.4-nano', name: 'gpt-5.4-nano' },
      { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.openai.com 获取',
  },
  'openai-codex': {
    name: 'OpenAI Codex（订阅）',
    baseUrl: 'https://chatgpt.com/backend-api',
    models: [
      { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    ],
    keyPlaceholder: '使用 ChatGPT 订阅登录',
    keyHint: '使用本地 codex CLI 登录态或浏览器 OAuth 登录，无需 API Key',
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.deepseek.com 获取',
  },
  moonshot: {
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: [
      { id: 'kimi-k3', name: 'kimi-k3' },
      { id: 'kimi-k2.7-code', name: 'kimi-k2.7-code' },
      { id: 'kimi-k2.6', name: 'kimi-k2.6' },
      { id: 'kimi-k2.5', name: 'kimi-k2.5' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.kimi.ai / platform.moonshot.ai 获取',
  },
  aliyun: {
    name: 'Aliyun',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3.8-max', name: 'Qwen3.8-Max' },
      { id: 'qwen3.7-max', name: 'Qwen3.7-Max' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'kimi-k2.7-code', name: 'Kimi-K2.7-Code' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从阿里云百炼控制台 / DashScope 获取',
  },
  zai: {
    name: 'Z.AI',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: [
      { id: 'glm-5.3', name: 'glm-5.3' },
      { id: 'glm-5.3-flash', name: 'glm-5.3-flash' },
      { id: 'glm-5.2', name: 'glm-5.2' },
      { id: 'glm-5.1', name: 'glm-5.1' },
      { id: 'glm-5', name: 'glm-5' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 docs.z.ai / Z.AI Open Platform 获取',
  },
  sophron: {
    name: '内置 LLM',
    baseUrl: '',
    models: [],
    keyPlaceholder: '登录后自动使用',
    keyHint: '使用桌面登录态调用后端 LLM 代理并统计 AI 积分',
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: [
      { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash' },
      { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash' },
      { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite' },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: '从 aistudio.google.com 获取',
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' },
      { id: 'llama3.3:latest', name: 'llama3.3:latest' },
      { id: 'gpt-oss:20b', name: 'gpt-oss:20b' },
    ],
    keyPlaceholder: '可留空',
    keyHint: '多数 Ollama 部署可留空；如果你的代理层要求鉴权，也可以填写 Key',
  },
  custom: {
    name: '更多模型',
    baseUrl: '',
    models: [
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
      { id: 'kimi-k2.7-code', name: 'kimi-k2.7-code' },
      { id: 'glm-5.2', name: 'glm-5.2' },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
      { id: 'qwen3.8-max', name: 'qwen3.8-max' },
      { id: 'grok-code-fast-1', name: 'grok-code-fast-1' },
      { id: 'mistral-large-latest', name: 'mistral-large-latest' },
    ],
    keyPlaceholder: 'sk-xxx',
    keyHint: '输入你的 API Key',
  },
};

export const PI_AI_CURATED_PRESETS: Record<string, { piProvider: string; pick: string[] }> = {
  openrouter: {
    piProvider: 'openrouter',
    pick: [
      'anthropic/claude-fable-5.1',
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-6-astra',
      'openai/gpt-5.6-sol',
      'google/gemini-3.8-flash',
      'google/gemini-3.1-pro-preview',
    ],
  },
  anthropic: {
    piProvider: 'anthropic',
    pick: [
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ],
  },
  openai: {
    piProvider: 'openai',
    pick: [
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.3-codex',
    ],
  },
  'openai-codex': {
    piProvider: 'openai-codex',
    pick: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  },
  deepseek: {
    piProvider: 'deepseek',
    pick: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  zai: {
    piProvider: 'zai',
    pick: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5'],
  },
  aliyun: {
    piProvider: 'aliyun',
    pick: ['qwen3.8-max', 'qwen3.7-max', 'deepseek-v4-pro', 'glm-5.2', 'kimi-k2.7-code'],
  },
  gemini: {
    piProvider: 'google',
    pick: [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
    ],
  },
};

export function getModelInputGuidance(
  provider: SharedProviderType,
  customProtocol: SharedCustomProtocolType = 'anthropic'
): ModelInputGuidance {
  if (provider === 'openrouter') {
    return {
      placeholder: 'openai/gpt-6-astra, anthropic/claude-sonnet-5, google/gemini-3.8-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'openai') {
    return {
      placeholder: 'deepseek-v4-pro, deepseek-v4-flash, qwen3.8-max, gpt-5.4-mini',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'gemini') {
    return {
      placeholder: 'gemini-3.8-flash, gemini-3.1-pro-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom') {
    return {
      placeholder: 'glm-5.2, kimi-k2.7-code, claude-sonnet-5',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'openai') {
    return {
      placeholder: 'gpt-6-astra, gpt-5.6-sol, gpt-5.4-mini',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'openai-codex') {
    return {
      placeholder: 'gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna',
      hint: 'Use a model available to your ChatGPT subscription (Codex).',
    };
  }

  if (provider === 'deepseek') {
    return {
      placeholder: 'deepseek-v4-pro, deepseek-v4-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'moonshot') {
    return {
      placeholder: 'kimi-k3, kimi-k2.7-code, kimi-k2.6',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'aliyun') {
    return {
      placeholder: 'qwen3.8-max, qwen3.7-max, deepseek-v4-pro, glm-5.2, kimi-k2.7-code',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'zai') {
    return {
      placeholder: 'glm-5.3, glm-5.2, glm-5.1',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'sophron') {
    return {
      placeholder: '',
      hint: 'Use the built-in LLM model returned by the backend proxy.',
    };
  }

  if (provider === 'ollama') {
    return {
      placeholder: 'qwen3.5:0.8b, llama3.3:latest, gpt-oss:20b',
      hint: 'Use the exact model ID returned by your Ollama server.',
    };
  }

  if (provider === 'gemini') {
    return {
      placeholder: 'gemini-3.8-flash, gemini-3.5-flash, gemini-3.1-pro-preview',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  return {
    placeholder: 'claude-sonnet-5, claude-opus-5',
    hint: 'Use the exact model ID for the selected protocol or endpoint.',
  };
}
