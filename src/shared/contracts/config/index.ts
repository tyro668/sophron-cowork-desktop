/**
 * Cross-process config contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
import type {
  PersonalAnalysisConfig,
  StoredPersonalAnalysisConfig,
} from '../../personal-analysis-types';
import type { PermissionPolicyId } from '../../permission-policies';

// App Config types
export type ProviderType =
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

export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';

export type AppTheme = 'dark' | 'light' | 'system';

/** Accent color families rendered via `:root[data-accent-theme]` in globals.css. */
export type AppAccentTheme = 'mint' | 'lake' | 'lavender' | 'orange' | 'rose';

/** The selectable application logo artwork. */
export type AppLogoVariant = 'mark' | 'fold';

/** Extended-thinking effort level applied when `enableThinking` is on. */
export type ThinkingLevel = 'low' | 'medium' | 'high';

export type ProviderProfileKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'openai-codex'
  | 'deepseek'
  | 'moonshot'
  | 'aliyun'
  | 'zai'
  | 'sophron'
  | 'gemini'
  | 'ollama'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';

export type ConfigSetId = string;

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  // Empty string means "no provider selected yet" (a freshly created blank set)
  provider: ProviderType | '';
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  thinkingLevel: ThinkingLevel;
  updatedAt: string;
}

export type CreateSetMode = 'blank' | 'clone';

export interface CreateSetPayload {
  name: string;
  mode: CreateSetMode;
  fromSetId?: string;
}

/** @deprecated Alias kept for main-process call sites; use CreateSetPayload. */
export type CreateConfigSetPayload = CreateSetPayload;

export interface MemoryModelRuntimeConfig {
  inheritFromActive: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  llm: MemoryModelRuntimeConfig;
  embedding: MemoryModelRuntimeConfig;
  useEmbedding: boolean;
  maxNavSteps: number;
  ingestionConcurrency: number;
  storageRoot?: string;
  evalEnabled?: boolean;
  evalWorkspaces?: string[];
  evalMaxRounds?: number;
  evalArtifactsRoot?: string;
  promptIterationRounds?: number;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  builtinLlmModel?: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  enableDevLogs: boolean;
  theme: AppTheme;
  accentTheme: AppAccentTheme;
  logoVariant: AppLogoVariant;
  permissionPolicy: PermissionPolicyId;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  memoryRuntime: MemoryRuntimeConfig;
  personalAnalysis: StoredPersonalAnalysisConfig;
  enableThinking: boolean;
  thinkingLevel: ThinkingLevel;
  isConfigured: boolean;
}

/**
 * Wire payload for `config.save`. Unlike the stored AppConfig, every field is
 * optional and `personalAnalysis` may omit server-stamped fields (updatedAt).
 */
export type AppConfigUpdate = Partial<Omit<AppConfig, 'personalAnalysis'>> & {
  personalAnalysis?: PersonalAnalysisConfig;
};

export interface DesktopAuthUser {
  userId: string;
  username?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  remainingCredits?: number | null;
}

export interface AiCreditUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCredits: number;
  outputCredits: number;
  totalCredits: number;
}

export interface AiCreditUsageRecord {
  recordId: string;
  provider: string;
  providerName?: string;
  model: string;
  mode: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  credits: {
    inputCredits: number;
    outputCredits: number;
    totalCredits: number;
  };
  createdAt: string;
}

export interface AiCreditUsageSummary {
  totals: AiCreditUsageTotals;
  records?: AiCreditUsageRecord[];
}

export interface AiCreditBalance {
  quotaCredits: number;
  usedCredits: number;
  availableCredits: number;
  unit?: string;
  exhausted?: boolean;
  usage?: AiCreditUsageTotals;
}

export interface DesktopAuthStatus {
  authenticated: boolean;
  user?: DesktopAuthUser;
  aiCredits?: AiCreditBalance;
  aiCreditUsage?: AiCreditUsageSummary;
  apiOrigin?: string;
  expiresAt?: number;
  updatedAt: number;
  error?: string;
}

export interface CodexAuthStatus {
  connected: boolean;
  source: 'codex-cli' | 'app' | null;
  accountId?: string;
  expiresAt?: number;
}

export interface CodexAuthActionResult {
  success: boolean;
  status: CodexAuthStatus;
  error?: string;
}

export interface CodexLoginPromptPayload {
  requestId: string;
  message: string;
}

export type AgentRuntimeConfig = Pick<
  AppConfig,
  | 'provider'
  | 'apiKey'
  | 'baseUrl'
  | 'customProtocol'
  | 'model'
  | 'contextWindow'
  | 'maxTokens'
  | 'enableThinking'
  | 'thinkingLevel'
>;

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export interface ProviderPresets {
  openrouter: ProviderPreset;
  anthropic: ProviderPreset;
  custom: ProviderPreset;
  openai: ProviderPreset;
  'openai-codex': ProviderPreset;
  deepseek: ProviderPreset;
  moonshot: ProviderPreset;
  aliyun: ProviderPreset;
  zai: ProviderPreset;
  sophron: ProviderPreset;
  gemini: ProviderPreset;
  ollama: ProviderPreset;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  provider?: string;
  upstreamModel?: string;
  creditMultiplier?: number;
  inputCreditMultiplier?: number;
  outputCreditMultiplier?: number;
  creditUnit?: string;
}

export interface ApiTestInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  useLiveRequest?: boolean;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface ApiTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  errorType?:
    | 'missing_key'
    | 'missing_base_url'
    | 'unauthorized'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'ollama_not_running'
    | 'ollama_loading'
    | 'unknown';
  details?: string;
}

// API Diagnostics types
export type DiagnosticStepName = 'dns' | 'tcp' | 'tls' | 'auth' | 'model';

export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip';

export type DiagnosticVerificationLevel = 'fast' | 'deep';

export type DiagnosticAdvisoryCode = 'not_deep_verified' | 'model_loading' | 'manual_model';

export interface DiagnosticStep {
  name: DiagnosticStepName;
  status: DiagnosticStepStatus;
  latencyMs?: number;
  error?: string;
  fix?: string;
}

export interface DiagnosticResult {
  steps: DiagnosticStep[];
  overallOk: boolean;
  /** Which step failed first (null if all ok) */
  failedAt?: DiagnosticStepName;
  totalLatencyMs: number;
  verificationLevel?: DiagnosticVerificationLevel;
  advisoryCode?: DiagnosticAdvisoryCode;
  advisoryText?: string;
  /** Present when the run was skipped (e.g. 'concurrent_run') */
  skippedReason?: string;
}

export interface DiagnosticInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface LocalServiceInfo {
  type: 'ollama';
  baseUrl: string;
  models?: string[];
}

export type LocalOllamaDiscoveryStatus = 'unavailable' | 'service_available' | 'models_available';

export interface LocalOllamaDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: LocalOllamaDiscoveryStatus;
}
