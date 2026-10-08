/** Correlates analysis, generation, and repair calls in one authoring flow. */
export function createLlmUsageTraceId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `llm-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
