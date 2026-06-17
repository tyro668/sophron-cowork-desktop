export type SharedProviderType =
  | 'openrouter'
  | 'anthropic'
  | 'custom'
  | 'openai'
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
      { id: 'anthropic/claude-opus-4-6', name: 'anthropic/claude-opus-4-6' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'anthropic/claude-sonnet-4-6' },
      { id: 'anthropic/claude-haiku-4-5', name: 'anthropic/claude-haiku-4-5' },
      { id: 'openai/gpt-5.4', name: 'openai/gpt-5.4' },
      { id: 'openai/gpt-5.3-codex', name: 'openai/gpt-5.3-codex' },
      { id: 'google/gemini-3.1-pro-preview', name: 'google/gemini-3.1-pro-preview' },
      { id: 'google/gemini-3-flash-preview', name: 'google/gemini-3-flash-preview' },
      { id: 'google/gemini-2.5-flash', name: 'google/gemini-2.5-flash' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-opus-4-6', name: 'claude-opus-4-6' },
      { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
      { id: 'claude-3-7-sonnet-latest', name: 'claude-3-7-sonnet-latest' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'gpt-5.4-pro', name: 'gpt-5.4-pro' },
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
      { id: 'gpt-5.4-nano', name: 'gpt-5.4-nano' },
      { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.openai.com 获取',
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
      { id: 'kimi-k2.6', name: 'kimi-k2.6' },
      { id: 'kimi-k2.5', name: 'kimi-k2.5' },
      { id: 'kimi-k2-thinking', name: 'kimi-k2-thinking' },
      { id: 'moonshot-v1-128k', name: 'moonshot-v1-128k' },
      { id: 'moonshot-v1-32k', name: 'moonshot-v1-32k' },
      { id: 'moonshot-v1-8k', name: 'moonshot-v1-8k' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.kimi.ai / platform.moonshot.ai 获取',
  },
  aliyun: {
    name: 'Aliyun',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3-max', name: 'Qwen3-Max' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { id: 'glm-5.1', name: 'GLM-5.1' },
      { id: 'kimi-k2.6', name: 'Kimi-K2.6' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从阿里云百炼控制台 / DashScope 获取',
  },
  zai: {
    name: 'Z.AI',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: [
      { id: 'glm-5.1', name: 'glm-5.1' },
      { id: 'glm-5', name: 'glm-5' },
      { id: 'glm-4.5', name: 'glm-4.5' },
      { id: 'glm-4.5-air', name: 'glm-4.5-air' },
      { id: 'glm-4.5-flash', name: 'glm-4.5-flash' },
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
      { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' },
      { id: 'gemini-3.1-flash-lite-preview', name: 'gemini-3.1-flash-lite-preview' },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: '从 aistudio.google.com 获取',
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' },
      { id: 'llama3.2:latest', name: 'llama3.2:latest' },
      { id: 'deepseek-r1:latest', name: 'deepseek-r1:latest' },
    ],
    keyPlaceholder: '可留空',
    keyHint: '多数 Ollama 部署可留空；如果你的代理层要求鉴权，也可以填写 Key',
  },
  custom: {
    name: '更多模型',
    baseUrl: '',
    models: [
      { id: 'deepseek-chat', name: 'deepseek-chat' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      { id: 'kimi-k2-thinking', name: 'kimi-k2-thinking' },
      { id: 'glm-5', name: 'glm-5' },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
      { id: 'qwen-max', name: 'qwen-max' },
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
      'anthropic/claude-opus-4-6',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-5.4',
      'openai/gpt-5.3-codex',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3-flash-preview',
      'google/gemini-2.5-flash',
    ],
  },
  anthropic: {
    piProvider: 'anthropic',
    pick: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet-latest',
    ],
  },
  openai: {
    piProvider: 'openai',
    pick: [
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.3-codex',
      'o3',
      'o4-mini',
    ],
  },
  deepseek: {
    piProvider: 'deepseek',
    pick: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  zai: {
    piProvider: 'zai',
    pick: ['glm-5', 'glm-4.5', 'glm-4.5-air'],
  },
  aliyun: {
    piProvider: 'aliyun',
    pick: ['qwen3-max', 'deepseek-v4-pro', 'glm-5.1', 'kimi-k2.6'],
  },
  gemini: {
    piProvider: 'google',
    pick: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
  },
};

export function getModelInputGuidance(
  provider: SharedProviderType,
  customProtocol: SharedCustomProtocolType = 'anthropic'
): ModelInputGuidance {
  if (provider === 'openrouter') {
    return {
      placeholder: 'openai/gpt-5.4, anthropic/claude-sonnet-4-6, google/gemini-3-flash-preview',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'openai') {
    return {
      placeholder: 'deepseek-chat, deepseek-reasoner, qwen-max, gpt-5.4-mini',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom') {
    return {
      placeholder: 'glm-5, kimi-k2-thinking, claude-sonnet-4-6',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'openai') {
    return {
      placeholder: 'gpt-5.4, gpt-5.4-mini, o3',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
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
      placeholder: 'kimi-k2.6, kimi-k2.5, kimi-k2-thinking',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'aliyun') {
    return {
      placeholder: 'qwen3-max, deepseek-v4-pro, glm-5.1, kimi-k2.6',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'zai') {
    return {
      placeholder: 'glm-5.1, glm-5, glm-4.5',
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
      placeholder: 'qwen3.5:0.8b, llama3.2:latest, deepseek-r1:latest',
      hint: 'Use the exact model ID returned by your Ollama server.',
    };
  }

  if (provider === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  return {
    placeholder: 'claude-sonnet-4-6, claude-opus-4-6',
    hint: 'Use the exact model ID for the selected protocol or endpoint.',
  };
}
