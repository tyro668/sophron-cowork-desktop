/**
 * Conservative, per-call auto review. An approval is possible only for an
 * exact, audited read-only tool with a small, well-formed argument payload.
 * Unknown tools and malformed/oversized arguments always need confirmation.
 * In particular, shell command text is never treated as proof of safety.
 */
export type AutoReviewReason =
  | 'read_only_manifest'
  | 'read_only_normalizer_versions'
  | 'arguments_need_confirmation'
  | 'tool_needs_confirmation';

export interface AutoReviewResult {
  decision: 'allow' | 'ask';
  reason: AutoReviewReason;
}

const MAX_IDS = 8;
const MAX_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validIds(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.length <= MAX_IDS && value.every(validId))
  );
}

export function reviewAutoPermission(toolName: string, input: unknown): AutoReviewResult {
  if (toolName === 'data_get_workflow_capability_manifest') {
    if (
      isRecord(input) &&
      hasOnlyKeys(input, ['inputTableIds', 'outputTableIds']) &&
      validIds(input.inputTableIds) &&
      validIds(input.outputTableIds)
    ) {
      return { decision: 'allow', reason: 'read_only_manifest' };
    }
    return { decision: 'ask', reason: 'arguments_need_confirmation' };
  }

  if (toolName === 'data_list_input_table_normalizer_versions') {
    if (isRecord(input) && hasOnlyKeys(input, ['artifactId']) && validId(input.artifactId)) {
      return { decision: 'allow', reason: 'read_only_normalizer_versions' };
    }
    return { decision: 'ask', reason: 'arguments_need_confirmation' };
  }

  return { decision: 'ask', reason: 'tool_needs_confirmation' };
}
