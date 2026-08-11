import { describe, expect, it } from 'vitest';
import {
  formatMissingValueListInput,
  parseMissingValueInput,
  parseMissingValueListInput,
  validateMissingValueInput,
  validateMissingValueListInput,
} from '../src/shared/missing-value-values';

describe('missing-value graphical input parsing', () => {
  it('converts numeric input using the selected field type', () => {
    expect(parseMissingValueInput('0', 'integer')).toBe(0);
    expect(parseMissingValueInput('12.5', 'float')).toBe(12.5);
  });

  it('converts boolean input case-insensitively', () => {
    expect(parseMissingValueInput('TRUE', 'boolean')).toBe(true);
    expect(parseMissingValueInput('false', 'boolean')).toBe(false);
  });

  it('keeps text and temporal input as strings', () => {
    expect(parseMissingValueInput('001', 'text')).toBe('001');
    expect(parseMissingValueInput('2026-07-31', 'date')).toBe('2026-07-31');
  });

  it('parses typed lists and preserves an explicitly quoted empty string', () => {
    expect(parseMissingValueListInput('0, 1.5', 'float')).toEqual([0, 1.5]);
    expect(parseMissingValueListInput('"", "N/A"', 'text')).toEqual(['', 'N/A']);
  });

  it('formats values without losing their literal types', () => {
    expect(formatMissingValueListInput([0, true, '', 'N/A'])).toBe('0, true, "", "N/A"');
  });

  it('validates numeric, boolean, and empty list input before execution', () => {
    expect(validateMissingValueInput('abc', 'float')).toBe('number');
    expect(validateMissingValueInput('yes', 'boolean')).toBe('boolean');
    expect(validateMissingValueListInput('', 'text')).toBe('required');
    expect(validateMissingValueListInput('0, 1.5', 'float')).toBeNull();
  });
});
