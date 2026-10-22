/**
 * Per-node jflow: one operator node ⇄ one jflow pipe step.
 *
 * Export runs the full exporter on `stub source → node` and keeps the step text; parse compiles
 * `source → step` against a stub source carrying the node's input columns.
 *
 * - Two-input steps (join, union/intersect/except) get a second stub source named after the
 *   node's right input (`rightAlias` / `rightInput`), so `join left d on …` edits in place.
 * - Composite members (`config.layout.composite`) edit as the whole composite: the text holds
 *   every member step and applying it updates each member node by position.
 * - A pivot with group-by exports as `select … | pivot …` and folds back into one pivot node.
 */
import type { WorkflowDiagnostic } from '../workflow-diagnostics';
import type { JflowDiagnostic } from './ast';
import { compileJflow, type JflowColumn } from './compile';
import { exportJflow } from './export';
import {
  jflowCompletions,
  mapDiagnosticsToLint,
  type JflowCompletionResult,
  type JflowLintDiagnostic,
} from './editor-support';
import { parseJflow } from './parse';

const STUB_URI = 'local:raw/__jflow_step_input';
const STUB_RIGHT_URI = 'local:raw/__jflow_step_right';
const STUB_ALIAS = 'input';
const TWO_INPUT_TYPES = new Set(['join', 'set_op']);

/** Node types that have no step form (sources are declared, not piped). */
export const JFLOW_STEP_UNSUPPORTED_TYPES: ReadonlySet<string> = new Set(['input']);

export interface JflowStepContext {
  /** Name the step uses for its second input; defaults to the node's rightAlias / rightInput. */
  rightAlias?: string;
  rightColumns?: JflowColumn[] | null;
  /** All members of the node's composite, in chain order (the node included). */
  members?: JflowStepNode[];
}

/** Right-input name a two-input node refers to. */
export function jflowStepRightAlias(node: JflowStepNode): string {
  const config = node.config ?? {};
  const alias =
    (typeof config.rightAlias === 'string' && config.rightAlias) ||
    (typeof config.rightInput === 'string' && config.rightInput) ||
    '';
  // Labels such as `银行流水标准化(仅收入)` are not identifiers; the step text
  // then names the right input `right`.
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(alias) ? alias : 'right';
}

export interface JflowStepNode {
  id?: string;
  type: string;
  config: Record<string, unknown>;
}

export interface JflowStepExport {
  text: string;
  diagnostics: JflowDiagnostic[];
}

export interface JflowStepParse {
  config: Record<string, unknown> | null;
  type: string | null;
  diagnostics: JflowDiagnostic[];
  /** For composite edits: the new config of every member, keyed by member id. */
  memberConfigs?: Record<string, Record<string, unknown>>;
}

const stepError = (code: string, message: string): JflowDiagnostic => ({
  code,
  severity: 'error',
  message,
  span: { start: 0, end: 0 },
});

