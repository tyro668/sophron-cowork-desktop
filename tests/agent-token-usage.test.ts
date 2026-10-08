import { describe, expect, it } from 'vitest';
import { normalizeTokenUsage } from '../src/main/agent/agent-runner-log-utils';

describe('session token usage', () => {
  it.each([
    { input: 1600, output: 200, expected: 1600 },
    { input: 700, output: 200, cacheRead: 1200, expected: 1900 },
    { input: 1200, output: 200, cacheRead: 1700, expected: 2900 },
    { input: 0, output: 200, cacheRead: 3000, expected: 3000 },
    { input: 100, output: 200, cacheRead: 2000, cacheWrite: 1000, expected: 3100 },
  ])(
    'counts the full prompt when SDK usage is $input uncached tokens',
    ({ expected, ...usage }) => {
      expect(normalizeTokenUsage({ ...usage, totalTokens: 99999 })).toEqual({
        input: expected,
        output: 200,
      });
    }
  );

  it('includes separately reported snake-case cache counters', () => {
    expect(
      normalizeTokenUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 300,
        cache_write_tokens: 50,
      })
    ).toEqual({ input: 450, output: 20 });
  });

  it('does not invent usage for missing or incomplete reports', () => {
    expect(normalizeTokenUsage(undefined)).toBeUndefined();
    expect(normalizeTokenUsage({})).toBeUndefined();
    expect(normalizeTokenUsage({ input: 100 })).toBeUndefined();
  });
});
