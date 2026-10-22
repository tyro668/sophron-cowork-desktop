import { describe, expect, it } from 'vitest';
import {
  jflowCompletions,
  jflowHighlightTokens,
  jflowLintDiagnostics,
  type JflowCatalog,
} from '../../src/shared/jflow';
import { mapDiagnosticsToLint } from '../../src/shared/jflow/editor-support';

const catalog: JflowCatalog = {
  tables: [
    {
      id: 'r1',
      name: '订单',
      kind: 'raw',
      columns: [{ name: '金额' }, { name: '客户' }, { name: '日期' }],
    },
    { id: 'o1', name: '月报', kind: 'result' },
  ],
};
const head = `source o = @id('local:raw/r1', '订单')\n`;

describe('jflow highlighting (Chevrotain tokens)', () => {
  it('classifies verbs, fields, strings, refs, comments and pragmas', () => {
    const text = `#! id: s1\n${head}o | where [金额] > 10 and [客户] = 'A'  # c\n`;
    const toks = jflowHighlightTokens(text);
    const at = (s: string) => toks.find((t) => text.slice(t.from, t.to) === s)?.cls;
    expect(at('#! id: s1')).toBe('pragma');
    expect(at('source')).toBe('keyword');
    expect(at('@id')).toBe('ref');
    expect(at('where')).toBe('verb');
    expect(at('[金额]')).toBe('field');
    expect(at("'A'")).toBe('string');
    expect(at('10')).toBe('number');
    expect(at('# c')).toBe('comment');
  });
  it('marks unclosed fields and double quotes as invalid', () => {
    const text = 'o | where [金额 > "x"';
    const classes = jflowHighlightTokens(text).map((t) => t.cls);
    expect(classes).toContain('invalid');
  });
});

describe('jflow lint mapping', () => {
  it('maps parse errors to document ranges', () => {
    const text = `${head}o | where [金额] > "x"\n`;
    const d = jflowLintDiagnostics(text, catalog);
    const dq = d.find((x) => x.code === 'E_LEX_DOUBLE_QUOTE')!;
    expect(dq.severity).toBe('error');
    expect(text.slice(dq.from, dq.to)).toBe('"x"');
  });
  it('reports strict per-verb argument errors at the argument', () => {
    const text = `${head}o | take 3 sortt: [金额]\n`;
    const d = jflowLintDiagnostics(text, catalog);
    const e = d.find((x) => x.code === 'E_ARG_UNKNOWN')!;
    expect(e).toBeDefined();
    expect(e.message).toContain('sort');
    expect(e.from).toBeGreaterThanOrEqual(text.indexOf('sortt'));
  });
  it('reports unknown fields from the bound schema', () => {
    const text = `${head}o | where [金额X] > 1\n`;
    const d = jflowLintDiagnostics(text, catalog);
    expect(d.some((x) => x.severity === 'error' && /金额X/.test(x.message))).toBe(true);
  });
  it('clamps spans and never yields empty ranges', () => {
    const text = 'abc';
    const out = mapDiagnosticsToLint(text, [
      { code: 'E', severity: 'error', message: 'm', span: { start: 10, end: 20 } },
      { code: 'E', severity: 'warning', message: 'm' },
    ]);
    expect(out[0]).toMatchObject({ from: 2, to: 3, severity: 'error' });
    expect(out[1]).toMatchObject({ from: 0, to: 1, severity: 'warning' });
  });
  it('is clean for a valid document', () => {
    expect(
      jflowLintDiagnostics(`${head}o | where [金额] > 1 | write @new('x')\n`, catalog)
    ).toEqual([]);
  });
});