/** Node config → step text (without the leading `|`; composites span several `|` lines). */
export function exportJflowStep(
  node: JflowStepNode,
  context: JflowStepContext = {}
): JflowStepExport {
  if (JFLOW_STEP_UNSUPPORTED_TYPES.has(node.type)) {
    return {
      text: '',
      diagnostics: [
        stepError('E_STEP_UNSUPPORTED', `${node.type} 节点请在整体 DSL（导出 DSL）中编辑`),
      ],
    };
  }
  const chain = context.members && context.members.length > 1 ? context.members : [node];
  const nodes: JflowStepNode[] = [
    { id: '__in', type: 'input', config: { source: 'rawTable', ref: STUB_URI, alias: STUB_ALIAS } },
  ];
  const edges: Array<{ sourceNodeId: string; targetNodeId: string; targetHandle: string }> = [];
  let previous = '__in';
  chain.forEach((member, index) => {
    const id = member.id || `step${index}`;
    nodes.push({ id, type: member.type, config: member.config });
    if (TWO_INPUT_TYPES.has(member.type)) {
      const rightId = `__right${index}`;
      const alias = (member === node && context.rightAlias) || jflowStepRightAlias(member);
      nodes.push({
        id: rightId,
        type: 'input',
        config: { source: 'rawTable', ref: STUB_RIGHT_URI, alias },
      });
      edges.push({ sourceNodeId: previous, targetNodeId: id, targetHandle: 'left' });
      edges.push({ sourceNodeId: rightId, targetNodeId: id, targetHandle: 'right' });
    } else {
      edges.push({ sourceNodeId: previous, targetNodeId: id, targetHandle: 'input' });
    }
    previous = id;
  });
  const exported = exportJflow(nodes as Parameters<typeof exportJflow>[0], edges);
  if (exported.diagnostics.some((d) => d.severity === 'error')) {
    return { text: '', diagnostics: exported.diagnostics };
  }
  const lines = exported.text.split('\n');
  const head = lines.findIndex(
    (line) => /^\S/.test(line) && !line.startsWith('#') && !line.startsWith('source')
  );
  const body = lines
    .slice(head + 1)
    .filter((line) => !/^\s*#!\s*(id|label):/.test(line))
    .map((line) => line.replace(/^ {2}/, ''));
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const text = body.join('\n').replace(/^\|\s?/, '');
  return { text, diagnostics: exported.diagnostics };
}

/** `select [k…] | pivot …` (how a grouped pivot exports) → one pivot config with groupBy. */
function foldGroupedPivot(
  nodes: Array<{ type: string; config: Record<string, unknown> }>
): Record<string, unknown> | null {
  if (nodes.length !== 2 || nodes[0].type !== 'select' || nodes[1].type !== 'pivot') return null;
  const select = nodes[0].config;
  if (select.selection === 'exclude' || !Array.isArray(select.fields)) return null;
  const pivot = nodes[1].config;
  const used = new Set<string>();
  for (const axis of (pivot.on as Array<{ field?: string }>) ?? []) {
    if (axis.field) used.add(axis.field);
  }
  for (const metric of (pivot.using as Array<{ expression?: string }>) ?? []) {
    for (const match of (metric.expression ?? '').matchAll(/\[([^\]]+)\]/g)) used.add(match[1]);
  }
  const groupBy = (select.fields as string[]).filter((field) => !used.has(field));
  return { ...pivot, groupBy };
}

/** Step text → node config. `expectedType` rejects steps that would change the node's type. */
export function parseJflowStep(
  text: string,
  options: { expectedType?: string; columns?: JflowColumn[] | null } & JflowStepContext = {}
): JflowStepParse {
  const lead = /^\s*(?:\|\s*)?/.exec(text)?.[0].length ?? 0;
  const step = text.slice(lead).trimEnd();
  if (!step) {
    return { config: null, type: null, diagnostics: [stepError('E_STEP_EMPTY', '步骤为空')] };
  }
  const rightAlias = options.rightAlias ?? rightAliasOf(options);
  const prefix =
    `source ${STUB_ALIAS} = @id('${STUB_URI}')\n` +
    (rightAlias ? `source ${rightAlias} = @id('${STUB_RIGHT_URI}')\n` : '') +
    `${STUB_ALIAS}\n  | `;
  const parsed = parseJflow(`${prefix}${step}\n`);
  const shift = (d: JflowDiagnostic): JflowDiagnostic => ({
    ...d,
    span: d.span
      ? {
          start: Math.max(0, d.span.start - prefix.length + lead),
          end: Math.max(0, d.span.end - prefix.length + lead),
        }
      : d.span,
  });
  if (!parsed.ast || parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { config: null, type: null, diagnostics: parsed.diagnostics.map(shift) };
  }
  const compiled = compileJflow(parsed.ast, {
    resolve: (ref) =>
      ref.arg === STUB_URI
        ? {
            uri: STUB_URI,
            id: '__jflow_step_input',
            kind: 'raw',
            name: STUB_ALIAS,
            columns: options.columns ?? null,
          }
        : ref.arg === STUB_RIGHT_URI && rightAlias
          ? {
              uri: STUB_RIGHT_URI,
              id: '__jflow_step_right',
              kind: 'raw',
              name: rightAlias,
              columns: options.rightColumns ?? null,
            }
          : null,
  });
  const diagnostics = compiled.diagnostics.map(shift);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { config: null, type: null, diagnostics };
  }
  const nodes = compiled.nodes.filter((node) => node.type !== 'input');
  const members = options.members && options.members.length > 1 ? options.members : null;
  if (members) {
    const matches =
      nodes.length === members.length && nodes.every((n, i) => n.type === members[i].type);
    if (!matches) {
      return {
        config: null,
        type: null,
        diagnostics: [
          ...diagnostics,
          stepError(
            'E_STEP_COMPOSITE',
            `组合节点包含 ${members.map((m) => m.type).join(' → ')}，当前文本生成 ${
              nodes.map((n) => n.type).join(' → ') || '空'
            }；请保持相同的步骤结构`
          ),
        ],
      };
    }
    const memberConfigs: Record<string, Record<string, unknown>> = {};
    members.forEach((member, index) => {
      const config = { ...(nodes[index].config as Record<string, unknown>) };
      delete config.layout;
      const layout = (member.config ?? {}).layout;
      memberConfigs[member.id ?? String(index)] = layout ? { ...config, layout } : config;
    });
    const self = options.expectedType
      ? members.findIndex((member) => member.type === options.expectedType)
      : 0;
    const selfId = members[Math.max(0, self)].id ?? String(Math.max(0, self));
    return {
      config: memberConfigs[selfId],
      type: members[Math.max(0, self)].type,
      diagnostics,
      memberConfigs,
    };
  }
  const folded = options.expectedType === 'pivot' ? foldGroupedPivot(nodes) : null;
  if (folded) return { config: folded, type: 'pivot', diagnostics };
  if (nodes.length !== 1) {
    return {
      config: null,
      type: null,
      diagnostics: [
        ...diagnostics,
        stepError(
          'E_STEP_COMPOSITE',
          nodes.length === 0
            ? '步骤没有生成节点'
            : `该步骤会展开为 ${nodes.length} 个节点，请写成一个步骤`
        ),
      ],
    };
  }
  const [node] = nodes;
  if (options.expectedType && node.type !== options.expectedType) {
    return {
      config: null,
      type: node.type,
      diagnostics: [
        ...diagnostics,
        stepError(
          'E_STEP_TYPE',
          `该步骤生成的是 ${node.type} 节点，当前节点类型为 ${options.expectedType}`
        ),
      ],
    };
  }
  return { config: node.config, type: node.type, diagnostics };
}

