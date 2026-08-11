import { describe, expect, it } from 'vitest';
import { parseGeneratedWorkflowDslResponse } from '../src/main/data/workflow/schema-inferencer';

describe('generated workflow missing-value schema inference', () => {
  it.each(['mean', 'median'])('keeps an integer field after %s fill', (statistic) => {
    const generated = parseGeneratedWorkflowDslResponse(
      JSON.stringify({
        workflowDsl: `
            input source task as source
            from source
              | missing value [amount] fill ${statistic}
              | output table "result" mode replace
          `,
        requiredColumns: [],
      }),
      [{ name: 'amount', type: 'integer' }]
    );

    expect(generated.expectedOutputSchema).toEqual([{ name: 'amount', type: 'integer' }]);
  });

  it('keeps integer type for mode fill', () => {
    const generated = parseGeneratedWorkflowDslResponse(
      JSON.stringify({
        workflowDsl: `
          input source task as source
          from source
            | missing value [amount] fill mode
            | output table "result" mode replace
        `,
        requiredColumns: [],
      }),
      [{ name: 'amount', type: 'integer' }]
    );

    expect(generated.expectedOutputSchema).toEqual([{ name: 'amount', type: 'integer' }]);
  });

  it('rejects mean fill for a text field before execution', () => {
    expect(() =>
      parseGeneratedWorkflowDslResponse(
        JSON.stringify({
          workflowDsl: `
            input source task as source
            from source
              | missing value [name] fill mean
              | output table "result" mode replace
          `,
          requiredColumns: [],
        }),
        [{ name: 'name', type: 'text' }]
      )
    ).toThrow(/requires a numeric field/);
  });
});
