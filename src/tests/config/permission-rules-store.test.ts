/**
 * Tests for src/main/config/permission-rules-store.
 *
 * Focus areas (security-critical):
 *   - decidePermission() returns allow / deny / ask per rule
 *   - Glob-ish pattern matching ('*' = any substring) and case-insensitivity
 *   - Session-scoped "always allow" memory works within session and clears on
 *     forgetSessionPermissions()
 *   - Garbage / malformed renderer input falls back to DEFAULT_RULES so the
 *     fail-safe is an extra prompt, never a silent auto-allow
 *   - Malformed individual rule entries are coerced to 'ask' rather than
 *     silently bypassed
 */
import { beforeEach, describe, it, expect } from 'vitest';
import {
  decidePermission,
  evaluatePermission,
  clearSessionPermissionRules,
  forgetSessionPermissions,
  getPermissionRules,
  rememberAlwaysAllow,
  setPermissionRules,
  setSessionPermissionRules,
} from '../../main/config/permission-rules-store';
import { getPermissionRulesForPolicy } from '../../shared/permission-policies';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

// Reset to DEFAULT_RULES before each test by passing garbage input — the
// module documents that this falls back to defaults rather than empty rules.
function resetToDefaults(): void {
  setPermissionRules(null);
  forgetSessionPermissions(SESSION_A);
  forgetSessionPermissions(SESSION_B);
  clearSessionPermissionRules(SESSION_A);
  clearSessionPermissionRules(SESSION_B);
}