function rightAliasOf(options: { expectedType?: string } & JflowStepContext): string | undefined {
  if (!options.expectedType || !TWO_INPUT_TYPES.has(options.expectedType)) return undefined;
  return options.rightAlias ?? 'right';
}

/** jflow diagnostic (byte span) → workflow diagnostic (1-based line/column, hint folded in). */
export function jflowDiagnosticToWorkflow(text: string) {
  return (diagnostic: JflowDiagnostic): WorkflowDiagnostic => {
    const start = diagnostic.span?.start ?? 0;
    const before = text.slice(0, start);
    const line = before.split('\n').length;
    const column = start - before.lastIndexOf('\n');
    return {
      severity: diagnostic.severity === 'error' ? 'error' : 'warning',
      code: diagnostic.code,
      message: diagnostic.hint ? `${diagnostic.message}（${diagnostic.hint}）` : diagnostic.message,
      line,
      column,
    };
  };
}

/** Editor support for a single step: completions against the node's input columns. */
export function jflowStepCompletions(
  text: string,
  pos: number,
  columns: JflowColumn[] | null
): JflowCompletionResult | null {
  const prefix = `source ${STUB_ALIAS} = @id('${STUB_URI}')\n${STUB_ALIAS}\n  | `;
  const lead = /^\s*(?:\|\s*)?/.exec(text)?.[0].length ?? 0;
  const body = text.slice(lead);
  const at = Math.max(0, pos - lead);
  const result = jflowCompletions(`${prefix}${body}`, prefix.length + at, {
    tables: [{ id: '__jflow_step_input', name: STUB_ALIAS, kind: 'raw', columns }],
  });
  if (!result) return null;
  return { ...result, from: Math.max(0, result.from - prefix.length + lead) };
}

/** Editor lint for a single step (parse + compile + type guard). */
export function jflowStepLint(
  text: string,
  options: { expectedType?: string; columns?: JflowColumn[] | null } & JflowStepContext = {}
): JflowLintDiagnostic[] {
  if (!text.trim()) return [];
  return mapDiagnosticsToLint(text, parseJflowStep(text, options).diagnostics);
}
