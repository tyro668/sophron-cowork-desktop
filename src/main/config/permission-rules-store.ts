/**
 * @module main/config/permission-rules-store
 *
 * Main-process permission rule cache and per-run rule snapshots.
 *
 * The persisted permission policy is owned by ConfigStore. The active run's
 * rules are scoped to its session, so a policy change elsewhere cannot alter
 * the authorizations of an in-flight tool call.
 *
 * Security note: callers may pass untrusted rules at this boundary. Invalid
 * actions become `ask`; malformed or empty rule sets fall back to the
 * conservative default rules rather than silently allowing every tool.
 */
import { DEFAULT_PERMISSION_RULES, isPermissionPolicy } from '../../shared/permission-policies';
import type { PermissionPolicyId, PermissionRule } from '../../shared/permission-policies';
import { reviewAutoPermission } from './permission-auto-review';
import type { AutoReviewReason } from './permission-auto-review';

const VALID_ACTIONS: ReadonlySet<PermissionRule['action']> = new Set(['allow', 'deny', 'ask']);

let rules: PermissionRule[] = [...DEFAULT_PERMISSION_RULES];
let activePolicy: PermissionPolicyId = 'default';

/** Session-scoped "always allow" decisions, keyed by sessionId → set of lowercase tool names. */
const alwaysAllowBySession = new Map<string, Set<string>>();
const scopedRulesBySession = new Map<string, PermissionRule[]>();
const scopedPolicyBySession = new Map<string, PermissionPolicyId>();
const lastRunRulesBySession = new Map<string, string>();

export interface PermissionEvaluation {
  decision: PermissionRule['action'];
  source: 'rule' | 'remembered' | 'auto_review';
  reason?: AutoReviewReason;
}

/**
 * Sanitize an untrusted rules payload from IPC. Drops entries with empty
 * tool names, coerces invalid `action` values to `'ask'`, and preserves
 * optional string `pattern` fields. Returns null for non-array input.
 */
function sanitizeRules(input: unknown): PermissionRule[] | null {
  if (!Array.isArray(input)) return null;
  const out: PermissionRule[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<PermissionRule>;
    const tool = typeof r.tool === 'string' ? r.tool.trim() : '';
    if (!tool) continue;

    const pattern = typeof r.pattern === 'string' ? r.pattern : undefined;
    const rawAction = typeof r.action === 'string' ? r.action : '';
    const action: PermissionRule['action'] = VALID_ACTIONS.has(
      rawAction as PermissionRule['action']
    )
      ? (rawAction as PermissionRule['action'])
      : 'ask'; // Conservative fallback for unknown / malformed actions

    out.push({ tool, pattern, action });
  }
  return out;
}

export function setPermissionRules(next: unknown, policy: unknown = 'default'): void {
  const sanitized = sanitizeRules(next);
  const nextRules = sanitized && sanitized.length > 0 ? sanitized : [...DEFAULT_PERMISSION_RULES];
  const nextPolicy = isPermissionPolicy(policy) && sanitized?.length ? policy : 'default';
  if (JSON.stringify(nextRules) !== JSON.stringify(rules) || nextPolicy !== activePolicy) {
    // A policy change revokes grants from earlier, potentially less restrictive
    // modes. Per-run snapshots remain intact until their run completes.
    alwaysAllowBySession.clear();
  }
  rules = nextRules;
  activePolicy = nextPolicy;
}

export function getPermissionRules(): PermissionRule[] {
  // Return a shallow copy so external callers can't mutate the internal cache.
  return rules.map((r) => ({ ...r }));
}

