import { describe, expect, it } from 'vitest';
import {
  findSqlSyntaxErrors,
  sanitizeSqlIdentifiers,
  validateSqlText,
} from '../../src/renderer/components/workflow-forms/sql-query/sqlLint';

describe('sql lint', () => {
  it('does not flag Chinese column names', () => {
    const sql = 'SELECT 省, SUM(金额) AS 销售额\nFROM input\nWHERE 金额 > 0 GROUP BY 省';
    expect(findSqlSyntaxErrors(sql)).toEqual([]);
    expect(validateSqlText(sql)).toBe('ok');
  });
  it('keeps positions 1:1 when sanitising', () => {
    const sql = 'SELECT 金额 FROM input';
    expect(sanitizeSqlIdentifiers(sql)).toHaveLength(sql.length);
  });
  it('still reports real syntax errors and full-width punctuation', () => {
    expect(validateSqlText('select * from (')).toBe('syntax');
    expect(findSqlSyntaxErrors('SELECT 省，金额 FROM input').length).toBeGreaterThan(0);
  });
});
