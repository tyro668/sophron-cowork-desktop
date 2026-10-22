import { describe, expect, it } from 'vitest';
import { withSqlInputHint } from '../../main/data/operators/sql-query';

describe('withSqlInputHint', () => {
  it('explains named inputs when SQL references an unknown alias', () => {
    const error = withSqlInputHint(
      new Error('Catalog Error: Table with name bank does not exist!')
    );
    expect(error.message).toContain('"bank" is not an alias of any input source');
    expect(error.message).toContain('Set the alias on the input node');
  });

  it('handles the binder wording', () => {
    expect(
      withSqlInputHint(new Error('Binder Error: Referenced table "erp" not found!')).message
    ).toContain('"erp" is not an alias');
  });

  it('leaves other errors untouched', () => {
    const original = new Error('Binder Error: column "x" not found');
    expect(withSqlInputHint(original)).toBe(original);
    expect(
      withSqlInputHint(new Error('Table with name input does not exist')).message
    ).not.toContain('Hint');
  });
});