export function setSessionPermissionRules(
  sessionId: string,
  next: unknown,
  policy: unknown = 'default'
): void {
  const sanitized = sanitizeRules(next);
  const nextRules = sanitized && sanitized.length > 0 ? sanitized : [...DEFAULT_PERMISSION_RULES];
  const nextPolicy = isPermissionPolicy(policy) && sanitized?.length ? policy : 'default';
  const signature = JSON.stringify([nextPolicy, nextRules]);
  if (lastRunRulesBySession.get(sessionId) !== signature) {
    alwaysAllowBySession.delete(sessionId);
    lastRunRulesBySession.set(sessionId, signature);
  }
  scopedRulesBySession.set(
    sessionId,
    nextRules.map((rule) => ({ ...rule }))
  );
  scopedPolicyBySession.set(sessionId, nextPolicy);
}

export function clearSessionPermissionRules(sessionId: string): void {
  scopedRulesBySession.delete(sessionId);
  scopedPolicyBySession.delete(sessionId);
}

/**
 * Decide how a given tool call should be handled.
 *
 * Matching order:
 *   1. First rule whose `tool` matches (case-insensitive, or `*`) AND
 *      whose optional `pattern` (glob-ish: `*` = any substring) matches
 *      the stringified input
 *   2. A matching deny rule always wins; "always allow" only bypasses ask
 *   3. Default: 'ask' for unknown tools (conservative)
 *
 * Defence-in-depth: even though `setPermissionRules` sanitizes input, we
 * re-validate the matched rule's action here so a malformed rule that
 * somehow bypasses sanitation still falls back to `'ask'` rather than
 * letting an unknown value propagate into the execution path.
 */
export function decidePermission(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): 'allow' | 'deny' | 'ask' {
  return evaluatePermission(sessionId, toolName, input).decision;
}

export function evaluatePermission(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  reviewToolName = toolName,
  cwd?: string
): PermissionEvaluation {
  const lowered = toolName.toLowerCase();

  const inputStr = safeStringify(input);
  const activeRules = scopedRulesBySession.get(sessionId) ?? rules;
  const policy = scopedPolicyBySession.get(sessionId) ?? activePolicy;

  for (const rule of activeRules) {
    const tool = rule.tool.toLowerCase();
    if (tool !== '*' && tool !== lowered) continue;
    if (rule.pattern && !matchesPattern(rule.pattern, inputStr)) continue;
    const decision = VALID_ACTIONS.has(rule.action) ? rule.action : 'ask';
    if (decision === 'ask' && alwaysAllowBySession.get(sessionId)?.has(lowered)) {
      return { decision: 'allow', source: 'remembered' };
    }
    // An explicit per-tool ask is never silently promoted. Only the final
    // auto-review wildcard delegates to the structured per-call reviewer.
    if (decision === 'ask' && rule.tool === '*' && policy === 'auto_review') {
      try {
        const reviewed = reviewAutoPermission(reviewToolName.toLowerCase(), input, cwd);
        return { ...reviewed, source: 'auto_review' };
      } catch {
        return { decision: 'ask', source: 'auto_review', reason: 'arguments_need_confirmation' };
      }
    }
    return { decision, source: 'rule' };
  }
  return alwaysAllowBySession.get(sessionId)?.has(lowered)
    ? { decision: 'allow', source: 'remembered' }
    : { decision: 'ask', source: 'rule' };
}

export function rememberAlwaysAllow(sessionId: string, toolName: string): void {
  const set = alwaysAllowBySession.get(sessionId) ?? new Set<string>();
  set.add(toolName.toLowerCase());
  alwaysAllowBySession.set(sessionId, set);
}

export function forgetSessionPermissions(sessionId: string): void {
  alwaysAllowBySession.delete(sessionId);
  scopedRulesBySession.delete(sessionId);
  scopedPolicyBySession.delete(sessionId);
  lastRunRulesBySession.delete(sessionId);
}

function safeStringify(v: unknown): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s ?? '';
  } catch {
    return '';
  }
}

function matchesPattern(pattern: string, haystack: string): boolean {
  // Escape regex metacharacters except '*', then convert '*' → '.*'
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped, 'i').test(haystack);
}
