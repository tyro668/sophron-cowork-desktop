import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import {
  addPivotCandidate,
  addPivotValue,
  addCustomPivotAxisValue,
  togglePivotAxisValue,
  togglePivotVisibleValues,
  removePivotCustomValue,
  getPivotMetricDefaultSuffix,
  withPivotMetricDefaultSuffix,
  getPivotAxisSelectionSummary,
  getPivotPreservedValues,
} from '../../src/shared/operator-config';

function ok(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'pivot', config });
  const parsed = parsePrepOperatorDsl(dsl, 'pivot');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return parsed.operator!;
}

describe('FormPivot — config ↔ DSL', () => {
  it('export returns empty when on is absent', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { using: [{ function: 'sum', expression: '[amount]' }] },
    });
    expect(dsl).toBe('');
  });

  it('export returns empty when using is absent', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: [{ field: 'category' }], using: [] },
    });
    expect(dsl).toBe('');
  });

  it('export returns empty when a metric is incomplete', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: [{ field: 'category' }],
        using: [{ function: 'sum', expression: '' }],
      },
    });
    expect(dsl).toBe('');
  });

  it('applies a readable default suffix when an alias is omitted', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: [{ field: 'category' }], using: [{ function: 'count', expression: '*' }] },
    });
    expect(dsl).toBe('pivot on [category] using count(*) as [count]');
    const r = ok({
      on: [{ field: 'category' }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(r.config.on).toEqual([{ field: 'category', values: [] }]);
    expect((r.config.using as Array<Record<string, unknown>>)[0].function).toBe('count');
    expect((r.config.using as Array<Record<string, unknown>>)[0].alias).toBe('count');
  });

  it('round-trips a complete pivot config with an alias and group by', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: [{ field: 'category' }],
        using: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
        groupBy: ['region'],
      },
    });
    expect(dsl).toBe('pivot on [category] using sum([amount]) as [total] group by [region]');
    const r = ok({
      on: [{ field: 'category' }],
      using: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
      groupBy: ['region'],
    });
    expect((r.config.using as Array<Record<string, unknown>>)[0].alias).toBe('total');
  });

  it('round-trips multiple ON fields each with their own value list', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: [
          { field: 'year', values: [2024, 2025] },
          { field: 'quarter', values: ['Q1', 'Q2'] },
          { field: 'channel' },
        ],
        using: [{ function: 'sum', expression: '[amount]' }],
      },
    });
    expect(dsl).toBe(
      'pivot on [year] in (2024, 2025), [quarter] in ("Q1", "Q2"), [channel] using sum([amount]) as [sum]'
    );
    const r = ok({
      on: [
        { field: 'year', values: [2024, 2025] },
        { field: 'quarter', values: ['Q1', 'Q2'] },
        { field: 'channel' },
      ],
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(r.config.on).toEqual([
      { field: 'year', values: [2024, 2025] },
      { field: 'quarter', values: ['Q1', 'Q2'] },
      { field: 'channel', values: [] },
    ]);
  });

  it('round-trips an appended custom value while preserving value order', () => {
    const { values } = addCustomPivotAxisValue(
      [],
      [],
      '3月',
      [{ raw: '1月' }, { raw: '2月' }],
      'text'
    );

    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: [{ field: '月份', values }],
        using: [{ function: 'sum', expression: '[金额]' }],
      },
    });

    expect(dsl).toBe('pivot on [`月份`] in ("1月", "2月", "3月") using sum([金额]) as [sum]');
    expect(
      ok({
        on: [{ field: '月份', values }],
        using: [{ function: 'sum', expression: '[金额]' }],
      }).config.on
    ).toEqual([{ field: '月份', values: ['1月', '2月', '3月'] }]);
  });

  it('round-trips custom numeric values without converting them back to strings', () => {
    const { values } = addCustomPivotAxisValue(
      [],
      [],
      '3',
      [{ raw: '1' }, { raw: '2' }],
      'integer'
    );

    expect(
      ok({
        on: [{ field: 'month_number', values }],
        using: [{ function: 'count', expression: '*' }],
      }).config.on
    ).toEqual([{ field: 'month_number', values: [1, 2, 3] }]);
  });
});

