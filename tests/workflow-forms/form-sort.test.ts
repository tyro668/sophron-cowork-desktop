import { describe, expect, it } from 'vitest';
import { exportStep, parseStep } from '../helpers/jflow-step';

describe('FormSort — copy semantics at config level', () => {
  it('a copied sort key inherits direction and nulls while leaving the field empty', () => {
    const source = { field: 'revenue', direction: 'desc', nulls: 'last' };
    const copied = { field: '', direction: source.direction, nulls: source.nulls };
    expect(copied).toEqual({ field: '', direction: 'desc', nulls: 'last' });
  });

  it('an incomplete copied key is filtered out of DSL export without crashing', () => {
    const dsl = exportStep({
      id: 'test',
      type: 'sort',
      config: {
        orderBy: [
          { field: 'revenue', direction: 'desc', nulls: 'last' },
          { field: '', direction: 'desc', nulls: 'last' },
        ],
      },
    });
    expect(dsl).toBe('sort -[revenue] nulls: last');
  });

  it('a completed copied key round-trips through DSL', () => {
    const dsl = exportStep({
      id: 'test',
      type: 'sort',
      config: {
        orderBy: [
          { field: 'region', direction: 'asc', nulls: 'first' },
          { field: 'revenue', direction: 'desc', nulls: 'last' },
        ],
      },
    });
    const parsed = parseStep(dsl, 'sort');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const keys = parsed.operator!.config.orderBy as Array<Record<string, string>>;
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({ field: 'region', direction: 'asc', nulls: 'first' });
  });
});
