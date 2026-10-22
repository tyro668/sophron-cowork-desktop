/**
 * Structural correctness for the existing 场景_ pipelines:
 * parse → bind → validate → compile must reproduce the reviewed operator graphs, and
 * reverse export → reparse → compile must reproduce them again (composites merged & re-split).
 * Execution of these graphs against the real data is covered by the gate (all baselines matched).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  compileJflow,
  exportJflow,
  formatJflow,
  parseJflow,
  parseResourceUri,
} from '../../src/shared/jflow';
import type { ResourceRef } from '../../src/shared/jflow';

const FIX = path.join(__dirname, 'fixtures');
type SpecNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  inputs?: Record<string, string>;
};

// Column snapshot of the source raw tables (DESCRIBE of the real tables).
const RAW_COLUMNS = JSON.parse(
  fs.readFileSync(path.join(FIX, 'raw-columns.json'), 'utf8')
) as Record<string, Array<{ name: string; type: string }>>;

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon((v as Record<string, unknown>)[k])])
        )
      : v;

function graphShape(
  nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string; targetHandle?: string | null }>
) {
  // Ignore id numbering of anonymous steps: describe each node by type+config+inputs shape.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sig = new Map<string, string>();
  const visit = (id: string): string => {
    if (sig.has(id)) return sig.get(id)!;
    const n = byId.get(id)!;
    const cfg = { ...n.config } as Record<string, unknown>;
    delete cfg.ref;
    delete cfg.intent;
    delete cfg.rightInput;
    delete cfg.table;
    const ins = edges
      .filter((e) => e.targetNodeId === id)
      .map((e) => `${e.targetHandle === 'right' ? 'R' : 'L'}:${visit(e.sourceNodeId)}`)
      .sort();
    const s = createHash('sha1')
      .update(JSON.stringify([n.type, canon(cfg), ins]))
      .digest('hex');
    sig.set(id, s);
    return s;
  };
  const sinks = nodes.filter((n) => !edges.some((e) => e.sourceNodeId === n.id));
  return sinks.map((n) => visit(n.id)).sort();
}

function specEdges(nodes: SpecNode[]) {
  return nodes.flatMap((n) =>
    Object.entries(n.inputs ?? {}).map(([h, s]) => ({
      sourceNodeId: s,
      targetNodeId: n.id,
      targetHandle: h === 'right' ? 'right' : 'input',
    }))
  );
}

describe.each(['sales', 'stock', 'recon'])('jflow scenario %s', (name) => {
  const text = fs.readFileSync(path.join(FIX, `${name}.jflow`), 'utf8');
  const reviewed = JSON.parse(
    fs.readFileSync(path.join(FIX, `${name}.nodes.json`), 'utf8')
  ) as SpecNode[];
  const resolve = (ref: ResourceRef) => {
    const r = parseResourceUri(ref.arg);
    if (!r) return null;
    return {
      ...r,
      name: ref.snap,
      columns: r.kind === 'raw' ? (RAW_COLUMNS[r.id!] ?? null) : null,
    };
  };
  const expected = graphShape(reviewed, specEdges(reviewed));

  it('parses, binds, validates and compiles to the reviewed operator graph', () => {
    const parsed = parseJflow(text);
    expect(parsed.diagnostics).toEqual([]);
    const compiled = compileJflow(parsed.ast!, { resolve });
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(graphShape(compiled.nodes, compiled.edges)).toEqual(expected);
    // every auxiliary node maps back to its step text
    for (const n of compiled.nodes) expect(compiled.sourceMap[n.id]).toBeDefined();
  });

  it('formats canonically (format ∘ parse is idempotent, single blank lines, raw SQL untouched)', () => {
    const once = formatJflow(parseJflow(text).ast!);
    expect(once).not.toMatch(/\n\n\n/);
    expect(formatJflow(parseJflow(once).ast!)).toBe(once);
  });

  it('reverse-exports the graph (merging composites) and recompiles to the same graph', () => {
    const exported = exportJflow(reviewed, specEdges(reviewed));
    expect(exported.diagnostics).toEqual([]);
    const reparsed = parseJflow(exported.text);
    expect(reparsed.diagnostics).toEqual([]);
    const again = compileJflow(reparsed.ast!, { resolve });
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(graphShape(again.nodes, again.edges)).toEqual(expected);
    // composites merge back: no `~k` ids appear in the text, ids stay stable
    expect(exported.text).not.toMatch(/#! id: [^\n]*~/);
    const ids = new Set(again.nodes.map((n) => n.id));
    for (const n of reviewed) if (!n.id.includes('~')) expect(ids.has(n.id)).toBe(true);
  });
});

describe('formatter keeps raw strings verbatim', () => {
  it('does not collapse blank lines inside sql triple quotes', () => {
    const sql = 'SELECT 1\n\n\n\nFROM input';
    const text = `source o = @id('local:raw/x')\n\n\n\no | sql '''${sql}''' | write @new('y')\n`;
    const out = formatJflow(parseJflow(text).ast!);
    expect(out).toContain(sql);
    expect(out.replace(sql, '')).not.toMatch(/\n\n\n/);
  });
});