describe('jflow completion', () => {
  it("'[' triggers the field list from the bound schema", () => {
    const text = `${head}o | where [`;
    const r = jflowCompletions(text, text.length, catalog)!;
    expect(r.from).toBe(text.length - 1);
    expect(r.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['[金额]', '[客户]', '[日期]'])
    );
    expect(r.options[0].apply!.endsWith(']')).toBe(true);
  });
  it('filters fields by the typed prefix and includes derived names', () => {
    const text = `${head}o | derive [净额] = [金额] * 0.9 | where [净`;
    const r = jflowCompletions(text, text.length, catalog)!;
    expect(r.options.map((o) => o.label)).toEqual(['[净额]']);
  });
  it('@id / @name complete tables', () => {
    const t1 = `source x = @id('`;
    const r1 = jflowCompletions(t1, t1.length, catalog)!;
    expect(r1.options.map((o) => o.apply)).toContain(`local:raw/r1', '订单`);
    const t2 = `source x = @name('月`;
    expect(jflowCompletions(t2, t2.length, catalog)!.options.map((o) => o.label)).toEqual(['月报']);
  });
  it('| completes verbs and verbs complete their named params', () => {
    const t1 = `${head}o | ta`;
    expect(jflowCompletions(t1, t1.length, catalog)!.options.map((o) => o.label)).toEqual(['take']);
    const t2 = `${head}o | take 3 `;
    expect(jflowCompletions(t2, t2.length, catalog)!.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['per:', 'sort:', 'ties:', 'offset:'])
    );
    const t3 = `${head}o | write @new('x') mode: replace `;
    const labels = jflowCompletions(t3, t3.length, catalog)!.options.map((o) => o.label);
    expect(labels).not.toContain('mode:');
    expect(labels).toContain('if_exists:');
  });
});

describe('step-by-step schema for [ completion', () => {
  const cat: JflowCatalog = {
    tables: [
      {
        id: 'r1',
        name: '订单',
        kind: 'raw',
        columns: [{ name: '金额' }, { name: '客户' }, { name: '日期' }],
      },
      { id: 'r2', name: '客户表', kind: 'raw', columns: [{ name: '客户' }, { name: '等级' }] },
    ],
  };
  const src = `source o = @id('local:raw/r1', '订单')\nsource c = @id('local:raw/r2', '客户表')\n`;
  const labels = (text: string) =>
    jflowCompletions(text, text.length, cat)!.options.map((o) => o.label);
  it('follows select / drop / derive through the chain', () => {
    expect(labels(`${src}o | select [金额], [客户] | where [`)).toEqual(['[金额]', '[客户]']);
    expect(labels(`${src}o | drop [日期] | derive [净额] = [金额] * 2 | sort [`)).toEqual([
      '[金额]',
      '[客户]',
      '[净额]',
    ]);
  });
  it('sees group output only after group', () => {
    expect(labels(`${src}o | group [客户] (agg [合计] = sum([金额])) | where [`)).toEqual([
      '[客户]',
      '[合计]',
    ]);
  });
  it('adds the right table columns inside join / lookup', () => {
    expect(labels(`${src}o | lookup c on [`)).toEqual(['[金额]', '[客户]', '[日期]', '[等级]']);
  });
  it('uses let-bound relations as chain heads', () => {
    expect(labels(`${src}let x = o | select [日期]\nx | where [`)).toEqual(['[日期]']);
  });
});

describe('catalog-strict references', () => {
  it('unknown @id is E_REF_NOT_FOUND', () => {
    const d = jflowLintDiagnostics(
      `source o = @id('local:raw/nope', '旧表')\no | write @new('x')\n`,
      catalog
    );
    expect(d.map((x) => x.code)).toContain('E_REF_NOT_FOUND');
  });
  it('ambiguous @name is E_REF_AMBIGUOUS', () => {
    const dup: JflowCatalog = {
      tables: [
        { id: 'a', name: 'T', kind: 'raw' },
        { id: 'b', name: 'T', kind: 'result' },
      ],
    };
    const d = jflowLintDiagnostics(`source o = @name('T')\no | write @new('x')\n`, dup);
    expect(d.map((x) => x.code)).toContain('E_REF_AMBIGUOUS');
  });
});
