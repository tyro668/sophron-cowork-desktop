import { describe, expect, it } from 'vitest';
import {
  exportPrepOperatorDsl,
  findOpenFieldReference,
  parsePrepOperatorDsl,
} from '../src/shared/prep-dsl';
import { extractJsonObjectText, extractFencedBlock } from '../src/shared/structured-text';
import { compileFilterConditionExpression } from '../src/main/data/operators/filter';
import { indexJavaScriptFunctionsBestEffort } from '../src/main/data/workflow/javascript-runtime';
import { extractFieldNamesFromExpression } from '../src/main/data/workflow/utils';
import {
  requirementHasRemovalIntent,
  requirementMentionsColumn,
} from '../src/main/data/workflow/requirement-intent';

describe('data task lexical guards', () => {
  it('parses and round-trips join expectation and ASOF direction clauses', () => {
    const regular = parsePrepOperatorDsl(
      'join left customers on [orders].[id] = [customers].[id] keep left * expect many_to_one',
      'join'
    );
    expect(regular.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(regular.operator?.config.expect).toBe('many_to_one');
    const regularConfig = { ...regular.operator?.config };
    delete regularConfig.dsl;
    expect(
      exportPrepOperatorDsl({ id: 'join-regular', type: 'join', config: regularConfig })
    ).toContain('expect many_to_one');

    const asof = parsePrepOperatorDsl(
      'join asof prices on [orders].[time] >= [prices].[time] direction backward tolerance 2h expect many_to_one',
      'join'
    );
    expect(asof.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect((asof.operator?.config.asof as { direction?: string }).direction).toBe('backward');
    const asofConfig = { ...asof.operator?.config };
    delete asofConfig.dsl;
    expect(exportPrepOperatorDsl({ id: 'join-asof', type: 'join', config: asofConfig })).toContain(
      'direction backward'
    );
  });

  it('rejects incompatible join clauses during semantic validation', () => {
    const crossWithCondition = parsePrepOperatorDsl(
      'join cross customers on [orders].[id] = [customers].[id]',
      'join'
    );
    expect(crossWithCondition.diagnostics.some((item) => item.severity === 'error')).toBe(true);

    const mismatchedDirection = parsePrepOperatorDsl(
      'join asof prices on [orders].[time] >= [prices].[time] direction forward',
      'join'
    );
    expect(mismatchedDirection.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });

  it('uses the same string tokenization for filter validation and SQL compilation', () => {
    const parsed = parsePrepOperatorDsl("filter [name] = 'O''Brien'", 'filter');
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(compileFilterConditionExpression("[name] = 'O''Brien'")).toBe("\"name\" = 'O''Brien'");
  });

  it('extracts field references as tokens without reading strings as fields', () => {
    expect(
      extractFieldNamesFromExpression(
        "concat([orders].[`order.total`], '[ignored]', [`a]b`], [`a\\`b`])"
      )
    ).toEqual(['order.total', 'a]b', 'a`b']);
  });

  it('keeps delimiters inside backtick fields out of top-level DSL structure', () => {
    const parsed = parsePrepOperatorDsl(
      'aggregate by [`sales metrics,]`] metrics count(*) as [rows]',
      'aggregate'
    );
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(parsed.operator?.config.groupBy).toEqual(['sales metrics,]']);
  });

  it('finds an unfinished quoted field for completion but ignores strings and comments', () => {
    expect(findOpenFieldReference('filter [`Order Tot')).toEqual({
      start: 7,
      query: 'Order Tot',
    });
    expect(findOpenFieldReference('filter "[Order"')).toBeNull();
    expect(findOpenFieldReference('filter [name] # [`Order Tot')).toBeNull();
  });

  it('extracts fenced source and balanced JSON without matching braces in strings', () => {
    expect(extractFencedBlock('before\n```js\nfunction main() {}\n```\nafter', ['js'])).toBe(
      'function main() {}'
    );
    expect(extractJsonObjectText('answer: {"message":"a } brace","value":1} trailing')).toBe(
      '{"message":"a } brace","value":1}'
    );
  });

  it('does not index JavaScript function text inside comments or strings', () => {
    const indexed = indexJavaScriptFunctionsBestEffort(
      '// function fake() {}\nconst note = "function hidden() {}";\nfunction main() {'
    );
    expect(indexed.map((entry) => entry.name)).toEqual(['main']);
  });

  it('matches removal intent and column names by lexical word boundaries', () => {
    expect(requirementHasRemovalIntent('Please remove Unit Price')).toBe(true);
    expect(requirementHasRemovalIntent('This is a removable label')).toBe(false);
    expect(requirementMentionsColumn('Please remove Unit Price', 'Unit Price')).toBe(true);
    expect(requirementMentionsColumn('remove preorder_id', 'order_id')).toBe(false);
    expect(requirementMentionsColumn('删除记录数这一列', '记录数')).toBe(true);
  });
});
