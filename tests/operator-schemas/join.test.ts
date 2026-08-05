import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JoinConfigSchema } from '../../src/shared/operator-schemas';
import { parseDuration, normalizeDuration } from '../../src/shared/operator-schemas/join';

describe('JoinConfigSchema', () => {
  it('parses valid config with conditions', () => {
    const result = JoinConfigSchema.parse({
      joinType: 'inner',
      conditions: [{ left: '[order_id]', operator: '=', right: '[id]' }],
      rightAlias: 'orders',
    });
    expect(result.joinType).toBe('inner');
    expect(result.conditions).toHaveLength(1);
    expect(result.rightAlias).toBe('orders');
  });

  it('applies defaults for cross join (no conditions required)', () => {
    const result = JoinConfigSchema.parse({ joinType: 'cross' });
    expect(result.joinType).toBe('cross');
    expect(result.keep).toEqual([]);
  });

  it('rejects non-cross join without conditions', () => {
    expect(() => JoinConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('parses asof join config', () => {
    const result = JoinConfigSchema.parse({
      joinType: 'asof',
      asof: {
        leftTime: '[ts]',
        rightTime: '[time]',
        operator: '<=',
        tolerance: '5m',
        by: [{ left: '[symbol]', right: '[sym]' }],
      },
    });
    expect(result.joinType).toBe('asof');
    expect(result.asof).toBeDefined();
  });

  it('rejects conditions with wrong type', () => {
    expect(() => JoinConfigSchema.parse({ conditions: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects semi join with keep config', () => {
    expect(() =>
      JoinConfigSchema.parse({
        joinType: 'semi',
        conditions: [{ left: '[id]', operator: '=', right: '[id]' }],
        keep: [{ side: 'left', wildcard: true }],
      })
    ).toThrow(/does not support keep/);
  });

  it('rejects anti join with conflict config', () => {
    expect(() =>
      JoinConfigSchema.parse({
        joinType: 'anti',
        conditions: [{ left: '[id]', operator: '=', right: '[id]' }],
        conflict: { strategy: 'suffix' },
      })
    ).toThrow(/does not support conflict/);
  });

  it('rejects unsupported join condition operators', () => {
    expect(() =>
      JoinConfigSchema.parse({
        joinType: 'inner',
        conditions: [{ left: '[order_id]', operator: '!=', right: '[id]' }],
      })
    ).toThrow(z.ZodError);
  });

  it('accepts valid asof tolerance formats', () => {
    for (const tolerance of ['0s', '5m', '1h30m', '500ms', '2d12h']) {
      expect(() =>
        JoinConfigSchema.parse({
          joinType: 'asof',
          asof: { leftTime: '[ts]', rightTime: '[time]', operator: '<=', tolerance },
        })
      ).not.toThrow();
    }
  });

  it('rejects invalid asof tolerance', () => {
    for (const tolerance of ['abc', '5', '5x', '1h m', '0.']) {
      expect(() =>
        JoinConfigSchema.parse({
          joinType: 'asof',
          asof: { leftTime: '[ts]', rightTime: '[time]', operator: '<=', tolerance },
        })
      ).toThrow(/Invalid ASOF tolerance/);
    }
  });

  it('rejects right_prefix strategy with an empty prefix', () => {
    expect(() =>
      JoinConfigSchema.parse({
        joinType: 'inner',
        conditions: [{ left: '[order_id]', operator: '=', right: '[id]' }],
        conflict: { strategy: 'right_prefix', rightPrefix: '' },
      })
    ).toThrow(/non-empty prefix/);
    expect(() =>
      JoinConfigSchema.parse({
        joinType: 'inner',
        conditions: [{ left: '[order_id]', operator: '=', right: '[id]' }],
        conflict: { strategy: 'right_prefix' },
      })
    ).toThrow(/non-empty prefix/);
  });
});

describe('parseDuration', () => {
  it('parses single unit format', () => {
    expect(parseDuration('2d')).toEqual({ d: 2, h: 0, m: 0, s: 0, ms: 0 });
    expect(parseDuration('1h')).toEqual({ d: 0, h: 1, m: 0, s: 0, ms: 0 });
    expect(parseDuration('30m')).toEqual({ d: 0, h: 0, m: 30, s: 0, ms: 0 });
    expect(parseDuration('90s')).toEqual({ d: 0, h: 0, m: 1, s: 30, ms: 0 });
    expect(parseDuration('500ms')).toEqual({ d: 0, h: 0, m: 0, s: 0, ms: 500 });
  });

  it('parses compound format', () => {
    expect(parseDuration('1h30m')).toEqual({ d: 0, h: 1, m: 30, s: 0, ms: 0 });
    expect(parseDuration('1h30m30s')).toEqual({ d: 0, h: 1, m: 30, s: 30, ms: 0 });
    expect(parseDuration('2d12h')).toEqual({ d: 2, h: 12, m: 0, s: 0, ms: 0 });
  });

  it('parses plain millisecond number', () => {
    expect(parseDuration('3600000')).toEqual({ d: 0, h: 1, m: 0, s: 0, ms: 0 });
    expect(parseDuration('5400000')).toEqual({ d: 0, h: 1, m: 30, s: 0, ms: 0 });
    expect(parseDuration('3630000')).toEqual({ d: 0, h: 1, m: 0, s: 30, ms: 0 });
  });

  it('returns zero for empty string', () => {
    expect(parseDuration('')).toEqual({ d: 0, h: 0, m: 0, s: 0, ms: 0 });
  });

  it('returns zero for invalid input', () => {
    expect(parseDuration('abc')).toEqual({ d: 0, h: 0, m: 0, s: 0, ms: 0 });
  });
});

describe('normalizeDuration', () => {
  it('converts to lowest non-zero unit: h+m → m (minutes)', () => {
    expect(normalizeDuration('1h30m')).toBe('90m');
  });

  it('converts to lowest non-zero unit: h+m+s0ms → m (minutes, s is zero)', () => {
    expect(normalizeDuration('1h30m0s')).toBe('90m');
  });

  it('converts to lowest non-zero unit: d+h → h (hours)', () => {
    expect(normalizeDuration('1d6h')).toBe('30h');
  });

  it('preserves single unit', () => {
    expect(normalizeDuration('30m')).toBe('30m');
    expect(normalizeDuration('2h')).toBe('2h');
    expect(normalizeDuration('5s')).toBe('5s');
  });

  it('handles mixed units with ms', () => {
    expect(normalizeDuration('1s500ms')).toBe('1500ms');
  });

  it('returns empty for zero', () => {
    expect(normalizeDuration('0s')).toBe('');
    expect(normalizeDuration('0h0m')).toBe('');
  });

  it('round-trips through parseDuration', () => {
    const input = '7200s';
    const parsed = parseDuration(input);
    const normal = normalizeDuration(input);
    expect(parsed).toEqual({ d: 0, h: 2, m: 0, s: 0, ms: 0 });
    expect(normal).toBe('2h');
  });
});
