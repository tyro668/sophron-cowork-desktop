import type { WorkflowDiagnostic } from '../../../shared/workflow-diagnostics';
import {
  getOperatorConfigValidation,
  validateOperatorConfig,
} from '../../../shared/operator-schemas';

/**
 * Generated nodes use the platform schemas as a read-only compatibility contract,
 * but reject keys or values those schemas would silently strip or normalize.
 * Keeping this stricter policy here avoids changing validation behavior for
 * platform-authored workflows and prevents generated intent from changing between
 * the IR and SQL execution boundaries.
 */
export function validateGeneratedOperatorConfig(
  type: string,
  config: Record<string, unknown>
): WorkflowDiagnostic[] {
  const diagnostics = validateOperatorConfig(type, config);
  if (diagnostics.length > 0) return diagnostics;

  const parsed = getOperatorConfigValidation(type, config);
  if (!parsed.success) return diagnostics;

  return collectNonCanonicalConfigPaths(config, parsed.data).map(({ path, reason }) => ({
    code: 'invalidConfig',
    severity: 'error' as const,
    message: `[${type}] ${path}: ${reason}`,
    line: 0,
    column: 0,
    params: { path, message: reason },
  }));
}

interface NonCanonicalConfigPath {
  path: string;
  reason: string;
}

function collectNonCanonicalConfigPaths(
  input: unknown,
  parsed: unknown,
  path = '',
  issues: NonCanonicalConfigPath[] = []
): NonCanonicalConfigPath[] {
  if (Array.isArray(input)) {
    if (!Array.isArray(parsed)) {
      issues.push({ path, reason: 'Configuration value is not canonical' });
      return issues;
    }
    input.forEach((value, index) => {
      const childPath = `${path}[${index}]`;
      if (index >= parsed.length) {
        issues.push({ path: childPath, reason: 'Configuration value was removed' });
        return;
      }
      collectNonCanonicalConfigPaths(value, parsed[index], childPath, issues);
    });
    return issues;
  }
  if (isPlainRecord(input)) {
    if (!isPlainRecord(parsed)) {
      issues.push({ path, reason: 'Configuration value is not canonical' });
      return issues;
    }

    for (const [key, value] of Object.entries(input)) {
      // AI provenance is diagnostic metadata, not an operator runtime option.
      if (!path && key === 'generatedOrigin') continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
        issues.push({ path: childPath, reason: 'Unrecognized configuration key' });
        continue;
      }
      collectNonCanonicalConfigPaths(value, parsed[key], childPath, issues);
    }
    return issues;
  }
  if (!Object.is(input, parsed)) {
    issues.push({ path, reason: 'Configuration value is not canonical' });
  }
  return issues;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
