import { describe, expect, it } from 'vitest';
import { compileJflow, JFLOW_EXAMPLES, parseJflow, parseJflowSteps } from '../../src/shared/jflow';

const COLS = (names: string[]) => names.map((name) => ({ name, type: 'VARCHAR' }));
const TABLES: Record<string, string[]> = {
  RAW_ID: ['订单号', '区域', '客户ID', '状态', '金额', '日期'],
  DIM_ID: ['客户ID', '名称', '等级'],
};

describe('jflow reference', () => {
  it.each(JFLOW_EXAMPLES.map((example) => [example.id, example.text]))(
    'example %s compiles',
    (_id, text) => {
      const parsed = parseJflow(text);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const compiled = compileJflow(parsed.ast!, {
        resolve: (ref) => {
          const id = ref.arg.replace('local:raw/', '');
          return TABLES[id]
            ? { uri: ref.arg, id, kind: 'raw', name: id, columns: COLS(TABLES[id]) }
            : null;
        },
      });
      expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    }
  );

  it('step snippets in the operator section parse', () => {
    for (const step of [
      "where [状态] <> '取消'",
      'derive [新] = [a] + 1, replace [b] = upper([b])',
      "rename [a] as [b], prefix 'p_' ([c])",
      "cast [a] as integer, [d] as date format: '%Y-%m-%d' on_error: null",
      'fill [a] with 0, [b] with mean',
      "nullify [a] values ('', 'N/A')",
      'sort [a], -[b] nulls: last',
      'take 1 per: [客户] sort: -[金额]',
      'distinct by: [id] sort: -[updated_at] keep: first',
      "group [k] (agg [合计] = sum([金额]), [笔数] = count(*), [已付] = sumif([金额], [状态] = '已付'))",
      'pivot [月份] values: sum([金额])',
      'unpivot [一月], [二月] into: ([月份], [金额])',
      'check unique [id]',
      'check rows >= 1',
      "sql '''SELECT * FROM input'''",
      'derive [排名] = row_number() over (partition by [区域] order by [销售额] desc)',
      "write @new('结果') mode: merge keys: [id]",
    ]) {
      const parsed = parseJflowSteps(`| ${step}`);
      expect(
        parsed.diagnostics.filter((d) => d.severity === 'error'),
        step
      ).toEqual([]);
    }
  });
});
