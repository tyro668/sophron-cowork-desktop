import { describe, expect, it } from 'vitest';
import { splitTopLevel, stripComment } from '../../src/shared/prep-dsl/syntax/scanner';

describe('scanner splitTopLevel', () => {
  it('splits multi-metric aggregate DSL with a backslash-escaped single quote', () => {
    expect(splitTopLevel("string_agg([name], 'it\\'s') as [names], count(*) as [rows]")).toEqual([
      "string_agg([name], 'it\\'s') as [names]",
      'count(*) as [rows]',
    ]);
  });

  it('splits multi-metric pivot DSL with a backslash-escaped single quote', () => {
    expect(splitTopLevel("string_agg([name], 'it\\'s') as [names], count(*) as [rows]")).toEqual([
      "string_agg([name], 'it\\'s') as [names]",
      'count(*) as [rows]',
    ]);
  });

  it('splits multi-metric DSL with a SQL escaped single quote', () => {
    expect(splitTopLevel("string_agg([name], 'it''s') as [names], count(*) as [rows]")).toEqual([
      "string_agg([name], 'it''s') as [names]",
      'count(*) as [rows]',
    ]);
  });

  it('ignores commas and parentheses inside a single-quoted string', () => {
    expect(splitTopLevel("string_agg([name], ',)') as [names], count(*) as [rows]")).toEqual([
      "string_agg([name], ',)') as [names]",
      'count(*) as [rows]',
    ]);
  });

  it('keeps field references with a hash intact', () => {
    expect(splitTopLevel('[`Order#`], [region]')).toEqual(['[`Order#`]', '[region]']);
  });

  it('does not split on an incomplete structure', () => {
    expect(splitTopLevel("fn([a], 'b")).toEqual(["fn([a], 'b"]);
  });
});

describe('scanner stripComment', () => {
  it('treats a hash inside a field reference as content, not a comment', () => {
    expect(stripComment('filter [`Order#`] is not null')).toBe('filter [`Order#`] is not null');
  });

  it('treats a hash inside a single-quoted string as content, not a comment', () => {
    expect(stripComment("filter [text] = 'a#b'")).toBe("filter [text] = 'a#b'");
  });

  it('strips a top-level comment after content', () => {
    expect(stripComment('filter [`Order#`] is not null # 排除空订单')).toBe(
      'filter [`Order#`] is not null '
    );
  });
});
