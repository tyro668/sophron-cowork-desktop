import { describe, expect, it } from 'vitest';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  getPrepDslReference,
  parsePrepDsl,
  parsePrepOperatorDsl,
  PREP_DSL_OPERATOR_EXAMPLES,
  PREP_DSL_REFERENCE_VERSION,
  PREP_DSL_WORKFLOW_EXAMPLES,
} from '../../src/shared/prep-dsl';

function errorsOf(
  diagnostics: Array<{ severity: 'error' | 'warning'; message: string; code?: string }>
) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}

describe('prep DSL reference registry', () => {
  it('keeps the embedded reference versioned and available at runtime', () => {
    expect(PREP_DSL_REFERENCE_VERSION).toBe('prep-dsl/v3');
    expect(getPrepDslReference('overview')).toContain(PREP_DSL_REFERENCE_VERSION);
    expect(getPrepDslReference('all')).toContain('Data workflow DSL is a text pipeline language');
  });

  it('keeps all documented workflow examples parseable and compilable', () => {
    expect(PREP_DSL_WORKFLOW_EXAMPLES.length).toBeGreaterThan(0);

    for (const example of PREP_DSL_WORKFLOW_EXAMPLES) {
      const parsed = parsePrepDsl(example.dsl);
      expect(errorsOf(parsed.diagnostics), example.id).toHaveLength(0);
      expect(parsed.ast, example.id).not.toBeNull();

      const compiled = compilePrepWorkflowToFlow(parsed.ast!);
      expect(errorsOf(compiled.diagnostics), example.id).toHaveLength(0);
      expect(compiled.nodes.length, example.id).toBeGreaterThan(0);

      const exported = exportPrepWorkflowDsl(compiled.nodes, compiled.edges);
      const reparsed = parsePrepDsl(exported);
      expect(errorsOf(reparsed.diagnostics), `${example.id} exported`).toHaveLength(0);
    }
  });

  it('keeps all documented operator examples parseable by their operator parser', () => {
    expect(PREP_DSL_OPERATOR_EXAMPLES.length).toBeGreaterThan(0);

    for (const example of PREP_DSL_OPERATOR_EXAMPLES) {
      const parsed = parsePrepOperatorDsl(example.dsl, example.type);
      expect(errorsOf(parsed.diagnostics), `${example.type}: ${example.dsl}`).toHaveLength(0);
      expect(parsed.operator?.type, example.dsl).toBe(example.type);
    }
  });
});