describe('permission-rules-store', () => {
  beforeEach(() => {
    resetToDefaults();
  });

  describe('decidePermission — built-in defaults', () => {
    it('returns allow for default-allowed read tool', () => {
      expect(decidePermission(SESSION_A, 'read', { path: '/tmp/x' })).toBe('allow');
    });

    it('returns ask for default-ask bash tool', () => {
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('returns ask for default-ask write tool', () => {
      expect(decidePermission(SESSION_A, 'write', { path: '/etc/passwd' })).toBe('ask');
    });

    it('returns ask for unknown tool (conservative default)', () => {
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('ask');
    });

    it('matches tool names case-insensitively', () => {
      expect(decidePermission(SESSION_A, 'READ', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'BaSh', { command: 'ls' })).toBe('ask');
    });
  });

  describe('setPermissionRules — explicit rules', () => {
    it('returns allow when matching allow rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'allow' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('allow');
    });

    it('returns deny when matching deny rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('deny');
    });

    it('returns ask when matching ask rule is set', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('falls through to default ask when no rule matches the tool', () => {
      setPermissionRules([{ tool: 'read', action: 'allow' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('supports wildcard rules for full-access mode', () => {
      setPermissionRules([{ tool: '*', action: 'allow' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /tmp/x' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('allow');
    });

    it('auto-reviews routine work while keeping consequential operations behind confirmation', () => {
      setPermissionRules(getPermissionRulesForPolicy('auto_review'), 'auto_review');

      expect(decidePermission(SESSION_A, 'read', { path: '/tmp/in.txt' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'data_list_pipelines', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'write', { path: '/tmp/out.txt' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'edit', { path: '/tmp/out.txt' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', { command: 'npm test' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'automation_create', {})).toBe('ask');
      expect(decidePermission(SESSION_A, 'automation_update_schedule', {})).toBe('ask');
      expect(decidePermission(SESSION_A, 'data_generate_pipeline_from_requirement', {})).toBe(
        'allow'
      );
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('ask');
    });

    it('keeps structured read-only argument validation in auto-review', () => {
      const manifestArgs = { rawTableIds: ['table-1'] };
      const versionArgs = { artifactId: 'artifact-1' };
      setPermissionRules(getPermissionRulesForPolicy('default'), 'default');
      expect(
        decidePermission(SESSION_A, 'data_get_workflow_capability_manifest', manifestArgs)
      ).toBe('ask');
      expect(
        decidePermission(SESSION_A, 'data_list_raw_table_normalizer_versions', versionArgs)
      ).toBe('ask');

      setPermissionRules(getPermissionRulesForPolicy('auto_review'), 'auto_review');
      expect(
        evaluatePermission(SESSION_A, 'data_get_workflow_capability_manifest', manifestArgs)
      ).toEqual({
        decision: 'allow',
        source: 'auto_review',
        reason: 'read_only_manifest',
      });
      expect(
        evaluatePermission(SESSION_A, 'data_list_raw_table_normalizer_versions', versionArgs)
      ).toEqual({
        decision: 'allow',
        source: 'auto_review',
        reason: 'read_only_normalizer_versions',
      });
    });

    it('asks when reviewed arguments are malformed, oversized, or have extra fields', () => {
      setPermissionRules(getPermissionRulesForPolicy('auto_review'), 'auto_review');
      const manifest = 'data_get_workflow_capability_manifest';
      expect(
        evaluatePermission(SESSION_A, manifest, { rawTableIds: Array(9).fill('a') })
      ).toMatchObject({
        decision: 'ask',
        reason: 'arguments_need_confirmation',
      });
      expect(
        evaluatePermission(SESSION_A, manifest, { resultTableIds: ['  bad  '] })
      ).toMatchObject({
        decision: 'ask',
        reason: 'arguments_need_confirmation',
      });
      expect(
        evaluatePermission(SESSION_A, manifest, { rawTableIds: [], command: 'rm -rf /' })
      ).toMatchObject({
        decision: 'ask',
        reason: 'arguments_need_confirmation',
      });
      expect(
        decidePermission(SESSION_A, 'data_list_raw_table_normalizer_versions', {
          artifactId: 'artifact-1',
          prepareDependencies: true,
        })
      ).toBe('ask');
    });

    it('preserves explicit asks and requires confirmation for unclassified tools', () => {
      setPermissionRules(getPermissionRulesForPolicy('auto_review'), 'auto_review');
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('ask');
      setSessionPermissionRules(
        SESSION_A,
        [
          { tool: 'data_get_workflow_capability_manifest', action: 'ask' },
          { tool: '*', action: 'ask' },
        ],
        'auto_review'
      );
      expect(decidePermission(SESSION_A, 'data_get_workflow_capability_manifest', {})).toBe('ask');
    });

    it('keeps a deny above auto-review and isolates concurrent policy snapshots', () => {
      setSessionPermissionRules(
        SESSION_A,
        getPermissionRulesForPolicy('auto_review'),
        'auto_review'
      );
      setSessionPermissionRules(SESSION_B, getPermissionRulesForPolicy('default'), 'default');
      expect(decidePermission(SESSION_A, 'data_get_workflow_capability_manifest', {})).toBe(
        'allow'
      );
      expect(decidePermission(SESSION_B, 'data_get_workflow_capability_manifest', {})).toBe('ask');

      setSessionPermissionRules(
        SESSION_A,
        [
          { tool: 'data_get_workflow_capability_manifest', action: 'deny' },
          ...getPermissionRulesForPolicy('auto_review'),
        ],
        'auto_review'
      );
      expect(decidePermission(SESSION_A, 'data_get_workflow_capability_manifest', {})).toBe('deny');
    });

    it('uses session-scoped rules without mutating the global policy', () => {
      setPermissionRules(getPermissionRulesForPolicy('default'));
      setSessionPermissionRules(SESSION_A, getPermissionRulesForPolicy('full_access'));

      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('allow');
      expect(decidePermission(SESSION_B, 'unknown_tool', {})).toBe('ask');

      clearSessionPermissionRules(SESSION_A);
      expect(decidePermission(SESSION_A, 'unknown_tool', {})).toBe('ask');
    });

    it('falls back to conservative rules for an empty per-run snapshot', () => {
      setPermissionRules(getPermissionRulesForPolicy('full_access'));
      setSessionPermissionRules(SESSION_A, []);

      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /tmp/x' })).toBe('ask');
      expect(decidePermission(SESSION_B, 'bash', { command: 'rm -rf /tmp/x' })).toBe('allow');
    });
  });

  describe('pattern matching', () => {
    it("rule for 'bash' with pattern 'ls *' allows 'ls -la' but not 'rm -rf'", () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'ls *', action: 'allow' },
        { tool: 'bash', action: 'ask' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls -la' })).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /tmp' })).toBe('ask');
    });

    it('uses first matching rule (rules are evaluated in order)', () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'rm *', action: 'deny' },
        { tool: 'bash', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('allow');
    });

    it('treats * as any substring (not just trailing wildcards)', () => {
      setPermissionRules([{ tool: 'bash', pattern: '*sudo*', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'echo hi | sudo tee f' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'bash', { command: 'echo hi' })).toBe('ask');
    });

    it('escapes regex metacharacters in patterns (security: prevents injection)', () => {
      // '.' in pattern must match literal '.', not any char
      setPermissionRules([{ tool: 'bash', pattern: 'rm a.txt', action: 'deny' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm a.txt' })).toBe('deny');
      // Should NOT match because the '.' is escaped to a literal dot
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm aXtxt' })).toBe('ask');
    });

    it('falls through when pattern does not match', () => {
      setPermissionRules([
        { tool: 'bash', pattern: 'ls *', action: 'allow' },
        // No catch-all → falls through to module default ('ask')
      ]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'cat /etc/passwd' })).toBe('ask');
    });

    it('matches pattern against stringified JSON input for non-bash tools', () => {
      setPermissionRules([
        { tool: 'write', pattern: '*sensitive*', action: 'deny' },
        { tool: 'write', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'write', { path: '/sensitive/data.json' })).toBe('deny');
      expect(decidePermission(SESSION_A, 'write', { path: '/tmp/ok.txt' })).toBe('allow');
    });
  });

  describe('session-scoped always-allow', () => {
    it('rememberAlwaysAllow makes future calls allow within the same session', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('ask');
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', { command: 'ls' })).toBe('allow');
    });

    it('always-allow does NOT leak to other sessions', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      // Same tool, different session — must still ask
      expect(decidePermission(SESSION_B, 'bash', { command: 'ls' })).toBe('ask');
    });

    it('forgetSessionPermissions clears session-scoped allow memory', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
      forgetSessionPermissions(SESSION_A);
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('always-allow is case-insensitive (normalized to lowercase)', () => {
      setPermissionRules([{ tool: 'bash', action: 'ask' }]);
      rememberAlwaysAllow(SESSION_A, 'BASH');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'Bash', {})).toBe('allow');
    });

    it('a deny rule takes precedence over earlier always-allow memory', () => {
      setPermissionRules([{ tool: 'bash', action: 'deny' }]);
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('deny');
    });

    it('revokes always-allow grants when the global policy changes', () => {
      setPermissionRules(getPermissionRulesForPolicy('default'));
      rememberAlwaysAllow(SESSION_A, 'bash');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');

      setPermissionRules(getPermissionRulesForPolicy('full_access'));
      setPermissionRules(getPermissionRulesForPolicy('default'));
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('revokes always-allow grants when the session changes policy between turns', () => {
      setSessionPermissionRules(SESSION_A, getPermissionRulesForPolicy('default'));
      rememberAlwaysAllow(SESSION_A, 'bash');
      clearSessionPermissionRules(SESSION_A);

      setSessionPermissionRules(SESSION_A, getPermissionRulesForPolicy('full_access'));
      clearSessionPermissionRules(SESSION_A);
      setSessionPermissionRules(SESSION_A, getPermissionRulesForPolicy('default'));
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });
  });

  it('keeps simultaneous sessions on their own policy after the global policy changes', () => {
    setPermissionRules(getPermissionRulesForPolicy('default'));
    setSessionPermissionRules(SESSION_A, getPermissionRulesForPolicy('default'));
    setSessionPermissionRules(SESSION_B, getPermissionRulesForPolicy('full_access'));

    setPermissionRules(getPermissionRulesForPolicy('full_access'));
    expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /tmp/x' })).toBe('ask');
    expect(decidePermission(SESSION_B, 'bash', { command: 'rm -rf /tmp/x' })).toBe('allow');
  });

  describe('fail-safe input sanitation', () => {
    it('falls back to DEFAULT_RULES when given null', () => {
      setPermissionRules(null);
      // read is in defaults as 'allow'
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      // bash is in defaults as 'ask'
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('falls back to DEFAULT_RULES when given non-array', () => {
      setPermissionRules({ not: 'an-array' });
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('falls back to DEFAULT_RULES when array sanitises to empty', () => {
      // All entries are garbage (no tool field) → sanitised list is empty →
      // fall back to defaults so we never run with an "allow everything"
      // empty ruleset.
      setPermissionRules([{ notTool: 'bash' }, null, 'string', 42]);
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('coerces unknown action values to ask (never silently auto-allows)', () => {
      setPermissionRules([{ tool: 'bash', action: 'YOLO' }]);
      // Action 'YOLO' is invalid → coerced to 'ask'
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('ask');
    });

    it('drops rules with empty / whitespace tool names', () => {
      setPermissionRules([
        { tool: '   ', action: 'allow' },
        { tool: '', action: 'allow' },
        { tool: 'read', action: 'allow' },
      ]);
      // The two garbage entries are dropped; the read entry survives
      const rules = getPermissionRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].tool).toBe('read');
    });

    it('coerces non-string pattern to undefined (no crash)', () => {
      setPermissionRules([{ tool: 'bash', pattern: 123 as unknown as string, action: 'allow' }]);
      // Pattern was non-string → dropped; rule applies unconditionally
      expect(decidePermission(SESSION_A, 'bash', { command: 'rm -rf /' })).toBe('allow');
    });

    it('mixes valid + garbage rules: keeps the valid ones, drops the rest', () => {
      setPermissionRules([
        { tool: 'bash', action: 'deny' },
        null,
        { notTool: 'foo' },
        { tool: '', action: 'allow' },
        { tool: 'read', action: 'allow' },
      ]);
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('deny');
      expect(decidePermission(SESSION_A, 'read', {})).toBe('allow');
    });
  });

  describe('getPermissionRules', () => {
    it('returns defaults after reset', () => {
      const rules = getPermissionRules();
      const tools = rules.map((r) => r.tool);
      expect(tools).toContain('read');
      expect(tools).toContain('bash');
    });

    it('returns shallow copies so callers cannot mutate the internal cache', () => {
      setPermissionRules([{ tool: 'bash', action: 'allow' }]);
      const rules = getPermissionRules();
      rules[0].action = 'deny';
      // Internal cache should be unaffected
      expect(decidePermission(SESSION_A, 'bash', {})).toBe('allow');
    });
  });
});
