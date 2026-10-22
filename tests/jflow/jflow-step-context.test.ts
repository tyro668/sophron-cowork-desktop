import { describe, expect, it } from 'vitest';
import {
  compileWorkflowJflow,
  exportJflowStep,
  jflowStepRightAlias,
  parseJflowStep,
} from '../../src/shared/jflow';

const COLS = [
  { name: '门店', type: 'VARCHAR' },
  { name: '品类', type: 'VARCHAR' },
  { name: '销售额', type: 'DOUBLE' },
];
const RIGHT = [
  { name: '门店', type: 'VARCHAR' },
  { name: '区域', type: 'VARCHAR' },
];

describe('per-node jflow steps — two inputs, composites, grouped pivot', () => {
  it('round-trips a join against its right input name', () => {
    const config = {
      joinType: 'left',
      rightAlias: 'd',
      conditions: [{ left: '门店', operator: '=', right: '门店' }],
      keep: [
        { side: 'left', wildcard: true },
        { side: 'right', source: '区域', alias: '地区' },
      ],
    };
    const exported = exportJflowStep({ id: 'j', type: 'join', config });
    expect(exported.diagnostics).toEqual([]);
    expect(exported.text).toBe('join left d on [门店] keep: [left].*, [地区] = [d].[区域]');
    const edited = parseJflowStep(exported.text.replace('left d', 'inner d'), {
      expectedType: 'join',
      columns: COLS,
      rightAlias: 'd',
      rightColumns: RIGHT,
    });
    expect(edited.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(edited.config).toMatchObject({ joinType: 'inner', keep: config.keep });
    // Unknown right column is caught against the right input's schema.
    const bad = parseJflowStep('join left d on [门店] keep: [left].*, [d].[城市]', {
      expectedType: 'join',
      columns: COLS,
      rightAlias: 'd',
      rightColumns: RIGHT,
    });
    expect(bad.config).toBeNull();
  });

  it('round-trips union / except and sql', () => {
    const union = { operation: 'union', quantifier: 'all', match: 'by_name', rightInput: 'b' };
    const text = exportJflowStep({ type: 'set_op', config: union }).text;
    expect(text).toBe('union b');
    const parsed = parseJflowStep('except b', { expectedType: 'set_op', rightAlias: 'b' });
    expect(parsed.config).toMatchObject({ operation: 'except', rightInput: 'b' });
    const sql = parseJflowStep("sql '''select * from input where 1 = 1'''", {
      expectedType: 'sql',
    });
    expect(exportJflowStep({ type: 'sql', config: sql.config! }).text).toBe(
      "sql '''select * from input where 1 = 1'''"
    );
  });

  it('folds a grouped pivot (select | pivot) back into one pivot node', () => {
    const config = {
      on: [{ field: '品类', values: [] }],
      using: [{ function: 'sum', expression: '[销售额]' }],
      groupBy: ['门店'],
    };
    const text = exportJflowStep({ type: 'pivot', config }).text;
    expect(
      text.split('\n').filter((line) => line.startsWith('|') || !line.startsWith(' '))
    ).toHaveLength(2);
    const parsed = parseJflowStep(text, { expectedType: 'pivot', columns: COLS });
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(parsed.config).toMatchObject({ groupBy: ['门店'], on: [{ field: '品类' }] });
  });

  it('edits a composite as a whole and maps the configs back onto its member ids', () => {
    const compiled = compileWorkflowJflow(
      "source s = @id('local:raw/r1')\ns\n  | select [门店], [两倍] = [销售额] * 2\n  | write @new('o')",
      { tables: [{ id: 'r1', name: 's', kind: 'raw', columns: COLS }] },
      'p__'
    );
    const members = compiled.nodes
      .filter((node) => node.type !== 'input' && node.type !== 'output')
      .map((node) => ({ id: node.id, type: node.type, config: node.config }));
    expect(members.map((m) => m.type)).toEqual(['derive', 'select']);
    const main = members[1];
    const text = exportJflowStep(main, { members }).text;
    expect(text).toBe('select [门店], [两倍] = [销售额] * 2');
    const edited = parseJflowStep('select [门店], [两倍] = [销售额] * 3', {
      expectedType: 'select',
      columns: COLS,
      members,
    });
    expect(edited.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Object.keys(edited.memberConfigs!)).toEqual(members.map((m) => m.id));
    expect(edited.memberConfigs![members[0].id]).toMatchObject({
      calculations: [{ field: '两倍', expression: '[销售额] * 3' }],
      layout: members[0].config.layout,
    });
    const reshaped = parseJflowStep('select [门店]', {
      expectedType: 'select',
      columns: COLS,
      members,
    });
    expect(reshaped.diagnostics.some((d) => d.code === 'E_STEP_COMPOSITE')).toBe(true);
  });
});

describe('right-input naming', () => {
  it('falls back to `right` when the configured alias is not an identifier', () => {
    const node = {
      type: 'set_op',
      config: {
        operation: 'union',
        quantifier: 'all',
        match: 'by_name',
        rightAlias: '银行流水(仅收入)',
      },
    };
    const rightAlias = jflowStepRightAlias(node);
    expect(rightAlias).toBe('right');
    const text = exportJflowStep(node, { rightAlias }).text;
    expect(text).toBe('union right');
    expect(parseJflowStep(text, { expectedType: 'set_op', rightAlias }).diagnostics).toEqual([]);
  });
});
