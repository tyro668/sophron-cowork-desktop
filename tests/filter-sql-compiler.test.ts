import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compileFilterConditionExpression } from '../src/main/data/operators/filter';

describe('filter SQL compiler', () => {
  describe('comparison operators', () => {
    it('compiles =, !=, <>, >, <, >=, <=', () => {
      expect(compileFilterConditionExpression('[a] = 1')).toBe('"a" = 1');
      expect(compileFilterConditionExpression('[a] != 1')).toBe('"a" != 1');
      expect(compileFilterConditionExpression('[a] <> 1')).toBe('"a" <> 1');
      expect(compileFilterConditionExpression('[a] > 1')).toBe('"a" > 1');
      expect(compileFilterConditionExpression('[a] < 1')).toBe('"a" < 1');
      expect(compileFilterConditionExpression('[a] >= 1')).toBe('"a" >= 1');
      expect(compileFilterConditionExpression('[a] <= 1')).toBe('"a" <= 1');
    });

    it('compares with string, number, boolean, null literals', () => {
      expect(compileFilterConditionExpression('[a] = "hello"')).toBe(`"a" = 'hello'`);
      expect(compileFilterConditionExpression('[a] = 42')).toBe('"a" = 42');
      expect(compileFilterConditionExpression('[a] = true')).toBe('"a" = TRUE');
      expect(compileFilterConditionExpression('[a] = false')).toBe('"a" = FALSE');
      expect(compileFilterConditionExpression('[a] = null')).toBe('"a" = NULL');
    });

    it('compares with decimal and negative numbers', () => {
      expect(compileFilterConditionExpression('[a] > 3.14')).toBe('"a" > 3.14');
      expect(compileFilterConditionExpression('[a] >= -5')).toBe('"a" >= -5');
      expect(compileFilterConditionExpression('[a] < -0.001')).toBe('"a" < -0.001');
    });
  });

  describe('logical operators', () => {
    it('compiles AND', () => {
      expect(compileFilterConditionExpression('[a] > 1 AND [b] < 2')).toBe('"a" > 1 AND "b" < 2');
      expect(compileFilterConditionExpression('[a] > 1 AND [b] < 2 AND [c] = 3')).toBe(
        '"a" > 1 AND "b" < 2 AND "c" = 3'
      );
    });

    it('compiles OR', () => {
      expect(compileFilterConditionExpression('[a] > 1 OR [b] < 2')).toBe('"a" > 1 OR "b" < 2');
      expect(compileFilterConditionExpression('[a] > 1 OR [b] < 2 OR [c] = 3')).toBe(
        '"a" > 1 OR "b" < 2 OR "c" = 3'
      );
    });

    it('respects AND-before-OR precedence', () => {
      expect(compileFilterConditionExpression('[a] > 1 AND [b] > 2 OR [c] > 3')).toBe(
        '"a" > 1 AND "b" > 2 OR "c" > 3'
      );
    });

    it('compiles NOT before expression', () => {
      expect(compileFilterConditionExpression('NOT [a] = 1')).toBe('NOT "a" = 1');
      expect(compileFilterConditionExpression('NOT [a] > 5 AND [b] < 10')).toBe(
        'NOT "a" > 5 AND "b" < 10'
      );
    });

    it('compiles NOT before parenthesized expression', () => {
      expect(compileFilterConditionExpression('NOT ([a] > 1 AND [b] < 2)')).toBe(
        'NOT ("a" > 1 AND "b" < 2)'
      );
      expect(compileFilterConditionExpression('NOT ([a] > 1 OR [b] < 2) AND [c] = 3')).toBe(
        'NOT ("a" > 1 OR "b" < 2) AND "c" = 3'
      );
    });
  });

  describe('special operators: matches, begin, end', () => {
    it('compiles matches to regexp_matches', () => {
      expect(compileFilterConditionExpression('[name] matches "^John"')).toBe(
        'regexp_matches(CAST("name" AS VARCHAR), CAST(\'^John\' AS VARCHAR))'
      );
    });

    it('compiles not matches', () => {
      expect(compileFilterConditionExpression('[name] not matches "\\d+"')).toBe(
        'NOT regexp_matches(CAST("name" AS VARCHAR), CAST(\'\\d+\' AS VARCHAR))'
      );
    });

    it('compiles begin to starts_with', () => {
      expect(compileFilterConditionExpression('[name] begin "Prefix"')).toBe(
        'starts_with(CAST("name" AS VARCHAR), CAST(\'Prefix\' AS VARCHAR))'
      );
    });

    it('compiles end to ends_with', () => {
      expect(compileFilterConditionExpression('[name] end "Suffix"')).toBe(
        'ends_with(CAST("name" AS VARCHAR), CAST(\'Suffix\' AS VARCHAR))'
      );
    });

    it('compiles NOT begin and NOT end', () => {
      expect(compileFilterConditionExpression('[name] not begin "X"')).toBe(
        'NOT starts_with(CAST("name" AS VARCHAR), CAST(\'X\' AS VARCHAR))'
      );
      expect(compileFilterConditionExpression('[name] not end "Y"')).toBe(
        'NOT ends_with(CAST("name" AS VARCHAR), CAST(\'Y\' AS VARCHAR))'
      );
    });

    it('compiles with field ref on right side', () => {
      expect(compileFilterConditionExpression('[a] matches [b]')).toBe(
        'regexp_matches(CAST("a" AS VARCHAR), CAST("b" AS VARCHAR))'
      );
    });

    it('combines with AND/OR', () => {
      expect(
        compileFilterConditionExpression('[a] matches "x" AND [b] begin "y" OR [c] end "z"')
      ).toBe(
        'regexp_matches(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))' +
          ' AND starts_with(CAST("b" AS VARCHAR), CAST(\'y\' AS VARCHAR))' +
          ' OR ends_with(CAST("c" AS VARCHAR), CAST(\'z\' AS VARCHAR))'
      );
    });

    it('handles NOT before parenthesized special expression', () => {
      expect(compileFilterConditionExpression('NOT ([a] matches "x" OR [b] begin "y")')).toBe(
        'NOT (regexp_matches(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))' +
          ' OR starts_with(CAST("b" AS VARCHAR), CAST(\'y\' AS VARCHAR)))'
      );
    });

    it('case-insensitive keywords', () => {
      expect(compileFilterConditionExpression('[a] MATCHES "x"')).toBe(
        'regexp_matches(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))'
      );
      expect(compileFilterConditionExpression('[a] BeGiN "x"')).toBe(
        'starts_with(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))'
      );
      expect(compileFilterConditionExpression('[a] EnD "x"')).toBe(
        'ends_with(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))'
      );
    });
  });

  describe('IN operator', () => {
    it('compiles IN with string list', () => {
      expect(compileFilterConditionExpression('[status] in ("A", "B", "C")')).toBe(
        `"status" IN ('A', 'B', 'C')`
      );
    });

    it('compiles IN with number list', () => {
      expect(compileFilterConditionExpression('[id] in (1, 2, 3)')).toBe(`"id" IN (1, 2, 3)`);
    });

    it('compiles IN with mixed types', () => {
      expect(compileFilterConditionExpression('[x] in (1, "two", null, true)')).toBe(
        `"x" IN (1, 'two', NULL, TRUE)`
      );
    });

    it('compiles NOT IN', () => {
      expect(compileFilterConditionExpression('[x] not in (1, 2)')).toBe(`"x" NOT IN (1, 2)`);
    });

    it('compiles NOT before IN (parenthesized)', () => {
      expect(compileFilterConditionExpression('NOT [x] in (1, 2)')).toBe(`NOT "x" IN (1, 2)`);
    });

    it('compiles IN combined with other conditions', () => {
      expect(
        compileFilterConditionExpression('[status] in ("PAID", "SHIPPED") and [revenue] > 0')
      ).toBe(`"status" IN ('PAID', 'SHIPPED') AND "revenue" > 0`);
    });
  });

  describe('arithmetic expressions', () => {
    it('compiles addition and subtraction', () => {
      expect(compileFilterConditionExpression('[a] + [b] > 0')).toBe('"a" + "b" > 0');
      expect(compileFilterConditionExpression('[a] - [b] > 0')).toBe('"a" - "b" > 0');
    });

    it('compiles multiplication and division', () => {
      expect(compileFilterConditionExpression('[a] * [b] > 0')).toBe('"a" * "b" > 0');
      expect(compileFilterConditionExpression('[a] / [b] > 0')).toBe('"a" / "b" > 0');
    });

    it('respects operator precedence (*/ before +-)', () => {
      expect(compileFilterConditionExpression('[a] + [b] * [c] > 0')).toBe('"a" + "b" * "c" > 0');
      expect(compileFilterConditionExpression('[a] * [b] + [c] > 0')).toBe('"a" * "b" + "c" > 0');
    });

    it('compiles unary minus', () => {
      expect(compileFilterConditionExpression('[a] > -5')).toBe('"a" > -5');
      expect(compileFilterConditionExpression('-[a] > 0')).toBe('-"a" > 0');
    });

    it('compiles chained arithmetic', () => {
      expect(compileFilterConditionExpression('[a] + [b] - [c] * [d] / [e] > 0')).toBe(
        '"a" + "b" - "c" * "d" / "e" > 0'
      );
    });
  });

  describe('parentheses', () => {
    it('groups simple expression', () => {
      expect(compileFilterConditionExpression('([a] > 1)')).toBe('("a" > 1)');
    });

    it('groups complex expression', () => {
      expect(compileFilterConditionExpression('([a] > 1 AND [b] < 2) OR [c] = 3')).toBe(
        '("a" > 1 AND "b" < 2) OR "c" = 3'
      );
    });

    it('nests parentheses', () => {
      expect(compileFilterConditionExpression('(([a] > 1) OR ([b] < 2)) AND [c] = 3')).toBe(
        '(("a" > 1) OR ("b" < 2)) AND "c" = 3'
      );
    });

    it('groups with special operators inside', () => {
      expect(
        compileFilterConditionExpression('([a] matches "x" OR [b] begin "y") AND [c] > 5')
      ).toBe(
        '(regexp_matches(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))' +
          ' OR starts_with(CAST("b" AS VARCHAR), CAST(\'y\' AS VARCHAR)))' +
          ' AND "c" > 5'
      );
    });
  });

  describe('SQL keyword passthrough (Ident)', () => {
    it('passes BETWEEN ... AND ...', () => {
      expect(compileFilterConditionExpression('[x] BETWEEN 1 AND 10')).toBe('"x" BETWEEN 1 AND 10');
      expect(compileFilterConditionExpression('[x] BETWEEN "a" AND "z"')).toBe(
        `"x" BETWEEN 'a' AND 'z'`
      );
    });

    it('passes LIKE', () => {
      expect(compileFilterConditionExpression('[name] LIKE "%test%"')).toBe(`"name" LIKE '%test%'`);
      expect(compileFilterConditionExpression('[name] LIKE "prefix_%"')).toBe(
        `"name" LIKE 'prefix_%'`
      );
    });

    it('passes NOT LIKE', () => {
      expect(compileFilterConditionExpression('[name] NOT LIKE "%test%"')).toBe(
        `"name" NOT LIKE '%test%'`
      );
    });

    it('passes IS NULL', () => {
      expect(compileFilterConditionExpression('[x] IS NULL')).toBe('"x" IS NULL');
    });

    it('passes IS NOT NULL', () => {
      expect(compileFilterConditionExpression('[x] IS NOT NULL')).toBe('"x" IS NOT NULL');
    });
  });

  describe('string escaping', () => {
    it('escapes single quotes in string literals', () => {
      expect(compileFilterConditionExpression('[a] = "it\'s"')).toBe(`"a" = 'it''s'`);
    });

    it('preserves backslash sequences in strings', () => {
      expect(compileFilterConditionExpression('[a] = "C:\\\\path"')).toBe(`"a" = 'C:\\\\path'`);
    });

    it('handles escaped quotes inside DSL strings', () => {
      expect(compileFilterConditionExpression('[a] = "say \\"hello\\""')).toBe(
        `"a" = 'say "hello"'`
      );
    });
  });

  describe('field references', () => {
    it('handles standard field names', () => {
      expect(compileFilterConditionExpression('[field] > 0')).toBe('"field" > 0');
    });

    it('handles underscore in field names', () => {
      expect(compileFilterConditionExpression('[my_field] > 0')).toBe('"my_field" > 0');
    });

    it('handles backtick-quoted field names with spaces', () => {
      expect(compileFilterConditionExpression('[`field name`] > 0')).toBe('"field name" > 0');
    });

    it('handles field ref on both sides', () => {
      expect(compileFilterConditionExpression('[a] = [b]')).toBe('"a" = "b"');
    });
  });

  describe('edge cases', () => {
    it('empty condition returns TRUE', () => {
      expect(compileFilterConditionExpression('')).toBe('TRUE');
    });

    it('whitespace-only condition returns TRUE', () => {
      expect(compileFilterConditionExpression('   ')).toBe('TRUE');
      expect(compileFilterConditionExpression('\t\n')).toBe('TRUE');
    });

    it('single field ref resolves to just a quoted identifier', () => {
      expect(compileFilterConditionExpression('[x]')).toBe('"x"');
    });

    it('handles extra whitespace around operators', () => {
      expect(compileFilterConditionExpression('[a]  >  5')).toBe('"a" > 5');
      expect(compileFilterConditionExpression('[a]\t>\t5')).toBe('"a" > 5');
    });

    it('handles NOT IN where IN is followed by parenthesized list', () => {
      expect(compileFilterConditionExpression('[a] NOT IN (1, 2)')).toBe('"a" NOT IN (1, 2)');
    });

    it('just TRUE as condition', () => {
      expect(compileFilterConditionExpression('TRUE')).toBe('TRUE');
    });

    it('just FALSE as condition', () => {
      expect(compileFilterConditionExpression('FALSE')).toBe('FALSE');
    });

    it('just NULL as condition', () => {
      expect(compileFilterConditionExpression('NULL')).toBe('NULL');
    });
  });

  describe('NOT edge cases', () => {
    it('handles double negation', () => {
      expect(compileFilterConditionExpression('NOT NOT [a] = 1')).toBe('NOT NOT "a" = 1');
    });

    it('handles NOT with special operator after AND', () => {
      expect(compileFilterConditionExpression('[a] matches "x" AND NOT [b] begin "y"')).toBe(
        'regexp_matches(CAST("a" AS VARCHAR), CAST(\'x\' AS VARCHAR))' +
          ' AND NOT starts_with(CAST("b" AS VARCHAR), CAST(\'y\' AS VARCHAR))'
      );
    });

    it('handles NOT with IN after AND', () => {
      expect(compileFilterConditionExpression('[a] > 1 AND NOT [b] in (1, 2)')).toBe(
        '"a" > 1 AND NOT "b" IN (1, 2)'
      );
    });

    it('handles NOT with compound AND/OR', () => {
      expect(compileFilterConditionExpression('NOT [a] > 1 OR [b] begin "x" AND NOT [c] < 5')).toBe(
        'NOT "a" > 1 OR starts_with(CAST("b" AS VARCHAR), CAST(\'x\' AS VARCHAR))' +
          ' AND NOT "c" < 5'
      );
    });
  });

  describe('IN operator edge cases', () => {
    it('compiles IN with no space before paren', () => {
      expect(compileFilterConditionExpression('[a] in(1,2,3)')).toBe('"a" IN (1, 2, 3)');
      expect(compileFilterConditionExpression('[a] not in(1,2)')).toBe('"a" NOT IN (1, 2)');
    });

    it('compiles IN with single item', () => {
      expect(compileFilterConditionExpression('[a] in (1)')).toBe('"a" IN (1)');
    });

    it('compiles IN with expressions as items', () => {
      expect(compileFilterConditionExpression('[a] in ([x] + 1, [y] * 2)')).toBe(
        '"a" IN ("x" + 1, "y" * 2)'
      );
    });

    it('compiles multiple IN with OR', () => {
      expect(compileFilterConditionExpression('[a] in (1, 2) OR [b] in (3, 4)')).toBe(
        '"a" IN (1, 2) OR "b" IN (3, 4)'
      );
    });

    it('compiles case-insensitive IN keyword', () => {
      expect(compileFilterConditionExpression('[a] In (1, 2)')).toBe('"a" IN (1, 2)');
      expect(compileFilterConditionExpression('[a] IN (1, 2)')).toBe('"a" IN (1, 2)');
    });

    it('compiles NOT IN with additional AND condition', () => {
      expect(compileFilterConditionExpression('[a] NOT IN (1, 2) AND [b] > 0')).toBe(
        '"a" NOT IN (1, 2) AND "b" > 0'
      );
    });
  });

  describe('Ident passthrough edge cases', () => {
    it('passes BETWEEN with field ref bounds', () => {
      expect(compileFilterConditionExpression('[a] BETWEEN [x] AND [y]')).toBe(
        '"a" BETWEEN "x" AND "y"'
      );
    });

    it('passes NOT ILIKE (non-standard operator via Ident)', () => {
      expect(compileFilterConditionExpression('[a] NOT ILIKE "test"')).toBe(`"a" NOT ILIKE 'test'`);
    });

    it('passes IS NULL with AND', () => {
      expect(compileFilterConditionExpression('[a] IS NULL AND [b] > 0')).toBe(
        '"a" IS NULL AND "b" > 0'
      );
    });

    it('passes IS NOT NULL with AND', () => {
      expect(compileFilterConditionExpression('[a] IS NOT NULL AND [b] > 0')).toBe(
        '"a" IS NOT NULL AND "b" > 0'
      );
    });

    it('passes IS DISTINCT FROM (multi-word SQL operator)', () => {
      expect(compileFilterConditionExpression('[a] IS DISTINCT FROM [b]')).toBe(
        '"a" IS DISTINCT FROM "b"'
      );
    });
  });

  describe('strings containing keyword text', () => {
    it('handles "not" inside a string literal', () => {
      expect(compileFilterConditionExpression('[a] matches "not test"')).toBe(
        'regexp_matches(CAST("a" AS VARCHAR), CAST(\'not test\' AS VARCHAR))'
      );
    });

    it('handles "and" inside a string literal', () => {
      expect(compileFilterConditionExpression('[a] = "and"')).toBe(`"a" = 'and'`);
    });

    it('handles "or" inside a string literal', () => {
      expect(compileFilterConditionExpression('[a] = "or"')).toBe(`"a" = 'or'`);
    });

    it('handles "in" inside a string literal', () => {
      expect(compileFilterConditionExpression('[a] = "in"')).toBe(`"a" = 'in'`);
    });
  });

  describe('expression order', () => {
    it('handles literal on left side', () => {
      expect(compileFilterConditionExpression('0 = [a]')).toBe('0 = "a"');
    });

    it('handles boolean as standalone comparison operand', () => {
      expect(compileFilterConditionExpression('true AND [a] > 1')).toBe('TRUE AND "a" > 1');
    });

    it('handles unary NOT inside term', () => {
      expect(compileFilterConditionExpression('[a] = NOT 5')).toBe('"a" = NOT 5');
    });
  });

  describe('numeric edge cases', () => {
    it('handles scientific notation', () => {
      expect(compileFilterConditionExpression('[a] > 1e5')).toBe('"a" > 1e5');
      expect(compileFilterConditionExpression('[a] > 1.5e-3')).toBe('"a" > 1.5e-3');
      expect(compileFilterConditionExpression('[a] > .5e-3')).toBe('"a" > .5e-3');
    });

    it('handles number starting with dot', () => {
      expect(compileFilterConditionExpression('[a] > .5')).toBe('"a" > .5');
    });

    it('treats leading zeros in strings correctly', () => {
      expect(compileFilterConditionExpression('[a] = "0123"')).toBe(`"a" = '0123'`);
    });
  });

  describe('field references edge cases', () => {
    it('handles field name with numbers', () => {
      expect(compileFilterConditionExpression('[field1] > 0')).toBe('"field1" > 0');
    });

    it('handles field name with hyphen', () => {
      expect(compileFilterConditionExpression('[field-name] > 0')).toBe('"field-name" > 0');
    });

    it('handles backtick field with dots', () => {
      expect(compileFilterConditionExpression('[`my.field`] > 0')).toBe('"my.field" > 0');
    });
  });

  describe('input validation errors', () => {
    it('throws on unterminated string literal', () => {
      expect(() => compileFilterConditionExpression('[a] = "hello')).toThrow(
        'Unterminated string literal'
      );
    });

    it('throws on unterminated field reference', () => {
      expect(() => compileFilterConditionExpression('[a > 1')).toThrow(
        'Unterminated field reference'
      );
    });

    it('throws on unterminated backtick field reference', () => {
      expect(() => compileFilterConditionExpression('[`name > 1')).toThrow(
        'Unterminated backtick field reference'
      );
    });

    it('throws on multiple dots in number', () => {
      expect(() => compileFilterConditionExpression('[a] > 1.2.3')).toThrow(
        'Invalid number literal'
      );
    });

    it('throws on empty IN list', () => {
      expect(() => compileFilterConditionExpression('[a] in ()')).toThrow(
        'IN list must not be empty'
      );
    });

    it('throws on unknown characters', () => {
      expect(() => compileFilterConditionExpression('[a] @ [b]')).toThrow(
        "Unexpected character '@'"
      );
      expect(() => compileFilterConditionExpression('[a] + #')).toThrow("Unexpected character '#'");
    });

    it('throws on dot after scientific notation', () => {
      expect(() => compileFilterConditionExpression('[a] > 1e5.5')).toThrow(
        'Invalid number literal'
      );
    });

    it('throws on number ending with e/sign with no digits', () => {
      expect(() => compileFilterConditionExpression('[a] > 1e+')).toThrow('Invalid number literal');
    });

    it('throws on standalone keyword at expression start', () => {
      expect(() => compileFilterConditionExpression('AND [a] > 1')).toThrow('Unexpected token');
    });
  });

  describe('integration: strategy pattern references', () => {
    it('compiles filter via strategy.ts -> filter.ts, not inline in data-task-store', () => {
      const storeSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/main/data/data-task-store.ts'),
        'utf8'
      );

      expect(storeSource).toContain('COMPILE_STRATEGIES');
      expect(storeSource).not.toContain('WHERE ${compileFilterConditionExpression(');
      expect(storeSource).not.toContain('WHERE ${compileScalarExpression(');

      const strategySource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/main/data/operators/strategy.ts'),
        'utf8'
      );
      expect(strategySource).toContain('compileFilterConditionExpression');
      expect(strategySource).not.toContain('compileScalarExpression');

      const filterSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/main/data/operators/filter.ts'),
        'utf8'
      );
      expect(filterSource).toContain('regexp_matches(');
    });
  });
});