describe('pivot metric default suffixes', () => {
  it.each([
    ['sum', 'sum'],
    ['avg', 'avg'],
    ['min', 'min'],
    ['max', 'max'],
    ['count', 'count'],
    ['count_distinct', 'distinct_count'],
  ] as const)('maps %s to the readable suffix %s', (fn, suffix) => {
    expect(getPivotMetricDefaultSuffix(fn)).toBe(suffix);
  });

  it('preserves a custom suffix and fills only a blank suffix', () => {
    expect(
      withPivotMetricDefaultSuffix({ function: 'max', expression: '[amount]', alias: 'peak' })
    ).toEqual({ function: 'max', expression: '[amount]', alias: 'peak' });
    expect(
      withPivotMetricDefaultSuffix({ function: 'max', expression: '[amount]', alias: '' })
    ).toEqual({ function: 'max', expression: '[amount]', alias: 'max' });
  });
});

describe('pivot axis selection summary', () => {
  it('does not treat selected values as the total before distinct values load', () => {
    expect(getPivotAxisSelectionSummary(['A', 'B'], [], false)).toEqual({
      selected: 2,
      total: null,
    });
  });

  it('uses the loaded distinct value count while retaining selected values absent upstream', () => {
    expect(getPivotAxisSelectionSummary(['A', 'B'], ['A', 'B', 'C'], true)).toEqual({
      selected: 2,
      total: 3,
    });
    expect(getPivotAxisSelectionSummary(['A', 'legacy'], ['A', 'B', 'C'], true)).toEqual({
      selected: 2,
      total: 4,
    });
  });

  it('reports all loaded values as selected for the empty include-all representation', () => {
    expect(getPivotAxisSelectionSummary([], ['A', 'B', 'C'], true)).toEqual({
      selected: 3,
      total: 3,
    });
  });

  it('does not count an unselected custom value as part of the implicit source selection', () => {
    expect(getPivotAxisSelectionSummary([], ['A', 'B'], true, ['custom'])).toEqual({
      selected: 2,
      total: 3,
    });
  });
});

describe('pivot preserved values', () => {
  it('retains declared custom values before source values load', () => {
    expect(getPivotPreservedValues(['Jan'], ['Mar'], [], false)).toEqual(['Mar', 'Jan']);
  });

  it('temporarily preserves every explicit value until source values finish loading', () => {
    expect(getPivotPreservedValues(['Jan', 'Feb', 'Mar'], [], [], false)).toEqual([
      'Jan',
      'Feb',
      'Mar',
    ]);
  });

  it('infers configured values absent from the loaded source after a DSL round-trip', () => {
    expect(getPivotPreservedValues(['Jan', 'Feb', 'Mar'], [], ['Jan', 'Feb'], true)).toEqual([
      'Mar',
    ]);
  });

  it('does not duplicate declared custom values when they are absent from the source', () => {
    expect(getPivotPreservedValues(['Jan', 'Mar'], ['Mar'], ['Jan'], true)).toEqual(['Mar']);
  });
});

describe('addPivotValue', () => {
  it('translates only the newly added value and preserves existing types', () => {
    const values: Array<string | number | null> = [null, 2024, '2024'];
    expect(addPivotValue(values, 'abc', 'integer')).toEqual([null, 2024, '2024', 'abc']);
  });

  it('keeps null as null and string as string when adding a value', () => {
    const values: Array<string | number | boolean | null> = [null, '2024'];
    const next = addPivotValue(values, '2025', 'integer');
    expect(next).toEqual([null, '2024', 2025]);
  });

  it('keeps integers beyond safe range as strings', () => {
    expect(addPivotValue([], '9007199254740993', 'integer')).toEqual(['9007199254740993']);
  });

  it('deduplicates by display form', () => {
    expect(addPivotValue([2024], '2024', 'integer')).toEqual([2024]);
    expect(addPivotValue([2024], 'abc', 'integer')).toEqual([2024, 'abc']);
  });

  it('ignores empty input', () => {
    expect(addPivotValue([2024], '   ', 'integer')).toEqual([2024]);
  });

  it('preserves leading and trailing whitespace for text columns', () => {
    expect(addPivotValue([], ' A', 'text')).toEqual([' A']);
    expect(addPivotValue([], 'A ', 'text')).toEqual(['A ']);
    expect(addPivotValue([], '   ', 'text')).toEqual(['   ']);
  });

  it('trims before converting numeric columns', () => {
    expect(addPivotValue([], ' 2024 ', 'integer')).toEqual([2024]);
    expect(addPivotValue([], ' 3.14 ', 'float')).toEqual([3.14]);
  });

  it('trims date/datetime columns', () => {
    expect(addPivotValue([], ' 2024-01-01 ', 'date')).toEqual(['2024-01-01']);
  });

  it('treats whitespace-only as no-op for numeric columns', () => {
    expect(addPivotValue([2024], '   ', 'integer')).toEqual([2024]);
  });
});

