import { describe, expect, it } from 'vitest';
import { extractJsonObjectText, extractFencedBlock } from '../src/shared/structured-text';
import { compileFilterConditionExpression } from '../src/main/data/operators/filter';
import { extractFieldNamesFromExpression } from '../src/main/data/workflow/utils';

describe('data pipeline lexical guards', () => {
  it('uses the same string tokenization for filter validation and SQL compilation', () => {
    expect(compileFilterConditionExpression("[name] = 'O''Brien'")).toBe("\"name\" = 'O''Brien'");
  });

  it('extracts field references as tokens without reading strings as fields', () => {
    expect(
      extractFieldNamesFromExpression(
        "concat([orders].[`order.total`], '[ignored]', [`a]b`], [`a\\`b`])"
      )
    ).toEqual(['order.total', 'a]b', 'a`b']);
  });

  it('extracts fenced source and balanced JSON without matching braces in strings', () => {
    expect(extractFencedBlock('before\n```js\nfunction main() {}\n```\nafter', ['js'])).toBe(
      'function main() {}'
    );
    expect(extractJsonObjectText('answer: {"message":"a } brace","value":1} trailing')).toBe(
      '{"message":"a } brace","value":1}'
    );
  });
});
