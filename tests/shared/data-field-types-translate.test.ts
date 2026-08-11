import { describe, expect, it } from 'vitest';
import { translatePivotInput } from '../../src/shared/data-field-types';

describe('translatePivotInput', () => {
  it('converts safe integer strings to numbers for integer columns', () => {
    expect(translatePivotInput('2024', 'integer')).toBe(2024);
    expect(translatePivotInput('-5', 'integer')).toBe(-5);
  });

  it('keeps integers beyond safe range as strings to avoid precision loss', () => {
    expect(translatePivotInput('9007199254740993', 'integer')).toBe('9007199254740993');
  });

  it('keeps non-integer numeric strings as strings for integer columns', () => {
    expect(translatePivotInput('3.14', 'integer')).toBe('3.14');
  });

  it('converts finite numeric strings to numbers for float columns', () => {
    expect(translatePivotInput('3.14', 'float')).toBe(3.14);
    expect(translatePivotInput('-5', 'float')).toBe(-5);
    expect(translatePivotInput('1e3', 'float')).toBe(1000);
  });

  it('keeps non-numeric strings as strings for numeric columns', () => {
    expect(translatePivotInput('abc', 'integer')).toBe('abc');
    expect(translatePivotInput('', 'float')).toBe('');
  });

  it('keeps all decimal values as strings regardless of magnitude', () => {
    expect(translatePivotInput('-5', 'decimal')).toBe('-5');
    expect(translatePivotInput('2024', 'decimal')).toBe('2024');
    expect(translatePivotInput('3.14', 'decimal')).toBe('3.14');
    expect(translatePivotInput('123456789012345678.123456', 'decimal')).toBe(
      '123456789012345678.123456'
    );
  });

  it('converts true/false to booleans for boolean columns', () => {
    expect(translatePivotInput('true', 'boolean')).toBe(true);
    expect(translatePivotInput('FALSE', 'boolean')).toBe(false);
  });

  it('keeps non-boolean strings as strings for boolean columns', () => {
    expect(translatePivotInput('yes', 'boolean')).toBe('yes');
  });

  it('keeps strings as strings for text columns', () => {
    expect(translatePivotInput('2024', 'text')).toBe('2024');
    expect(translatePivotInput('abc', 'text')).toBe('abc');
  });

  it('preserves leading and trailing whitespace for text columns', () => {
    expect(translatePivotInput(' A', 'text')).toBe(' A');
    expect(translatePivotInput('A ', 'text')).toBe('A ');
    expect(translatePivotInput('   ', 'text')).toBe('   ');
    expect(translatePivotInput('', 'text')).toBe('');
  });

  it('trims date and datetime columns', () => {
    expect(translatePivotInput(' 2024-01-01 ', 'date')).toBe('2024-01-01');
    expect(translatePivotInput(' 2024-01-01 10:30:00 ', 'datetime')).toBe('2024-01-01 10:30:00');
  });

  it('trims before converting numeric columns', () => {
    expect(translatePivotInput(' 2024 ', 'integer')).toBe(2024);
    expect(translatePivotInput(' 3.14 ', 'float')).toBe(3.14);
    expect(translatePivotInput(' -5 ', 'decimal')).toBe('-5');
  });

  it('trims before converting boolean columns', () => {
    expect(translatePivotInput(' true ', 'boolean')).toBe(true);
    expect(translatePivotInput(' yes ', 'boolean')).toBe('yes');
  });

  it('defaults to string when no column type is provided', () => {
    expect(translatePivotInput('2024')).toBe('2024');
    expect(translatePivotInput('abc')).toBe('abc');
    expect(translatePivotInput(' A')).toBe(' A');
  });
});
