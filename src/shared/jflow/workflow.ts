/** App-facing jflow API: workflow ⇄ text with catalog-backed resolution. */
import { JflowError, type JflowDiagnostic, type ResourceRef } from './ast';
import {
  compileJflow,
  parseResourceUri,
  type JflowColumn,
  type JflowEdge,
  type JflowNode,
  type ResolvedResource,
} from './compile';
import { exportJflow, type ExportEdge, type ExportNode } from './export';
import { parseJflow } from './parse';

export interface JflowCatalogTable {
  id: string;
  name: string;
  kind: 'raw' | 'result';
  columns?: JflowColumn[] | null;
}

export interface JflowCatalog {
  tables: JflowCatalogTable[];
  /** Pipelines that can be referenced via local:pipeline/{id}. */
  pipelines?: Array<{ id: string; name: string }>;
}

export function catalogResolver(catalog: JflowCatalog) {
  return (ref: ResourceRef): ResolvedResource | null => {
    const pick = (t: JflowCatalogTable): ResolvedResource => ({
      uri: `local:${t.kind}/${t.id}`,
      id: t.id,
      kind: t.kind,
      name: t.name,
      columns: t.columns ?? null,
    });
    if (ref.form === '@id') {
      const parsed = parseResourceUri(ref.arg);
      if (!parsed) return null;
      if (parsed.kind === 'raw' || parsed.kind === 'result') {
        const t = catalog.tables.find((x) => x.id === parsed.id && x.kind === parsed.kind);
        return t ? pick(t) : null;
      }
      return { ...parsed, name: ref.snap };
    }
    if (ref.form === '@name') {
      const hits = catalog.tables.filter((x) => x.name === ref.arg);
      if (hits.length === 1) return pick(hits[0]);
      if (hits.length > 1) {
        throw new JflowError(
          'E_REF_AMBIGUOUS',
          `有 ${hits.length} 张表都叫 ${ref.arg}`,
          ref.span,
          `改用 @id('${`local:${hits[0].kind}/${hits[0].id}`}', '${ref.arg}')`
        );
      }
      return null;
    }
    if (ref.form === '@path')
      return { uri: `file:${ref.arg}`, kind: 'file', name: null, columns: null };
    return null;
  };
}

export interface CompiledWorkflow {
  nodes: JflowNode[];
  edges: JflowEdge[];
  diagnostics: JflowDiagnostic[];
  sourceMap: Record<string, { start: number; end: number }>;
  lastColumns?: string[] | null;
  relationColumns?: Record<string, string[] | null>;
}

/** Parse + bind + validate + compile. Node ids are scoped with `idPrefix` (the pipeline id). */
export function compileWorkflowJflow(
  text: string,
  catalog: JflowCatalog,
  idPrefix = ''
): CompiledWorkflow {
  const parsed = parseJflow(text);
  if (!parsed.ast || parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { nodes: [], edges: [], diagnostics: parsed.diagnostics, sourceMap: {} };
  }
  const resolve = catalogResolver(catalog);
  const compiled = compileJflow(parsed.ast, {
    resolve,
    findResultByName: (name) => {
      const t = catalog.tables.find((x) => x.kind === 'result' && x.name === name);
      return t ? { id: t.id, name: t.name } : null;
    },
  });
  const scope = (id: string) =>
    idPrefix && !id.startsWith(`${idPrefix}__`) ? `${idPrefix}__${id}` : id;
  const sourceMap: CompiledWorkflow['sourceMap'] = {};
  for (const [k, v] of Object.entries(compiled.sourceMap)) sourceMap[scope(k)] = v;
  // Composite steps ({stepId}~k + stepId) carry their grouping in config.layout so the canvas can
  // show them as one node; the step's label names the group.
  const groups = new Map<string, JflowNode[]>();
  for (const n of compiled.nodes) {
    const key = n.layout?.composite;
    if (key) groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  for (const [key, members] of groups) {
    const base = compiled.nodes.find((n) => n.id === key);
    if (base && !members.includes(base)) members.push(base);
    if (members.length < 2) continue;
    const label = base?.label ?? key;
    for (const m of members) {
      m.config = {
        ...m.config,
        layout: {
          composite: scope(key),
          role: m.id === key ? 'main' : (m.layout?.role ?? 'step'),
          label,
          size: members.length,
        },
      };
    }
  }
  return {
    nodes: compiled.nodes.map((n) => ({ ...n, id: scope(n.id) })),
    edges: compiled.edges.map((e) => ({
      ...e,
      id: `${scope(e.sourceNodeId)}->${scope(e.targetNodeId)}:${e.targetHandle}`,
      sourceNodeId: scope(e.sourceNodeId),
      targetNodeId: scope(e.targetNodeId),
    })),
    diagnostics: [...parsed.diagnostics, ...compiled.diagnostics],
    sourceMap,
    lastColumns: compiled.lastColumns,
    relationColumns: compiled.relationColumns,
  };
}

/** Workflow → canonical jflow text (composites merged, `#! id:` pragmas keep node ids). */
export function exportWorkflowJflow(
  nodes: Array<ExportNode>,
  edges: Array<ExportEdge>,
  options: { pipelineName?: string } = {}
): { text: string; diagnostics: JflowDiagnostic[] } {
  const r = exportJflow(nodes, edges, options);
  return { text: r.text, diagnostics: r.diagnostics };
}
