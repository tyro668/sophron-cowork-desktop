/**
 * Per-node jflow: one operator node ⇄ one jflow pipe step.
 *
 * Export runs the full exporter on `stub source → node` and keeps the step text; parse compiles
 * `source → step` against a stub source carrying the node's input columns. Steps that compile to
 * a composite (several nodes) or need a second input (join / union / lookup) belong in the
 * workflow-level DSL and are rejected here.
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
const STUB_ALIAS = 'input';

/** Node types that cannot be expressed as a standalone single-input step. */
export const JFLOW_STEP_UNSUPPORTED_TYPES: ReadonlySet<string> = new Set([
  'input',
  'join',
  'set_op',
]);

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
}

const stepError = (code: string, message: string): JflowDiagnostic => ({
  code,
  severity: 'error',
  message,
  span: { start: 0, end: 0 },
});

/** Node config → step text (without the leading `|`). */
export function exportJflowStep(node: JflowStepNode): JflowStepExport {
  if (JFLOW_STEP_UNSUPPORTED_TYPES.has(node.type)) {
    return {
      text: '',
      diagnostics: [
        stepError('E_STEP_UNSUPPORTED', `${node.type} 节点请在整体 DSL（导出 DSL）中编辑`),
      ],
    };
  }
  const id = node.id || 'step';
  const exported = exportJflow(
    [
      { id: '__in', type: 'input', config: { source: 'rawTable', ref: STUB_URI } },
      { id, type: node.type, config: node.config },
    ],
    [{ sourceNodeId: '__in', targetNodeId: id, targetHandle: 'input' }]
  );
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
  if (body.filter((line) => line.startsWith('|')).length > 1) {
    return {
      text: '',
      diagnostics: [stepError('E_STEP_COMPOSITE', `该节点会导出为多个步骤，请在整体 DSL 中编辑`)],
    };
  }
  const text = body.join('\n').replace(/^\|\s?/, '');
  return { text, diagnostics: exported.diagnostics };
}

/** Step text → node config. `expectedType` rejects steps that would change the node's type. */
export function parseJflowStep(
  text: string,
  options: { expectedType?: string; columns?: JflowColumn[] | null } = {}
): JflowStepParse {
  const lead = /^\s*(?:\|\s*)?/.exec(text)?.[0].length ?? 0;
  const step = text.slice(lead).trimEnd();
  if (!step) {
    return { config: null, type: null, diagnostics: [stepError('E_STEP_EMPTY', '步骤为空')] };
  }
  const prefix = `source ${STUB_ALIAS} = @id('${STUB_URI}')\n${STUB_ALIAS}\n  | `;
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
        : null,
  });
  const diagnostics = compiled.diagnostics.map(shift);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { config: null, type: null, diagnostics };
  }
  const nodes = compiled.nodes.filter((node) => node.type !== 'input');
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
            : `该步骤会展开为 ${nodes.length} 个节点，请在整体 DSL 中编辑`
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
  options: { expectedType?: string; columns?: JflowColumn[] | null } = {}
): JflowLintDiagnostic[] {
  if (!text.trim()) return [];
  return mapDiagnosticsToLint(text, parseJflowStep(text, options).diagnostics);
}