describe('addCustomPivotAxisValue', () => {
  const candidates = [{ raw: 'Jan' }, { raw: 'Feb' }];

  it('materializes the implicit all selection before appending a custom value', () => {
    expect(addCustomPivotAxisValue([], [], 'Mar', candidates, 'text')).toEqual({
      values: ['Jan', 'Feb', 'Mar'],
      customValues: ['Mar'],
    });
  });

  it('appends to an explicit selection without re-adding unselected source values', () => {
    expect(addCustomPivotAxisValue(['Jan'], [], 'Mar', candidates, 'text')).toEqual({
      values: ['Jan', 'Mar'],
      customValues: ['Mar'],
    });
  });

  it('uses the selected field type and does not add a duplicate value', () => {
    expect(addCustomPivotAxisValue([], [], '3', [{ raw: '1' }, { raw: '2' }], 'integer')).toEqual({
      values: [1, 2, 3],
      customValues: [3],
    });
    expect(addCustomPivotAxisValue(['Feb'], [], 'Jan', candidates, 'text')).toEqual({
      values: ['Feb', 'Jan'],
      customValues: [],
    });
    expect(addCustomPivotAxisValue([], [], 'Jan', candidates, 'text')).toEqual({
      values: ['Jan'],
      customValues: [],
    });
  });
});

describe('removePivotCustomValue', () => {
  it('removes a custom value from both the selection and custom-value metadata', () => {
    expect(removePivotCustomValue(['Jan', 'Mar'], ['Mar'], 'Mar')).toEqual({
      values: ['Jan'],
      customValues: [],
    });
  });

  it('removes an inferred custom value after a DSL round-trip', () => {
    expect(removePivotCustomValue(['Jan', 'Mar'], [], 'Mar')).toEqual({
      values: ['Jan'],
      customValues: [],
    });
  });
});

describe('addPivotCandidate', () => {
  it('adds an empty string candidate from the column values', () => {
    expect(addPivotCandidate([], '', 'text')).toEqual(['']);
  });

  it('deduplicates an empty string candidate that is already present', () => {
    expect(addPivotCandidate([''], '', 'text')).toEqual(['']);
  });

  it('translates candidate values by field type', () => {
    expect(addPivotCandidate([], ' 2024 ', 'integer')).toEqual([2024]);
    expect(addPivotCandidate([], '2024', 'text')).toEqual(['2024']);
  });

  it('preserves existing values when adding a candidate', () => {
    expect(addPivotCandidate([2024], 'abc', 'integer')).toEqual([2024, 'abc']);
  });
});

describe('togglePivotAxisValue — explicit selection semantics', () => {
  it('starts an explicit selection without selecting values outside the search result', () => {
    expect(togglePivotAxisValue([], 'A', 'A', 'text')).toEqual(['A']);
  });

  it('adds and removes values in explicit mode', () => {
    expect(togglePivotAxisValue(['A'], 'B', 'B', 'text')).toEqual(['A', 'B']);
    expect(togglePivotAxisValue(['A', 'B'], 'B', 'B', 'text')).toEqual(['A']);
  });

  it('coerces a numeric selection by column type', () => {
    expect(togglePivotAxisValue([], '2024', '2024', 'integer')).toEqual([2024]);
  });

  it('returns to the default-all configuration after removing the final explicit value', () => {
    expect(togglePivotAxisValue(['A'], 'A', 'A', 'text')).toEqual([]);
  });
});

describe('togglePivotVisibleValues', () => {
  const candidates = [
    { display: 'Jan', raw: 'Jan' },
    { display: 'Feb', raw: 'Feb' },
    { display: 'Mar', raw: 'Mar' },
    { display: 'Apr', raw: 'Apr' },
  ];

  it('selects only matching search results from the default-all configuration', () => {
    expect(togglePivotVisibleValues([], candidates, new Set(['Feb', 'Mar']), 'text')).toEqual([
      'Feb',
      'Mar',
    ]);
  });

  it('selects every matching search result while retaining existing selections', () => {
    expect(togglePivotVisibleValues(['Jan'], candidates, new Set(['Feb', 'Mar']), 'text')).toEqual([
      'Jan',
      'Feb',
      'Mar',
    ]);
  });

  it('clears selected search results back to the default-all configuration', () => {
    expect(togglePivotVisibleValues(['Jan'], candidates, new Set(['Jan']), 'text')).toEqual([]);
  });

  it('keeps custom values explicit when selecting all visible results', () => {
    expect(
      togglePivotVisibleValues(
        ['Jan', 'custom'],
        [...candidates, { display: 'custom', raw: 'custom' }],
        new Set(['Feb', 'Mar', 'Apr']),
        'text'
      )
    ).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'custom']);
  });
});
