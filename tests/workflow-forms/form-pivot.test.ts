import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import {
  addPivotCandidate,
  addPivotValue,
  removePivotValue,
} from '../../src/renderer/components/workflow-forms/FormPivot';

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

  it('round-trips a complete pivot config without an alias', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: [{ field: 'category' }], using: [{ function: 'count', expression: '*' }] },
    });
    expect(dsl).toBe('pivot on [category] using count(*)');
    const r = ok({
      on: [{ field: 'category' }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(r.config.on).toEqual([{ field: 'category', values: [] }]);
    expect((r.config.using as Array<Record<string, unknown>>)[0].function).toBe('count');
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
      'pivot on [year] in (2024, 2025), [quarter] in ("Q1", "Q2"), [channel] using sum([amount])'
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

describe('removePivotValue', () => {
  it('removes by index and preserves remaining types', () => {
    const values: Array<string | number | null> = [null, 2024, '2024'];
    expect(removePivotValue(values, 0)).toEqual([2024, '2024']);
    expect(removePivotValue(values, 2)).toEqual([null, 2024]);
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
