import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { compileFilterConditionExpression } from '../../src/main/data/operators/filter';
import { getOperatorConfigIssue } from '../../src/shared/operator-validation';
import FormFilter from '../../src/renderer/components/workflow-forms/FormFilter';
import { incompleteConfigMessageKey } from '../../src/renderer/components/data-view/workflow-config-guards';
import type { DataWorkflowNode } from '../../src/renderer/types';
import {
  buildFilterCondition,
  formatFilterConditionValue,
  type FilterConditionRow,
  buildFilterConditionTree,
  parseConditionTree,
  resetNodeIdCounter,
  nextNodeId,
  isLeaf,
  isBranch,
  addLeafToBranch,
  removeNodeFromBranch,
  updateLeafInBranch,
  updateBranchInTree,
  toggleBranchConnectiveInTree,
  wrapItemsInGroup,
  unwrapGroup,
  createEmptyLeaf,
  splitInValues,
  joinInValues,
  type FilterConditionLeaf,
  type FilterConditionBranch,
} from '../../src/shared/filter-condition';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function roundTrip(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'filter', config });
  const parsed = parsePrepOperatorDsl(dsl, 'filter');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  return { dsl, parsed, errors };
}

function ok(config: Record<string, unknown>) {
  const { dsl, parsed, errors } = roundTrip(config);
  expect(errors, `DSL errors for filter: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return parsed.operator!;
}

function leaf(field: string, op: string, val1: string, val2 = ''): FilterConditionLeaf {
  return { kind: 'leaf', id: nextNodeId(), field, op, val1, val2 };
}

// ── Existing flat tests ───────────────────────────────────────────────

describe('FormFilter — config ↔ DSL (flat, backward-compat)', () => {
  it('simple comparison', () => {
    const r = ok({ condition: '[revenue] > 0' });
    expect(r.config.condition).toBe('[revenue] > 0');
  });

  it('string equality', () => {
    const r = ok({ condition: '[region] = "EU"' });
    expect(r.config.condition).toContain('EU');
  });

  it('not equal', () => {
    const r = ok({ condition: '[status] != "TEST"' });
    expect(r.config.condition).toContain('!=');
  });

  it('between two values', () => {
    const r = ok({ condition: '[price] between 10 and 100' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('and');
  });

  it('between with dates', () => {
    const r = ok({ condition: '[order_date] between 2024-01-01 and 2024-12-31' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('2024-01-01');
  });

  it('AND compound', () => {
    const r = ok({ condition: '[revenue] > 0 and [region] = "EU"' });
    expect(r.config.condition).toContain(' and ');
  });

  it('OR compound', () => {
    const r = ok({ condition: '[region] = "EU" or [region] = "US"' });
    expect(r.config.condition).toContain(' or ');
  });

  it('mixed AND + OR', () => {
    const r = ok({ condition: '[revenue] > 0 and [region] = "EU" or [status] = "VIP"' });
    expect(r.config.condition).toContain(' and ');
    expect(r.config.condition).toContain(' or ');
  });

  it('between + AND compound', () => {
    const r = ok({ condition: '[price] between 10 and 100 and [region] = "EU"' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });

  it('multiple between with AND', () => {
    const r = ok({ condition: '[a] between 1 and 10 and [b] between 20 and 30' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });
});

describe('FormFilter — parseCondition logic', () => {
  function parseSingleBetween(expr: string) {
    const m = expr.match(/^\s*\[([^\]]+)\]\s+between\s+(.+?)\s+(?:and|%%PH%%)\s+(.+?)\s*$/i);
    if (!m) return null;
    return { field: m[1], val1: m[2], val2: m[3] };
  }

  function splitConditionAnd(condition: string) {
    const placeholders: string[] = [];
    const protected_ = condition.replace(
      /\[([^\]]+)\]\s+between\s+(.+?)\s+and\s+(.+?)(?=\s*(?:$|and\s|or\s))/gi,
      (_m, field, v1, v2) => {
        const idx = placeholders.length;
        placeholders.push(`[${field}] between ${v1} %%PH%% ${v2}`);
        return `__BETWEEN_${idx}__`;
      }
    );
    const tokens = protected_.split(/(\s+(?:and|or)\s+)/i);
    return tokens;
  }

  it('simple between is not split', () => {
    const tokens = splitConditionAnd('[date_col] between 2024-01-01 and 2024-12-31');
    expect(tokens.filter((t, i) => i % 2 === 0 && t.trim())).toHaveLength(1);
  });

  it('between with AND compound splits correctly', () => {
    const tokens = splitConditionAnd('[price] between 10 and 100 and [region] = "EU"');
    const exprs = tokens.filter((_, i) => i % 2 === 0 && tokens[i].trim());
    expect(exprs.length).toBeGreaterThanOrEqual(1);
  });

  it('parses between back via placeholder', () => {
    const r = parseSingleBetween('[date_col] between 2024-01-01 %%PH%% 2024-12-31');
    expect(r).not.toBeNull();
    expect(r!.field).toBe('date_col');
    expect(r!.val2).toBe('2024-12-31');
  });
});

describe('FormFilter — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { condition: '[revenue] > 0' },
      { condition: '[a] between 1 and 10 and [b] = "x"' },
      { condition: '[x] = "A" or [y] = "B"' },
      { condition: '[date] between 2024-01-01 and 2024-12-31' },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'filter', config });
      const parsed = parsePrepOperatorDsl(dsl1, 'filter');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'filter',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});

// ── Type-aware value formatting ───────────────────────────────────────

describe('FormFilter — type-aware value formatting', () => {
  function build(
    rows: Array<{
      field: string;
      op: string;
      val1: string;
      val2?: string;
      connective?: string;
      colType?: string;
    }>
  ) {
    const columnTypes = Object.fromEntries(
      rows.flatMap((row) => (row.colType ? [[row.field, row.colType]] : []))
    );
    return buildFilterCondition(
      rows.map(
        (row): FilterConditionRow => ({
          field: row.field,
          op: row.op,
          val1: row.val1,
          val2: row.val2 ?? '',
          connective: row.connective === 'or' ? 'or' : 'and',
        })
      ),
      columnTypes
    );
  }

  it('numeric: numbers unquoted', () => {
    expect(build([{ field: 'a', op: '>', val1: '100', colType: 'float' }])).toBe('[a] > 100');
  });
  it('numeric: strings quoted', () => {
    expect(build([{ field: 'a', op: '=', val1: 'ABC', colType: 'float' }])).toBe('[a] = "ABC"');
  });
  it('text: numbers quoted', () => {
    expect(build([{ field: 'a', op: '=', val1: '123', colType: 'text' }])).toBe('[a] = "123"');
  });
  it('boolean: true/false unquoted', () => {
    expect(build([{ field: 'a', op: '=', val1: 'true', colType: 'boolean' }])).toBe('[a] = true');
  });
  it('field ref preserved', () => {
    expect(build([{ field: 'a', op: '=', val1: '[b]', colType: 'text' }])).toBe('[a] = [b]');
  });
  it('quotes null content as a string value', () => {
    expect(build([{ field: 'x', op: '=', val1: 'null', colType: 'text' }])).toBe('[x] = "null"');
  });
  it('uses is null for the SQL NULL filter', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'x', op: 'is null', val1: '', val2: '' }],
    };
    expect(buildFilterConditionTree(tree, { x: 'text' })).toBe('[x] is null');
  });
  it('between with numeric types', () => {
    expect(
      build([{ field: 'p', op: 'between', val1: '10', val2: '100', colType: 'decimal' }])
    ).toBe('[p] between 10 and 100');
  });
  it('unknown type: number unquoted', () => {
    expect(build([{ field: 'x', op: '=', val1: '42' }])).toBe('[x] = 42');
  });
  it('unknown type: string quoted', () => {
    expect(build([{ field: 'x', op: '=', val1: 'hi' }])).toBe('[x] = "hi"');
  });
  it('already-quoted unwrapped then re-quoted', () => {
    expect(build([{ field: 'x', op: '=', val1: '"hello"', colType: 'text' }])).toBe(
      '[x] = "hello"'
    );
  });
  it('quoteDslString escapes internal quotes', () => {
    expect(formatFilterConditionValue('he said "hello"', 'text')).toBe('"he said \\"hello\\""');
  });
  it('whitespace-only values are skipped', () => {
    expect(build([{ field: 'x', op: '=', val1: '   ', colType: 'text' }])).toBeUndefined();
  });
  it('between is skipped when the second value is blank', () => {
    expect(
      build([{ field: 'x', op: 'between', val1: '1', val2: '   ', colType: 'integer' }])
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  New tests for tree-based filter condition logic
// ═══════════════════════════════════════════════════════════════════════

// ── Tree parse + build ────────────────────────────────────────────────

describe('FilterCondition — tree parse + build round-trip', () => {
  function roundTripTree(dsl: string): string {
    resetNodeIdCounter();
    const tree = parseConditionTree(dsl);
    return buildFilterConditionTree(tree) ?? '';
  }

  it('single condition', () => {
    expect(roundTripTree('[a] = 1')).toBe('[a] = 1');
  });

  it('AND compound (flat)', () => {
    expect(roundTripTree('[a] = 1 and [b] = 2')).toBe('[a] = 1 and [b] = 2');
  });

  it('OR compound (flat)', () => {
    expect(roundTripTree('[a] = 1 or [b] = 2')).toBe('[a] = 1 or [b] = 2');
  });

  it('nested group with parentheses', () => {
    expect(roundTripTree('[a] = 1 and ([b] = 2 or [c] = 3)')).toBe(
      '[a] = 1 and ([b] = 2 or [c] = 3)'
    );
  });

  it('AND has higher precedence than OR', () => {
    // Input without parens: a=1 and b=2 or c=3
    // AND binds tighter → (a=1 and b=2) or c=3
    expect(roundTripTree('[a] = 1 and [b] = 2 or [c] = 3')).toBe(
      '([a] = 1 and [b] = 2) or [c] = 3'
    );
  });

  it('double-nested groups', () => {
    const dsl = '[a] = 1 and (([b] = 2 or [c] = 3) and [d] = 4)';
    expect(roundTripTree(dsl)).toBe(dsl);
  });

  it('between operator in nested group', () => {
    expect(roundTripTree('[a] between 1 and 10 and ([b] = 2 or [c] = 3)')).toBe(
      '[a] between 1 and 10 and ([b] = 2 or [c] = 3)'
    );
  });

  it('in operator', () => {
    expect(roundTripTree('[a] in ("x", "y", "z")')).toBe('[a] in ("x", "y", "z")');
  });

  it('not in operator', () => {
    expect(roundTripTree('[a] not in (1, 2, 3)')).toBe('[a] not in (1, 2, 3)');
  });

  it('string operators: like, not like', () => {
    expect(roundTripTree('[name] like "test"')).toBe('[name] like "test"');
    expect(roundTripTree('[name] not like "test"')).toBe('[name] not like "test"');
  });

  it('string operators: matches, not matches', () => {
    expect(roundTripTree('[name] matches "pattern"')).toBe('[name] matches "pattern"');
    expect(roundTripTree('[name] not matches "pattern"')).toBe('[name] not matches "pattern"');
  });

  it('string operators: begin, end', () => {
    expect(roundTripTree('[name] begin "pre"')).toBe('[name] begin "pre"');
    expect(roundTripTree('[name] end "suf"')).toBe('[name] end "suf"');
  });

  it('string operators in nested groups', () => {
    const dsl = '([name] like "A" or [name] like "B") and [status] = "ok"';
    expect(roundTripTree(dsl)).toBe(dsl);
  });

  it('rejects a bare identifier that is not true/false/null as the right-hand value', () => {
    expect(() => roundTripTree('[a] = Beijing')).toThrow();
    expect(() => roundTripTree('[a] like abc')).toThrow();
    expect(() => roundTripTree('[a] in (Beijing, Berlin)')).toThrow();
  });

  it('round-trips a single field reference as the right-hand value', () => {
    expect(roundTripTree('[a] = [b]')).toBe('[a] = [b]');
    expect(roundTripTree('[a] in ([b])')).toBe('[a] in ([b])');
    expect(roundTripTree('[a] like [b]')).toBe('[a] like [b]');
    expect(roundTripTree('[a] between [b] and [c]')).toBe('[a] between [b] and [c]');
  });

  it('accepts quoted strings and bare booleans/null as the right-hand value', () => {
    expect(roundTripTree('[a] = "Beijing"')).toBe('[a] = "Beijing"');
    expect(roundTripTree('[a] = true')).toBe('[a] = true');
    expect(roundTripTree('[a] = null')).toBe('[a] is null');
    expect(roundTripTree('[a] in ("Beijing", "Berlin")')).toBe('[a] in ("Beijing", "Berlin")');
  });

  it('empty condition returns empty string', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('');
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });

  it('field names with hyphens', () => {
    expect(roundTripTree('[Sub-Category] = "Accessories"')).toBe('[Sub-Category] = "Accessories"');
  });

  it('field names with spaces', () => {
    // "2024" is a numeric literal for unknown column type, output bare
    expect(roundTripTree('[Order Date] = 2024')).toBe('[Order Date] = 2024');
  });

  it('quoted values survive round-trip', () => {
    expect(roundTripTree('[region] = "EU"')).toBe('[region] = "EU"');
  });

  it('in operator with quoted values', () => {
    expect(roundTripTree('[region] in ("EU", "US", "CN")')).toBe('[region] in ("EU", "US", "CN")');
  });
});

// ── Compact operator syntax (no whitespace between operator and value) ─

describe('FilterCondition — compact operator syntax', () => {
  function roundTripTree(dsl: string): string {
    resetNodeIdCounter();
    const tree = parseConditionTree(dsl);
    return buildFilterConditionTree(tree) ?? '';
  }

  it('parses =FALSE without space (no silent drop of the first condition)', () => {
    expect(roundTripTree('[是否续购] =FALSE')).toBe('[是否续购] = FALSE');
  });

  it('keeps the first condition of the reported compound expression', () => {
    const dsl =
      '([是否续购] =FALSE  or [商品ID] != "SP00010") and [商品ID] not in ("SP0001", "SP0003", "SP0005")';
    const out = roundTripTree(dsl);
    expect(out).toContain('[是否续购] = FALSE');
    expect(out).toContain('[商品ID] != "SP00010"');
    expect(out).toContain('[商品ID] not in ("SP0001", "SP0003", "SP0005")');
  });

  it('parses compact comparison operators', () => {
    expect(roundTripTree('[a] >5')).toBe('[a] > 5');
    expect(roundTripTree('[a] <3')).toBe('[a] < 3');
    expect(roundTripTree('[a] >=10')).toBe('[a] >= 10');
    expect(roundTripTree('[a] <=20')).toBe('[a] <= 20');
    expect(roundTripTree('[a] !=7')).toBe('[a] != 7');
  });

  it('parses compact not in list', () => {
    expect(roundTripTree('[a] not in("x","y")')).toBe('[a] not in ("x", "y")');
  });

  it('parses negative numeric values (tokenizer splits -5 into - and 5)', () => {
    expect(roundTripTree('[a] = -5')).toBe('[a] = -5');
    expect(roundTripTree('[a] > -10')).toBe('[a] > -10');
    expect(roundTripTree('[a] <= -20')).toBe('[a] <= -20');
  });

  it('parses negative values in between', () => {
    expect(roundTripTree('[a] between -10 and 10')).toBe('[a] between -10 and 10');
    expect(roundTripTree('[a] between -100 and -1')).toBe('[a] between -100 and -1');
  });

  it('parses negative values inside in lists', () => {
    expect(roundTripTree('[a] in (-1, 0, 1)')).toBe('[a] in (-1, 0, 1)');
    expect(roundTripTree('[a] not in (-5)')).toBe('[a] not in (-5)');
  });

  it('round-trips IN with a comma inside a quoted value losslessly', () => {
    const dsl = '[city] in ("New York, NY", "Paris")';
    const tree = parseConditionTree(dsl);
    const leaf = tree.items[0] as FilterConditionLeaf;

    // UI array: authoritative structured values, unquoted.
    const uiValues = leaf.values ?? splitInValues(leaf.val1);
    expect(uiValues).toEqual(['New York, NY', 'Paris']);

    // UI → DSL (graphical round-trip).
    const rebuilt = buildFilterConditionTree(tree) ?? '';
    expect(rebuilt).toBe('[city] in ("New York, NY", "Paris")');

    // DSL → SQL (execution layer) keeps the element intact.
    expect(compileFilterConditionExpression(rebuilt)).toBe(
      "`\"city\" IN ('New York, NY', 'Paris')`".replace(/`/g, '')
    );
  });

  it('parses is null / is not null unary operators', () => {
    expect(roundTripTree('[phone] is null')).toBe('[phone] is null');
    expect(roundTripTree('[phone] is not null')).toBe('[phone] is not null');
  });

  it('normalizes = null to the is null unary operator', () => {
    expect(roundTripTree('[phone] = null')).toBe('[phone] is null');
    expect(roundTripTree('[phone] != null')).toBe('[phone] is not null');
  });

  it('keeps a quoted "null" string as a value, not SQL NULL', () => {
    expect(roundTripTree('[code] = "null"')).toBe('[code] = "null"');
    expect(roundTripTree('[code] != "null"')).toBe('[code] != "null"');
  });

  it('keeps a quoted "null" inside an IN list as a string', () => {
    expect(roundTripTree('[code] in ("null", "normal")')).toBe('[code] in ("null", "normal")');
  });
});

// ── Tree parse edge cases ─────────────────────────────────────────────

describe('FilterCondition — tree parse edge cases', () => {
  it('parseConditionTree returns empty branch for undefined', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree(undefined);
    expect(isBranch(tree)).toBe(true);
    expect(tree.items).toHaveLength(0);
  });

  it('parseConditionTree returns empty branch for whitespace', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('   ');
    expect(isBranch(tree)).toBe(true);
    expect(tree.items).toHaveLength(0);
  });

  it('parseConditionTree handles values with escaped quotes', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('[msg] = "he said \\"hi\\""');
    expect(tree.items).toHaveLength(1);
    const item = tree.items[0];
    expect(isLeaf(item)).toBe(true);
    if (isLeaf(item)) {
      expect(item.field).toBe('msg');
      expect(item.op).toBe('=');
      // val1 preserves the raw DSL value including escape sequences
      expect(item.val1).toContain('hi');
    }
  });

  it('parseConditionTree detects OR as dominant connective (lower precedence)', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('[a] = 1 or [b] = 2');
    expect(tree.connective).toBe('or');
  });

  it('parseConditionTree defaults to AND when only AND present', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('[a] = 1 and [b] = 2');
    expect(tree.connective).toBe('and');
  });

  it('parseConditionTree rejects a leaf with trailing content after IN close', () => {
    resetNodeIdCounter();
    expect(() => parseConditionTree('[a] in ("x") trailing')).toThrow(
      /Invalid filter condition segment/
    );
  });

  it.each(['[a] in ()', '[a] in (,1)', '[a] in (1,)', '[a] in (1,,2)', '[a] in (1 2)'])(
    'parseConditionTree rejects malformed IN list: %s',
    (dsl) => {
      resetNodeIdCounter();
      expect(() => parseConditionTree(dsl)).toThrow(/Invalid filter condition segment/);
    }
  );

  it.each(['[a] = 1 and ()', '[a] = 1 and ( )', '()'])(
    'parseConditionTree rejects an empty parenthesized group: %s',
    (dsl) => {
      resetNodeIdCounter();
      expect(() => parseConditionTree(dsl)).toThrow(/Invalid filter condition segment/);
    }
  );

  it.each(['[a] = 1 and (garbage)', '([b] = )', '(garbage)'])(
    'parseConditionTree rejects a parenthesized group that cannot parse: %s',
    (dsl) => {
      resetNodeIdCounter();
      expect(() => parseConditionTree(dsl)).toThrow(/Invalid filter condition segment/);
    }
  );
});

// ── Tree mutation helpers ─────────────────────────────────────────────

describe('FilterCondition — tree mutation helpers', () => {
  it('addLeafToBranch appends after given index', () => {
    resetNodeIdCounter();
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [leaf('a', '=', '1'), leaf('b', '=', '2')],
    };
    const next = addLeafToBranch(b, 0); // add after first item
    expect(next.items).toHaveLength(3);
    expect(next.items[1].id).not.toBe(next.items[0].id);
  });

  it('removeNodeFromBranch removes leaf by id', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const l2 = leaf('b', '=', '2');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [l1, l2],
    };
    const next = removeNodeFromBranch(b, l1.id);
    expect(next.items).toHaveLength(1);
    expect(isLeaf(next.items[0]) && next.items[0].id).toBe(l2.id);
  });

  it('removeNodeFromBranch removes nested branch', () => {
    resetNodeIdCounter();
    const inner: FilterConditionBranch = {
      kind: 'branch',
      id: 'inner',
      connective: 'or',
      items: [leaf('b', '=', '2')],
    };
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [leaf('a', '=', '1'), inner],
    };
    const next = removeNodeFromBranch(b, inner.id);
    expect(next.items).toHaveLength(1);
  });

  it('updateLeafInBranch patches leaf fields', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [l1],
    };
    const next = updateLeafInBranch(b, l1.id, { op: '>', val1: '10' });
    const updated = next.items[0];
    expect(isLeaf(updated)).toBe(true);
    if (isLeaf(updated)) {
      expect(updated.op).toBe('>');
      expect(updated.val1).toBe('10');
    }
  });

  it('updateBranchInTree updates a nested branch without changing its siblings', () => {
    const sibling = leaf('a', '=', '1');
    const nested: FilterConditionBranch = {
      kind: 'branch',
      id: 'nested',
      connective: 'and',
      items: [leaf('b', '=', '2')],
    };
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [sibling, nested],
    };

    const next = updateBranchInTree(root, nested.id, (branch) => ({
      ...branch,
      items: [...branch.items, leaf('c', '=', '3')],
    }));

    expect(next.items[0]).toBe(sibling);
    expect(isBranch(next.items[1]) && next.items[1].items).toHaveLength(2);
  });

  it('toggleBranchConnectiveInTree toggles only the requested nested branch', () => {
    const nested: FilterConditionBranch = {
      kind: 'branch',
      id: 'nested',
      connective: 'and',
      items: [leaf('a', '=', '1')],
    };
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [nested],
    };

    const next = toggleBranchConnectiveInTree(root, nested.id);

    expect(next.connective).toBe('and');
    expect(isBranch(next.items[0]) && next.items[0].connective).toBe('or');
  });

  it('wrapItemsInGroup wraps two adjacent leaves into a group', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const l2 = leaf('b', '=', '2');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [l1, l2, leaf('c', '=', '3')],
    };
    const next = wrapItemsInGroup(b, [l1.id, l2.id], 'or');
    expect(next).not.toBeNull();
    expect(next!.items).toHaveLength(2); // group + c
    expect(isBranch(next!.items[0])).toBe(true);
    if (isBranch(next!.items[0])) {
      expect(next!.items[0].connective).toBe('or');
      expect(next!.items[0].items).toHaveLength(2);
    }
  });

  it('wrapItemsInGroup returns null for single item', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [l1, leaf('b', '=', '2')],
    };
    expect(wrapItemsInGroup(b, [l1.id], 'and')).toBeNull();
  });

  it('unwrapGroup moves children to parent', () => {
    resetNodeIdCounter();
    const inner: FilterConditionBranch = {
      kind: 'branch',
      id: 'inner',
      connective: 'or',
      items: [leaf('b', '=', '2'), leaf('c', '=', '3')],
    };
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [leaf('a', '=', '1'), inner],
    };
    const next = unwrapGroup(b, 'inner');
    expect(next.items).toHaveLength(3);
  });

  it('wrapItemsInGroup preserves item order', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const l2 = leaf('b', '=', '2');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'b1',
      connective: 'and',
      items: [l1, l2],
    };
    const result = wrapItemsInGroup(b, [l1.id, l2.id], 'or');
    expect(result).not.toBeNull();
    if (isBranch(result!.items[0])) {
      expect(result!.items[0].items[0].id).toBe(l1.id);
      expect(result!.items[0].items[1].id).toBe(l2.id);
    }
  });
});

// ── In/not-in value splitting ─────────────────────────────────────────

describe('FilterCondition — splitInValues / joinInValues', () => {
  it('splits comma-separated values', () => {
    expect(splitInValues('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('handles single value', () => {
    expect(splitInValues('hello')).toEqual(['hello']);
  });

  it('handles empty string', () => {
    expect(splitInValues('')).toEqual([]);
  });

  it('preserves commas inside quoted values', () => {
    expect(splitInValues('"New York, NY", Paris')).toEqual(['New York, NY', 'Paris']);
  });

  it('preserves quotes and backslashes inside values', () => {
    expect(splitInValues('"a\\"b", "c\'d"')).toEqual(['a"b', "c'd"]);
    expect(splitInValues('"a\\\\b", c')).toEqual(['a\\b', 'c']);
  });

  it('preserves empty-string values', () => {
    expect(splitInValues('"", normal')).toEqual(['', 'normal']);
  });

  it('preserves null/boolean/numeric-looking values', () => {
    expect(splitInValues('null, true, 00123')).toEqual(['null', 'true', '00123']);
  });

  it('joins values with comma+space', () => {
    expect(joinInValues(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('quotes values containing commas or quotes when joining', () => {
    expect(joinInValues(['New York, NY', 'Paris'])).toBe('"New York, NY", Paris');
    expect(joinInValues(['a"b', "c'd"])).toBe('"a\\"b", "c\'d"');
  });

  it('quotes empty-string values when joining', () => {
    expect(joinInValues(['', 'normal'])).toBe('"", normal');
  });

  it('round-trips value lists losslessly through split→join', () => {
    for (const values of [
      ['New York, NY', 'Paris'],
      ['a"b', "c'd"],
      ['a\\b', 'c'],
      ['', 'normal'],
      ['null', 'true', '00123'],
    ]) {
      expect(splitInValues(joinInValues(values))).toEqual(values);
    }
  });

  it('round-trip split→join', () => {
    const original = 'x, y, z';
    expect(joinInValues(splitInValues(original))).toBe(original);
  });
});

// ── Tree build edge cases ─────────────────────────────────────────────

describe('FilterCondition — tree build edge cases', () => {
  it('skips leaf with empty field', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: '', op: '=', val1: '1', val2: '' }],
    };
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });

  it('skips leaf with empty val1 (non-between)', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'a', op: '=', val1: '', val2: '' }],
    };
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });

  it('skips between leaf with empty val2', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'a', op: 'between', val1: '1', val2: '' }],
    };
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });

  it('skips in leaf with empty val1', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'a', op: 'in', val1: '', val2: '' }],
    };
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });

  it('builds between with proper type-aware values', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'p', op: 'between', val1: '10', val2: '100' }],
    };
    expect(buildFilterConditionTree(tree, { p: 'float' })).toBe('[p] between 10 and 100');
  });

  it('builds in with type-aware values', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'x', op: 'in', val1: '1, 2, 3', val2: '' }],
    };
    expect(buildFilterConditionTree(tree, { x: 'integer' })).toBe('[x] in (1, 2, 3)');
  });

  it('quotes a leading-zero text value that looks numeric', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'code', op: '=', val1: '00123', val2: '' }],
    };
    expect(buildFilterConditionTree(tree, { code: 'text' })).toBe('[code] = "00123"');
  });

  it('quotes a numeric-looking value on a text column but not on a numeric column', () => {
    resetNodeIdCounter();
    const textTree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'a', op: '=', val1: '123', val2: '' }],
    };
    expect(buildFilterConditionTree(textTree, { a: 'text' })).toBe('[a] = "123"');
    const numTree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [{ kind: 'leaf', id: 'l1', field: 'a', op: '=', val1: '123', val2: '' }],
    };
    expect(buildFilterConditionTree(numTree, { a: 'integer' })).toBe('[a] = 123');
  });

  it('builds empty branch as undefined', () => {
    resetNodeIdCounter();
    const tree: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [],
    };
    expect(buildFilterConditionTree(tree)).toBeUndefined();
  });
});

// ── createEmptyLeaf ────────────────────────────────────────────────────

describe('FilterCondition — createEmptyLeaf', () => {
  it('creates leaf with default operator', () => {
    resetNodeIdCounter();
    const l = createEmptyLeaf();
    expect(l.kind).toBe('leaf');
    expect(l.op).toBe('=');
    expect(l.field).toBe('');
  });

  it('generates unique ids', () => {
    resetNodeIdCounter();
    const a = createEmptyLeaf();
    const b = createEmptyLeaf();
    expect(a.id).not.toBe(b.id);
  });
});

// ── addAfterAndGroup with connective parameter ──────────────────────────

describe('FilterCondition — addAfterAndGroup with connective', () => {
  it('creates AND group when connective is "and"', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'or',
      items: [l1],
    };
    const withNew = addLeafToBranch(b, 0);
    const newLeafId = withNew.items[1].id;
    const result = wrapItemsInGroup(withNew, [l1.id, newLeafId], 'and');
    expect(result).not.toBeNull();
    expect(isBranch(result!.items[0])).toBe(true);
    if (isBranch(result!.items[0])) {
      expect(result!.items[0].connective).toBe('and');
    }
  });

  it('creates OR group when connective is "or"', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [l1],
    };
    const withNew = addLeafToBranch(b, 0);
    const newLeafId = withNew.items[1].id;
    const result = wrapItemsInGroup(withNew, [l1.id, newLeafId], 'or');
    expect(result).not.toBeNull();
    expect(isBranch(result!.items[0])).toBe(true);
    if (isBranch(result!.items[0])) {
      expect(result!.items[0].connective).toBe('or');
    }
  });

  it('same connective stays flat (no group created)', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const b: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [l1],
    };
    const withNew = addLeafToBranch(b, 0);
    expect(withNew.items).toHaveLength(2);
    expect(withNew.items.every((item) => isLeaf(item))).toBe(true);
  });
});

// ── addWithConnective logical equivalence ──────────────────────────────

describe('FilterCondition — addWithConnective logical equivalence', () => {
  it('AND + AND = flat AND', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [l1],
    };
    const result = addLeafToBranch(root, 0);
    expect(result.items).toHaveLength(2);
    expect(result.connective).toBe('and');
    expect(result.items.every((item) => isLeaf(item))).toBe(true);
  });

  it('OR + OR = flat OR', () => {
    resetNodeIdCounter();
    const l1 = leaf('x', '>', '0');
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'or',
      items: [l1],
    };
    const result = addLeafToBranch(root, 0);
    expect(result.items).toHaveLength(2);
    expect(result.connective).toBe('or');
    expect(result.items.every((item) => isLeaf(item))).toBe(true);
  });

  it('AND parent + OR child wraps into OR group', () => {
    resetNodeIdCounter();
    const l1 = leaf('a', '=', '1');
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'and',
      items: [l1],
    };
    const withNew = addLeafToBranch(root, 0);
    const newLeafId = withNew.items[1].id;
    const wrapped = wrapItemsInGroup(withNew, [l1.id, newLeafId], 'or');
    expect(wrapped).not.toBeNull();
    expect(wrapped!.items).toHaveLength(1);
    expect(isBranch(wrapped!.items[0])).toBe(true);
    if (isBranch(wrapped!.items[0])) {
      expect(wrapped!.items[0].connective).toBe('or');
      expect(wrapped!.items[0].items).toHaveLength(2);
    }
  });

  it('OR parent + AND child wraps into AND group', () => {
    resetNodeIdCounter();
    const l1 = leaf('b', '>', '10');
    const root: FilterConditionBranch = {
      kind: 'branch',
      id: 'root',
      connective: 'or',
      items: [l1],
    };
    const withNew = addLeafToBranch(root, 0);
    const newLeafId = withNew.items[1].id;
    const wrapped = wrapItemsInGroup(withNew, [l1.id, newLeafId], 'and');
    expect(wrapped).not.toBeNull();
    expect(isBranch(wrapped!.items[0])).toBe(true);
    if (isBranch(wrapped!.items[0])) {
      expect(wrapped!.items[0].connective).toBe('and');
    }
  });

  it('A AND B AND C round-trips flat (no redundant parens)', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('[a] = 1 and [b] = 2 and [c] = 3');
    const dsl = buildFilterConditionTree(tree);
    expect(dsl).toBe('[a] = 1 and [b] = 2 and [c] = 3');
  });

  it('A OR B OR C round-trips flat', () => {
    resetNodeIdCounter();
    const tree = parseConditionTree('[a] = 1 or [b] = 2 or [c] = 3');
    const dsl = buildFilterConditionTree(tree);
    expect(dsl).toBe('[a] = 1 or [b] = 2 or [c] = 3');
  });
});

// ── Source inspection of FormFilter.tsx UI structure ────────────────────

const formFilterSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/workflow-forms/FormFilter.tsx'),
  'utf8'
);

describe('FormFilter — UI source inspection', () => {
  it('renders parser failures while keeping the graphical add action available', () => {
    const node: DataWorkflowNode = {
      id: 'filter-node',
      taskId: 'task',
      type: 'filter',
      label: 'Filter',
      x: 0,
      y: 0,
      config: { condition: '[a] =' },
      createdAt: 0,
      updatedAt: 0,
    };

    const html = renderToStaticMarkup(
      React.createElement(FormFilter, {
        node,
        fieldCompletions: ['a'],
        otherNodes: [],
        onNodeChange: () => undefined,
      })
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Invalid filter condition segment');
    expect(html).toMatch(
      /<button(?![^>]*disabled)[^>]*>[\s\S]*?data\.workflow\.formLabels\.filterAddCondition[\s\S]*?<\/button>/
    );
  });

  it('has addWithConnective in LeafRowContext', () => {
    expect(formFilterSource).toContain('addWithConnective');
  });

  it('has parentConnective prop in ConditionLeafRow', () => {
    expect(formFilterSource).toContain('parentConnective');
  });

  it('AND button has square A icon', () => {
    expect(formFilterSource).toContain('rounded-sm');
    expect(formFilterSource).toMatch(/>\s*A\s*<\/span>/);
  });

  it('OR button has circle + icon', () => {
    expect(formFilterSource).toContain('rounded-full');
    expect(formFilterSource).toMatch(/>\s*\+\s*<\/span>/);
  });

  it('AND button guards mismatched connective + max depth', () => {
    expect(formFilterSource).toContain("parentConnective !== 'and' && depth >= MAX_NESTING_DEPTH");
  });

  it('OR button guards mismatched connective + max depth', () => {
    expect(formFilterSource).toContain("parentConnective !== 'or' && depth >= MAX_NESTING_DEPTH");
  });

  it('MAX_NESTING_DEPTH is imported from shared filter-condition', () => {
    expect(formFilterSource).toContain('MAX_NESTING_DEPTH');
  });

  it('single-item branch passes depth through unchanged', () => {
    expect(formFilterSource).toContain('item.items.length > 1 ? depth + 1 : depth');
  });

  it('addAfterAndGroup accepts connective parameter', () => {
    expect(formFilterSource).toContain("connective: FilterConditionConnective = 'and'");
  });

  it('delete button still present', () => {
    expect(formFilterSource).toContain('Trash2');
    expect(formFilterSource).toContain("ctx.tr('filterDeleteCondition'");
  });

  it('imports MAX_NESTING_DEPTH from shared module', () => {
    expect(formFilterSource).toContain('MAX_NESTING_DEPTH');
    expect(formFilterSource).toContain("from '../../../shared/filter-condition'");
  });

  it('no longer imports Layers icon', () => {
    expect(formFilterSource).not.toContain('Layers');
  });

  it('passes column types into the condition tree builder', () => {
    expect(formFilterSource).toContain('const columnTypesRef = useRef(columnTypes);');
    expect(formFilterSource).toContain('columnTypesRef.current = columnTypes;');
    expect(formFilterSource).toMatch(/buildFilterConditionTree\(root, columnTypesRef\.current\)/);
    expect(formFilterSource).toMatch(/buildFilterConditionTree\(next, columnTypesRef\.current\)/);
  });

  it('does not auto-fetch value suggestions on mount', () => {
    expect(formFilterSource).not.toContain('const walk = (branch: FilterConditionBranch) => {');
    expect(formFilterSource).not.toContain('walk(root);');
  });

  it('lazily fetches value suggestions when a value input opens', () => {
    const matches = formFilterSource.match(
      /onOpen=\{\(\) => ctx\.fetchColumnValues\(leaf\.field\)\}/g
    );
    expect(matches?.length).toBe(3);
  });

  it('resets the operator to a value valid for the new field type on field switch', () => {
    expect(formFilterSource).toMatch(
      /newValidOps = flattenOps\(operatorsForType\(ctx\.columnTypes\[v\]\)\)\.map\(/
    );
    expect(formFilterSource).toMatch(/newValidOps\.includes\(leaf\.op\) \? leaf\.op : '='/);
    expect(formFilterSource).not.toMatch(/updateLeaf\(leaf\.id, \{ field: v, op: effectiveOp \}\)/);
  });

  it('renders empty values without falling back to stale val1 after clear', () => {
    expect(formFilterSource).toMatch(
      /joinInValues\(leaf\.values \?\? splitInValues\(leaf\.val1\)\)/
    );
    expect(formFilterSource).toMatch(
      /onChange=\{\(v\) => ctx\.updateLeaf\(leaf\.id, \{ values: splitInValues\(v\), val1: v \}\)\}/
    );
  });

  it('offers is null / is not null operators and hides the value input for them', () => {
    expect(formFilterSource).toContain("value: 'is null'");
    expect(formFilterSource).toContain("value: 'is not null'");
    expect(formFilterSource).toMatch(
      /isNullOp = effectiveOp === 'is null' \|\| effectiveOp === 'is not null'/
    );
    expect(formFilterSource).toMatch(/!isNullOp &&\s*\(isMultiValue \?/);
  });
});

// ── GlassValueInput single-value sync ─────────────────────────────────

const glassValueInputSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/workflow-forms/shared/GlassValueInput.tsx'),
  'utf8'
);

describe('GlassValueInput — single-value input survives remount', () => {
  it('initializes single-value input from the value prop', () => {
    expect(glassValueInputSource).toContain("useState(multi ? '' : value)");
  });

  it('syncs inputText from the value prop when it changes externally', () => {
    expect(glassValueInputSource).toContain('if (!multi) setInputText(value);');
  });

  it('drives multi-value tags from the value prop', () => {
    expect(glassValueInputSource).toContain('splitInValues(value)');
  });

  it('exposes an onOpen callback triggered once when the dropdown opens', () => {
    expect(glassValueInputSource).toContain('onOpen?: () => void;');
    expect(glassValueInputSource).toMatch(/if \(!prev\) onOpen\?\.\(\);/);
  });

  it('toggles the dropdown closed when the toggle button is clicked while open', () => {
    expect(glassValueInputSource).toMatch(/return !prev;/);
  });

  it('uses i18n keys for dropdown empty/loading/clear labels instead of hardcoded Chinese', () => {
    expect(glassValueInputSource).toContain("tr('noMatchValue')");
    expect(glassValueInputSource).toContain("tr('loadingValues')");
    expect(glassValueInputSource).toContain("tr('noSuggestions')");
    expect(glassValueInputSource).toContain("tr('filterClearValues')");
    expect(glassValueInputSource).not.toContain("'无匹配值'");
    expect(glassValueInputSource).not.toContain("'加载中…'");
  });
});

// ── Empty-config gating (aligned with sort) ─────────────────────────────

describe('FormFilter — empty-config run is blocked', () => {
  it('maps an empty condition through the shared validator to the renderer message key', () => {
    const node: DataWorkflowNode = {
      id: 'filter-node',
      taskId: 'task',
      type: 'filter',
      label: 'Filter',
      x: 0,
      y: 0,
      config: { condition: '' },
      createdAt: 0,
      updatedAt: 0,
    };

    expect(getOperatorConfigIssue(node)).toEqual({ code: 'filter_incomplete_field' });
    expect(incompleteConfigMessageKey(node)).toBe('data.workflow.formLabels.filterIncompleteField');
  });
});

// ── i18n keys for null operators ───────────────────────────────────────

describe('Filter — null operator i18n keys', () => {
  it('defines 为空 / 不为空 in zh', () => {
    const zh = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json'), 'utf8')
    );
    const keys = Object.keys(zh).length ? zh : {};
    const flat = JSON.stringify(keys);
    expect(flat).toContain('filterOpIsNull');
    expect(flat).toContain('filterOpIsNotNull');
    expect(flat).toContain('noMatchValue');
    expect(flat).toContain('loadingValues');
  });

  it('defines 为空 / 不为空 in en', () => {
    const en = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json'), 'utf8')
    );
    const flat = JSON.stringify(en);
    expect(flat).toContain('filterOpIsNull');
    expect(flat).toContain('filterOpIsNotNull');
    expect(flat).toContain('noMatchValue');
    expect(flat).toContain('loadingValues');
  });
});
