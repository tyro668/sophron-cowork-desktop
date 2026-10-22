/** Test helpers: build workflow graphs from jflow text (resources resolved straight from their URIs). */
import { compileJflow, parseJflow, parseResourceUri } from '../../src/shared/jflow';
import type { JflowFile } from '../../src/shared/jflow';
import type {
  DataWorkflowEdgeInput,
  DataWorkflowNodeInput,
  DataWorkflowOperatorType,
} from '../../src/shared/contracts';

export function parseTestJflow(text: string) {
  return parseJflow(text);
}

export function compileTestJflow(file: JflowFile) {
  const compiled = compileJflow(file, { resolve: (ref) => parseResourceUri(ref.arg) });
  // Store tests read the written table back by name: `@new('x')` writes physical table `x`.
  const nodes = compiled.nodes.map((node) =>
    node.type === 'output' &&
    node.config.intent === 'new' &&
    typeof node.config.resultTableName === 'string' &&
    !node.config.table
      ? { ...node, config: physicalOutputConfig(node.config) }
      : node
  );
  return {
    nodes: nodes.map((node) => ({
      ...node,
      type: node.type as DataWorkflowOperatorType,
    })) as DataWorkflowNodeInput[],
    edges: compiled.edges as DataWorkflowEdgeInput[],
    diagnostics: compiled.diagnostics,
  };
}

/** Parse + compile; throws on any error diagnostic. */
export function jflowTestWorkflow(text: string) {
  const parsed = parseJflow(text);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (!parsed.ast || errors.length) throw new Error(errors.map((d) => d.message).join('\n'));
  const compiled = compileTestJflow(parsed.ast);
  const compileErrors = compiled.diagnostics.filter((d) => d.severity === 'error');
  if (compileErrors.length) throw new Error(compileErrors.map((d) => d.message).join('\n'));
  return compiled;
}

function physicalOutputConfig(config: Record<string, unknown>): Record<string, unknown> {
  const {
    intent: _intent,
    outputStrategy: _strategy,
    resultTableName,
    ref: _ref,
    ...rest
  } = config;
  return {
    ...rest,
    destination: 'duckdb_table',
    table: resultTableName,
    mode: typeof rest.mode === 'string' ? rest.mode : 'replace',
  };
}
