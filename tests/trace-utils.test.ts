import { describe, expect, it } from 'vitest';
import {
  buildTraceError,
  buildTraceOutputPreview,
  normalizeTraceUsage,
  sanitizeTraceInput,
} from '../src/main/claude/trace-utils';

describe('trace utils', () => {
  it('redacts credentials and bounds large values before persistence', () => {
    const input = sanitizeTraceInput({
      apiKey: 'secret-key',
      nested: { access_token: 'secret-token', query: 'select 1' },
      payload: 'x'.repeat(5_000),
    });

    expect(input.apiKey).toBe('[REDACTED]');
    expect((input.nested as Record<string, unknown>).access_token).toBe('[REDACTED]');
    expect((input.nested as Record<string, unknown>).query).toBe('select 1');
    expect(String(input.payload).length).toBeLessThan(5_000);
  });

  it('records whether the persisted output is a truncated preview', () => {
    const result = buildTraceOutputPreview('abcdef', 4);

    expect(result).toEqual({ preview: 'abcd…', length: 6, truncated: true });
  });

  it('redacts common credentials from output previews', () => {
    const output = 'Authorization: Bearer abc.def.ghi\npassword=super-secret';
    const result = buildTraceOutputPreview(output);

    expect(result.preview).not.toContain('abc.def.ghi');
    expect(result.preview).not.toContain('super-secret');
    expect(result.length).toBe(output.length);
  });

  it('classifies common failures and extracts an error code', () => {
    expect(buildTraceError('[INVALID_INPUT] required field name is missing')).toMatchObject({
      stage: 'validation',
      code: 'INVALID_INPUT',
    });
    expect(buildTraceError('request timed out')).toMatchObject({
      stage: 'timeout',
      retriable: true,
    });
    expect(buildTraceError('User denied permission')).toMatchObject({
      stage: 'permission',
    });
  });

  it('normalizes complete SDK usage for evaluation aggregation', () => {
    expect(
      normalizeTraceUsage({
        input: 100,
        output: 20,
        cacheRead: 30,
        cacheWrite: 5,
        totalTokens: 155,
        cost: { total: 0.0123 },
      })
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      totalTokens: 155,
      costTotal: 0.0123,
    });
  });

  it('supports snake-case usage and calculates a missing total', () => {
    expect(
      normalizeTraceUsage({
        input_tokens: 10,
        output_tokens: 4,
        cache_read_tokens: 2,
        cache_write_tokens: 1,
      })
    ).toMatchObject({
      totalTokens: 17,
      costTotal: 0,
    });
  });
});
