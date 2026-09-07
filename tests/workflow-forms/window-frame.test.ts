import { describe, expect, it } from 'vitest';
import {
  isOffsetFrameBound,
  parseWindowFrameBound,
  validateWindowFrame,
  validateWindowFrameOrder,
} from '../../src/shared/calculate-field/window-frame';

describe('window frame parsing', () => {
  it('parses unbounded and current row bounds', () => {
    expect(parseWindowFrameBound('unbounded preceding')).toEqual({
      position: 'unbounded-preceding',
    });
    expect(parseWindowFrameBound('current row')).toEqual({ position: 'current-row' });
    expect(parseWindowFrameBound('unbounded following')).toEqual({
      position: 'unbounded-following',
    });
  });

  it('parses numeric and interval offset bounds', () => {
    expect(parseWindowFrameBound('2 preceding')).toEqual({
      position: 'preceding',
      offset: 2,
    });
    expect(parseWindowFrameBound('3 following')).toEqual({
      position: 'following',
      offset: 3,
    });
    expect(parseWindowFrameBound('interval 7 day preceding')).toEqual({
      position: 'preceding',
      offset: 7,
      unit: 'day',
    });
    expect(parseWindowFrameBound('INTERVAL 2 MONTH FOLLOWING')).toEqual({
      position: 'following',
      offset: 2,
      unit: 'month',
    });
  });

  it('rejects an invalid bound', () => {
    expect(() => parseWindowFrameBound(' preceding')).toThrow(/invalid window frame bound/i);
    expect(() => parseWindowFrameBound('garbage')).toThrow(/invalid window frame bound/i);
  });

  it('detects offset frame bounds', () => {
    expect(isOffsetFrameBound(parseWindowFrameBound('2 preceding'))).toBe(true);
    expect(isOffsetFrameBound(parseWindowFrameBound('current row'))).toBe(false);
    expect(isOffsetFrameBound(parseWindowFrameBound('unbounded preceding'))).toBe(false);
  });
});

describe('window frame order validation', () => {
  it('accepts bounds in chronological order', () => {
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('unbounded preceding'),
        parseWindowFrameBound('current row')
      )
    ).toBe(true);
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('5 preceding'),
        parseWindowFrameBound('1 preceding')
      )
    ).toBe(true);
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('current row'),
        parseWindowFrameBound('unbounded following')
      )
    ).toBe(true);
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('1 following'),
        parseWindowFrameBound('3 following')
      )
    ).toBe(true);
  });

  it('rejects bounds whose start is after the end', () => {
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('1 following'),
        parseWindowFrameBound('current row')
      )
    ).toBe(false);
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('10 preceding'),
        parseWindowFrameBound('20 preceding')
      )
    ).toBe(false);
    expect(
      validateWindowFrameOrder(
        parseWindowFrameBound('unbounded following'),
        parseWindowFrameBound('unbounded preceding')
      )
    ).toBe(false);
  });
});

describe('window frame full validation', () => {
  it('accepts a valid rows frame', () => {
    expect(() =>
      validateWindowFrame(
        'moving_avg',
        {
          type: 'rows',
          start: '1 preceding',
          end: 'current row',
        },
        1
      )
    ).not.toThrow();
  });

  it('rejects a range offset frame without a single order field', () => {
    expect(() =>
      validateWindowFrame(
        'moving_avg',
        {
          type: 'range',
          start: 'interval 7 day preceding',
          end: 'current row',
        },
        2
      )
    ).toThrow(/exactly one order field/);
  });

  it('rejects a frame whose start is after its end', () => {
    expect(() =>
      validateWindowFrame(
        'moving_sum',
        {
          type: 'rows',
          start: '1 following',
          end: 'current row',
        },
        1
      )
    ).toThrow(/start must not be after its end/);
  });
});
