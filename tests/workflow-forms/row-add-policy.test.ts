import { describe, expect, it } from 'vitest';
import {
  AggregateConfigSchema,
  MAX_CALCULATION_COUNT,
  JoinConfigSchema,
  MAX_JOIN_CONDITION_COUNT,
  MAX_METRIC_COUNT,
  MAX_ON_COUNT,
  MAX_USING_COUNT,
  PivotConfigSchema,
} from '../../src/shared/operator-schemas';
import {
  canAppendRow,
  createStableRowId,
  ensureStableRowIds,
  insertRowAfter,
} from '../../src/renderer/components/workflow-forms/shared/rowListOperations';

describe('row operator add policy', () => {
  it('adds another blank row without inspecting existing row contents', () => {
    const firstBlank = { field: '' };
    const secondBlank = { field: '' };

    expect(insertRowAfter([firstBlank], 0, secondBlank)).toEqual([firstBlank, secondBlank]);
  });

  it('assigns a stable id before an existing row is edited', () => {
    const initial = ensureStableRowIds([{ alias: '45' }], () => 'metric-1');
    const edited = ensureStableRowIds(
      initial.map((metric) => ({ ...metric, alias: '4' })),
      () => 'metric-2'
    );

    expect(initial[0].id).toBe('metric-1');
    expect(edited[0].id).toBe('metric-1');
  });

  it('repairs missing and duplicate row ids', () => {
    let sequence = 0;
    const rows = ensureStableRowIds(
      [{ id: 'kept' }, { id: 'kept' }, {}],
      () => `generated-${++sequence}`
    );

    expect(rows.map((row) => row.id)).toEqual(['kept', 'generated-1', 'generated-2']);
    expect(createStableRowId()).toBeTruthy();
  });

  it('allows additions below a schema limit and rejects them at the limit', () => {
    expect(canAppendRow(MAX_METRIC_COUNT - 1, MAX_METRIC_COUNT)).toBe(true);
    expect(canAppendRow(MAX_METRIC_COUNT, MAX_METRIC_COUNT)).toBe(false);
    expect(canAppendRow(MAX_ON_COUNT, MAX_ON_COUNT)).toBe(false);
    expect(canAppendRow(MAX_USING_COUNT, MAX_USING_COUNT)).toBe(false);
    expect(canAppendRow(MAX_JOIN_CONDITION_COUNT, MAX_JOIN_CONDITION_COUNT)).toBe(false);
    expect(canAppendRow(MAX_CALCULATION_COUNT, MAX_CALCULATION_COUNT)).toBe(false);
  });

  it('keeps the exported limits aligned with Zod validation', () => {
    const aggregateMetric = { function: 'count', expression: '*', alias: 'count' } as const;
    const pivotMetric = { function: 'count', expression: '*' } as const;
    const pivotAxis = (index: number) => ({ field: `field_${index}`, values: [] });

    expect(
      AggregateConfigSchema.safeParse({
        metrics: Array.from({ length: MAX_METRIC_COUNT }, () => aggregateMetric),
      }).success
    ).toBe(true);
    expect(
      AggregateConfigSchema.safeParse({
        metrics: Array.from({ length: MAX_METRIC_COUNT + 1 }, () => aggregateMetric),
      }).success
    ).toBe(false);
    expect(
      PivotConfigSchema.safeParse({
        on: Array.from({ length: MAX_ON_COUNT }, (_, index) => pivotAxis(index)),
        using: Array.from({ length: MAX_USING_COUNT }, () => pivotMetric),
      }).success
    ).toBe(true);
    expect(
      PivotConfigSchema.safeParse({
        on: Array.from({ length: MAX_ON_COUNT + 1 }, (_, index) => pivotAxis(index)),
        using: [pivotMetric],
      }).success
    ).toBe(false);
    expect(
      PivotConfigSchema.safeParse({
        on: [pivotAxis(0)],
        using: Array.from({ length: MAX_USING_COUNT + 1 }, () => pivotMetric),
      }).success
    ).toBe(false);
  });

  it('does not require ordinary or ASOF join conditions to be complete before adding', () => {
    const blankCondition = { left: '', right: '' };

    expect(insertRowAfter([blankCondition], 0, { ...blankCondition })).toHaveLength(2);
  });

  it('enforces the join limit in Zod for ordinary and ASOF conditions', () => {
    const condition = { left: 'left.id', operator: '=', right: 'right.id' } as const;
    const asofCondition = { left: 'left.id', right: 'right.id' };
    expect(
      JoinConfigSchema.safeParse({
        joinType: 'inner',
        conditions: Array.from({ length: MAX_JOIN_CONDITION_COUNT }, () => condition),
      }).success
    ).toBe(true);
    expect(
      JoinConfigSchema.safeParse({
        joinType: 'inner',
        conditions: Array.from({ length: MAX_JOIN_CONDITION_COUNT + 1 }, () => condition),
      }).success
    ).toBe(false);
    expect(
      JoinConfigSchema.safeParse({
        joinType: 'asof',
        asof: {
          leftTime: 'left.time',
          rightTime: 'right.time',
          by: Array.from({ length: MAX_JOIN_CONDITION_COUNT }, () => asofCondition),
        },
      }).success
    ).toBe(true);
    expect(
      JoinConfigSchema.safeParse({
        joinType: 'asof',
        asof: {
          leftTime: 'left.time',
          rightTime: 'right.time',
          by: Array.from({ length: MAX_JOIN_CONDITION_COUNT + 1 }, () => asofCondition),
        },
      }).success
    ).toBe(false);
  });
});
