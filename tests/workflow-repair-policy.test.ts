import { describe, expect, it } from 'vitest';
import type { PrepDiagnostic } from '../src/shared/prep-dsl';
import {
  claimWorkflowRepairAttempt,
  createWorkflowRepairBudget,
} from '../src/main/data/workflow/workflow-failure';

function diagnostic(
  stage: 'javascript_compile' | 'workflow_lowering' | 'node_execution',
  code: string,
  functionName: string
): PrepDiagnostic {
  return {
    severity: 'error',
    code,
    message: code,
    failureStage: stage,
    repairClass: 'function_patch',
    functionName,
  } as PrepDiagnostic;
}

describe('workflow repair policy', () => {
  it('does not let source repairs consume the semantic or execution stage allowance', () => {
    const budget = createWorkflowRepairBudget({
      maxAttempts: 5,
      maxAttemptsPerStage: { source: 2, semantic: 2, execution: 2 },
      maxAttemptsPerIncident: 2,
      maxReservedOutputTokens: 15_000,
    });
    const sourceDiagnostics = diagnostic('javascript_compile', 'SOURCE_ERROR', 'sourceStep');

    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'source-1',
        diagnostics: [sourceDiagnostics],
        strategy: 'function_patch',
        maxOutputTokens: 1_200,
      }).accepted
    ).toBe(true);
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'source-2',
        diagnostics: [sourceDiagnostics],
        strategy: 'full_regeneration',
        maxOutputTokens: 3_000,
      }).accepted
    ).toBe(true);
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'source-3',
        diagnostics: [diagnostic('javascript_compile', 'OTHER_SOURCE_ERROR', 'otherStep')],
        strategy: 'function_patch',
        maxOutputTokens: 1_200,
      })
    ).toMatchObject({ accepted: false, reason: 'stage_exhausted' });
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'semantic-1',
        diagnostics: [diagnostic('workflow_lowering', 'SEMANTIC_ERROR', 'semanticStep')],
        strategy: 'function_patch',
        maxOutputTokens: 1_200,
      })
    ).toMatchObject({ accepted: true, stageAttempt: 1, incidentAttempt: 1 });
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'execution-1',
        diagnostics: [diagnostic('node_execution', 'EXECUTION_ERROR', 'executionStep')],
        strategy: 'function_patch',
        maxOutputTokens: 1_200,
      })
    ).toMatchObject({ accepted: true, stageAttempt: 1, incidentAttempt: 1 });
  });

  it('limits one root cause independently from the global attempt limit', () => {
    const budget = createWorkflowRepairBudget({
      maxAttempts: 5,
      maxAttemptsPerStage: { semantic: 4 },
      maxAttemptsPerIncident: 2,
      maxReservedOutputTokens: 15_000,
    });
    const diagnostics = diagnostic('workflow_lowering', 'SAME_ROOT_CAUSE', 'step1');

    for (const source of ['candidate-1', 'candidate-2']) {
      expect(
        claimWorkflowRepairAttempt({
          budget,
          javascriptSource: source,
          diagnostics: [diagnostics],
          strategy: source === 'candidate-1' ? 'function_patch' : 'full_regeneration',
          maxOutputTokens: 1_000,
        }).accepted
      ).toBe(true);
    }
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'candidate-3',
        diagnostics: [diagnostics],
        strategy: 'duplicate_rewrite',
        maxOutputTokens: 1_000,
      })
    ).toMatchObject({ accepted: false, reason: 'incident_exhausted' });
  });

  it('enforces the reserved repair output token ceiling', () => {
    const budget = createWorkflowRepairBudget({
      maxAttempts: 5,
      maxAttemptsPerIncident: 2,
      maxReservedOutputTokens: 1_500,
    });

    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'candidate-1',
        diagnostics: [diagnostic('javascript_compile', 'SOURCE_ERROR', 'step1')],
        maxOutputTokens: 1_200,
      }).accepted
    ).toBe(true);
    expect(
      claimWorkflowRepairAttempt({
        budget,
        javascriptSource: 'candidate-2',
        diagnostics: [diagnostic('workflow_lowering', 'SEMANTIC_ERROR', 'step2')],
        maxOutputTokens: 600,
      })
    ).toMatchObject({ accepted: false, reason: 'token_exhausted' });
  });
});
