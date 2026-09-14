import { describe, expect, it } from 'vitest';
import { compileGeneratedJavaScriptWorkflow } from '../src/main/data/workflow/workflow-generator';

function compileMissingValueWorkflow(
  method: 'mean_fill' | 'median_fill' | 'mode_fill',
  type: 'integer' | 'text'
) {
  return compileGeneratedJavaScriptWorkflow({
    javascriptSource: `function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "source" });
  const cleaned = workflow.step(input, "missing_value", {
    config: {
      strategy: "by_column",
      rules: [{ column: "value", method: "${method}" }]
    }
  });
  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });
}`,
    inputTableId: 'input-table',
    outputTableName: 'result',
    requirement: `Fill missing values using ${method}`,
    columns: [{ name: 'value', type }],
  });
}

describe('generated workflow missing-value schema inference', () => {
  it.each(['mean_fill', 'median_fill'] as const)('keeps an integer field after %s', (method) => {
    const generated = compileMissingValueWorkflow(method, 'integer');
    expect(generated.expectedOutputSchema).toEqual([{ name: 'value', type: 'integer' }]);
  });

  it('keeps integer type for mode fill', () => {
    const generated = compileMissingValueWorkflow('mode_fill', 'integer');
    expect(generated.expectedOutputSchema).toEqual([{ name: 'value', type: 'integer' }]);
  });

  it('rejects mean fill for a text field before execution', () => {
    expect(() => compileMissingValueWorkflow('mean_fill', 'text')).toThrow(
      /requires a numeric (?:field|column)/
    );
  });
});
