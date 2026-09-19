import { parseFieldRef } from '../prep-dsl/syntax/fields';
import { planJoinProjectionColumns } from '../prep-dsl/join-projection';
import { parseConditionTree, type FilterConditionNode } from '../filter-condition';
import { withPivotMetricDefaultSuffix } from '../operator-config/pivot';
import {
  extractExpressionFieldNames,
  isExpressionSyntaxValid,
  planTypeFamily,
} from './expression-fields';
import type {
  PlanColumn,
  PlanSchema,
  WorkflowPlan,
  WorkflowPlanDiagnostic,
  WorkflowPlanNode,
} from './model';

const UNKNOWN: PlanSchema = { columns: [], known: false };

/**
 * Resolves the input columns for an `input_source` plan node. Returning null
 * marks the schema unknown and skips field-existence checks for the node's
 * downstream rather than producing false errors.
 */
export type PlanInputSchemaResolver = (node: WorkflowPlanNode) => PlanColumn[] | null;

/**
 * Staged schema validation: propagates each node's output column list along
 * the graph and validates field existence, type compatibility, set-op column
 * alignment, pivot output columns, and deterministic ordering before save.
 */
export function validateWorkflowPlanSchemas(
  plan: WorkflowPlan,
  resolveInputSchema: PlanInputSchemaResolver
): WorkflowPlanDiagnostic[] {
  return propagateWorkflowPlanSchemas(plan, resolveInputSchema).diagnostics;
}

/**
 * Propagates each node's output schema along the plan graph and returns the
 * resolved schema per node id alongside the diagnostics raised while
 * validating. Downstream consumers (field selectors, column-type lookups) can
 * read `schemas.get(nodeId)` without depending on materialized preview tables.
 */
export function propagateWorkflowPlanSchemas(
  plan: WorkflowPlan,
  resolveInputSchema: PlanInputSchemaResolver
): { schemas: Map<string, PlanSchema>; diagnostics: WorkflowPlanDiagnostic[] } {
  const diagnostics: WorkflowPlanDiagnostic[] = [];
  const incoming = new Map<string, { sourceId: string; handle: string }[]>();
  for (const edge of plan.edges) {
    incoming.set(edge.targetNodeId, [
      ...(incoming.get(edge.targetNodeId) ?? []),
      { sourceId: edge.sourceNodeId, handle: edge.targetHandle ?? 'input' },
    ]);
  }

  const schemas = new Map<string, PlanSchema>();
  for (const node of topologicalOrder(plan)) {
    const inputs = incoming.get(node.id) ?? [];
    const left =
      inputSchemaFor(inputs, 'left', schemas) ??
      inputSchemaFor(inputs, 'input', schemas) ??
      UNKNOWN;
    const right = inputSchemaFor(inputs, 'right', schemas) ?? undefined;
    const schema = validateNode(node, left ?? UNKNOWN, right, resolveInputSchema, diagnostics);
    schemas.set(node.id, schema);
  }
  return { schemas, diagnostics };
}

function topologicalOrder(plan: WorkflowPlan): WorkflowPlanNode[] {
  const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of plan.nodes) inDegree.set(node.id, 0);
  for (const edge of plan.edges) {
    if (!nodeById.has(edge.sourceNodeId) || !nodeById.has(edge.targetNodeId)) continue;
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.set(edge.sourceNodeId, [
      ...(outgoing.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  }
  const queue = plan.nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0);
  const ordered: WorkflowPlanNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      inDegree.set(targetId, (inDegree.get(targetId) ?? 0) - 1);
      if ((inDegree.get(targetId) ?? 0) === 0) {
        const target = nodeById.get(targetId);
        if (target) queue.push(target);
      }
    }
  }
  for (const node of plan.nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function inputSchemaFor(
  inputs: { sourceId: string; handle: string }[],
  handle: string,
  schemas: Map<string, PlanSchema>
): PlanSchema | null {
  for (const input of inputs) {
    if (input.handle !== handle) continue;
    return schemas.get(input.sourceId) ?? UNKNOWN;
  }
  return null;
}

function validateNode(
  node: WorkflowPlanNode,
  left: PlanSchema,
  right: PlanSchema | undefined,
  resolveInputSchema: PlanInputSchemaResolver,
  diagnostics: WorkflowPlanDiagnostic[]
): PlanSchema {
  const config = node.config as Record<string, unknown>;
  // Disabled nodes pass their input through at runtime; mirror that so their
  // (possibly incomplete) config does not block drafts and downstream fields
  // resolve against the passthrough schema.
  if (config.disabled === true) {
    return left;
  }
  switch (node.type) {
    case 'input_source': {
      const columns = resolveInputSchema(node);
      const incrementalBy =
        typeof config.incrementalBy === 'string' ? config.incrementalBy.trim() : '';
      if (incrementalBy && columns) {
        checkFields(node, [incrementalBy], { columns, known: true }, diagnostics);
      }
      return columns ? { columns, known: true } : UNKNOWN;
    }
    case 'output': {
      const mode = typeof config.mode === 'string' ? config.mode : 'replace';
      if (mode === 'merge') {
        const mergeKeys = strList(config.mergeKeys);
        if (mergeKeys.length === 0) {
          push(
            diagnostics,
            'error',
            node,
            'outputMergeKeysMissing',
            'output mode merge requires by [key] business key columns'
          );
        } else {
          checkFields(node, mergeKeys, left, diagnostics);
        }
      }
      return left;
    }
    case 'filter': {
      const condition = typeof config.condition === 'string' ? config.condition : '';
      if (condition.trim()) {
        try {
          const fields = collectConditionFields(parseConditionTree(condition));
          checkFields(node, fields, left, diagnostics);
        } catch {
          push(
            diagnostics,
            'error',
            node,
            'filterConditionInvalid',
            `Filter condition is not parseable: ${condition.slice(0, 120)}`
          );
        }
      }
      return left;
    }
    case 'sort':
      checkFields(node, strArray(config.keys, 'field'), left, diagnostics);
      return left;
    case 'deduplicate': {
      checkFields(node, strList(config.columns), left, diagnostics);
      checkFields(node, strArray(config.orderBy, 'field'), left, diagnostics);
      const keep = typeof config.keep === 'string' ? config.keep : 'first';
      if (
        keep !== 'random' &&
        left.known &&
        strArray(config.orderBy, 'field').length === 0 &&
        strList(config.columns).length > 0
      ) {
        push(
          diagnostics,
          'warning',
          node,
          'deduplicateNondeterministic',
          `Deduplicate keeps "${keep}" rows without order by; the kept row is nondeterministic`
        );
      }
      return left;
    }
    case 'field_select': {
      const columns = strList(config.columns);
      checkFields(node, columns, left, diagnostics);
      if (!left.known) return UNKNOWN;
      const exclude = config.mode === 'exclude';
      return {
        known: true,
        columns: exclude
          ? left.columns.filter((column) => !columns.includes(column.name))
          : left.columns.filter((column) => columns.includes(column.name)),
      };
    }
    case 'field_mapping': {
      const mappings = recordArray(config.mappings);
      checkFields(
        node,
        mappings.map((item) => String(item.source ?? '')),
        left,
        diagnostics
      );
      if (!left.known) return UNKNOWN;
      const renames = new Map<string, string>();
      for (const item of mappings) {
        const source = String(item.source ?? '');
        const value = String(item.targetValue ?? '');
        if (!source || !value) continue;
        const target =
          item.targetMode === 'rename'
            ? value
            : item.targetMode === 'prefix'
              ? `${value}${source}`
              : `${source}${value}`;
        renames.set(source, target);
      }
      return {
        known: true,
        columns: left.columns.map((column) =>
          renames.has(column.name) ? { ...column, name: renames.get(column.name)! } : column
        ),
      };
    }
    case 'type_convert': {
      checkFields(
        node,
        recordArray(config.conversions).map((item) => String(item.column ?? '')),
        left,
        diagnostics
      );
      if (!left.known) return UNKNOWN;
      const retypes = new Map<string, string>();
      for (const item of recordArray(config.conversions)) {
        const column = String(item.column ?? '');
        const type = typeof item.type === 'string' ? item.type : '';
        if (column && type) retypes.set(column, type);
      }
      return {
        known: true,
        columns: left.columns.map((column) =>
          retypes.has(column.name) ? { ...column, type: retypes.get(column.name) } : column
        ),
      };
    }
    case 'calculate_field': {
      const calculations = recordArray(config.calculations);
      for (const item of calculations) {
        const expression = String(item.expression ?? '');
        if (!expression.trim()) continue;
        if (!isExpressionSyntaxValid(expression)) {
          push(
            diagnostics,
            'error',
            node,
            'expressionSyntaxInvalid',
            `Calculation expression is not parseable: ${expression.slice(0, 120)}`,
            { field: String(item.field ?? '') }
          );
          continue;
        }
        checkFields(node, extractExpressionFieldNames(expression), left, diagnostics, 'expression');
      }
      if (!left.known) return UNKNOWN;
      const columns = [...left.columns];
      for (const item of calculations) {
        const field = String(item.field ?? '');
        if (!field) continue;
        const existing = columns.findIndex((column) => column.name === field);
        if (existing >= 0 && item.action === 'replace') {
          columns[existing] = { name: field };
        } else if (existing < 0) {
          columns.push({ name: field });
        }
      }
      return { known: true, columns };
    }
    case 'missing_value': {
      checkFields(node, strList(config.columns), left, diagnostics);
      checkFields(
        node,
        recordArray(config.rules).map((item) => String(item.column ?? '')),
        left,
        diagnostics
      );
      return left;
    }
    case 'limit': {
      checkFields(node, strArray(config.orderBy, 'field'), left, diagnostics);
      if (
        left.known &&
        config.mode !== 'random' &&
        strArray(config.orderBy, 'field').length === 0
      ) {
        push(
          diagnostics,
          'warning',
          node,
          'limitNondeterministic',
          'Limit without order by returns a nondeterministic row subset'
        );
      }
      if (config.mode === 'random' && config.seed === undefined && left.known) {
        push(
          diagnostics,
          'warning',
          node,
          'limitSampleWithoutSeed',
          'Random sampling without a seed is not reproducible'
        );
      }
      return left;
    }
    case 'unnest': {
      checkFields(node, [String(config.column ?? '')], left, diagnostics);
      if (!left.known) return UNKNOWN;
      const source = String(config.column ?? '');
      const alias = String(config.alias ?? '') || source;
      const columns = left.columns.filter((column) => column.name !== source);
      columns.push({ name: alias });
      const withIndex = String(config.withIndex ?? '');
      if (withIndex) columns.push({ name: withIndex, type: 'integer' });
      if (config.sourceKind === 'json') {
        // Exploded JSON keys are data-driven; downstream columns are unknown.
        return UNKNOWN;
      }
      return { known: true, columns };
    }
    case 'unpivot': {
      const columns = strList(config.columns);
      checkFields(node, columns, left, diagnostics);
      if (!left.known) return UNKNOWN;
      const kept =
        config.mode === 'except'
          ? left.columns.filter((column) => columns.includes(column.name))
          : left.columns.filter((column) => !columns.includes(column.name));
      const nameColumn = String(config.nameColumn ?? '') || 'name';
      const valueColumn = String(config.valueColumn ?? '') || 'value';
      return {
        known: true,
        columns: [...kept, { name: nameColumn, type: 'text' }, { name: valueColumn }],
      };
    }
    case 'aggregate': {
      const groupBy = strList(config.groupBy);
      checkFields(node, groupBy, left, diagnostics);
      for (const metric of recordArray(config.metrics)) {
        const expression = String(metric.expression ?? '');
        if (expression === '*') continue;
        if (!isExpressionSyntaxValid(expression)) {
          push(
            diagnostics,
            'error',
            node,
            'expressionSyntaxInvalid',
            `Aggregate metric expression is not parseable: ${expression.slice(0, 120)}`
          );
          continue;
        }
        checkFields(node, extractExpressionFieldNames(expression), left, diagnostics, 'expression');
      }
      const grains = isRecord(config.dateGranularity) ? Object.keys(config.dateGranularity) : [];
      for (const field of grains) {
        if (!groupBy.includes(field)) {
          push(
            diagnostics,
            'error',
            node,
            'aggregateGrainNotInGroup',
            `Aggregate granularity field "${field}" is not part of the group by fields`,
            { field }
          );
        }
      }
      if (!left.known) return UNKNOWN;
      const columns: PlanColumn[] = groupBy.map((name) => {
        const source = left.columns.find((column) => column.name === name);
        return { name, type: source?.type };
      });
      for (const metric of recordArray(config.metrics)) {
        const alias = String(metric.alias ?? '') || String(metric.function ?? 'metric');
        columns.push({ name: alias });
      }
      return { known: true, columns };
    }
    case 'pivot': {
      const onEntries = recordArray(config.on);
      const groupBy = strList(config.groupBy);
      checkFields(node, groupBy, left, diagnostics);
      checkFields(
        node,
        onEntries.map((entry) => String(entry.field ?? '')),
        left,
        diagnostics
      );
      for (const metric of recordArray(config.using)) {
        const expression = String(metric.expression ?? '');
        if (expression === '*') continue;
        checkFields(node, extractExpressionFieldNames(expression), left, diagnostics, 'expression');
      }
      if (!left.known) return UNKNOWN;
      const columns: PlanColumn[] = groupBy.map((name) => ({
        name,
        type: left.columns.find((column) => column.name === name)?.type,
      }));
      const dynamic = onEntries.some((entry) => {
        const values = Array.isArray(entry.values) ? entry.values : [];
        const custom = Array.isArray(entry.customValues) ? entry.customValues : [];
        return values.length + custom.length === 0;
      });
      if (dynamic) {
        return { known: false, columns };
      }
      // DuckDB names pivot outputs `<value-combo>_<metric-alias>`; multiple
      // on-fields form the cartesian product of their value lists.
      const perAxisValues = onEntries.map((entry) =>
        [...(entry.values as unknown[]), ...((entry.customValues as unknown[]) ?? [])].map(String)
      );
      const valueCombos = perAxisValues.reduce<string[]>(
        (combos, values) => combos.flatMap((combo) => values.map((value) => `${combo}_${value}`)),
        ['']
      );
      const metricAliases = recordArray(config.using).map(
        (metric) =>
          withPivotMetricDefaultSuffix(metric as { function: string; alias?: string }).alias
      );
      const seen = new Set<string>(columns.map((column) => column.name));
      for (const combo of valueCombos) {
        for (const alias of metricAliases) {
          const name = `${combo}_${alias}`;
          if (seen.has(name)) {
            push(
              diagnostics,
              'error',
              node,
              'pivotDuplicateOutput',
              `Pivot produces duplicate output column "${name}"`,
              { field: name }
            );
            continue;
          }
          seen.add(name);
          columns.push({ name });
        }
      }
      return { known: true, columns };
    }
    case 'join': {
      validateJoinNode(node, config, left, right ?? UNKNOWN, diagnostics);
      if (!left.known && !(right && right.known)) return UNKNOWN;
      const leftColumns = left.columns;
      const rightColumns = right?.columns ?? [];
      try {
        const projections = planJoinProjectionColumns(
          config.keep,
          leftColumns.map((column) => column.name),
          rightColumns.map((column) => column.name),
          config.conflict,
          typeof config.rightAlias === 'string' ? config.rightAlias : undefined
        );
        const typeOf = (side: 'left' | 'right', column: string) =>
          (side === 'left' ? leftColumns : rightColumns).find((entry) => entry.name === column)
            ?.type;
        return {
          known: left.known && Boolean(right?.known),
          columns: projections.map((entry) => ({
            name: entry.outputName,
            type: typeOf(entry.side, entry.sourceColumn),
          })),
        };
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'joinProjectionConflict',
          message: error instanceof Error ? error.message : String(error),
          nodeId: node.id,
          nodeType: node.type,
        });
        return UNKNOWN;
      }
    }
    case 'set_op': {
      validateSetOpNode(node, config, left, right ?? UNKNOWN, diagnostics);
      return left;
    }
    case 'expect': {
      const kind = typeof config.kind === 'string' ? config.kind : 'expression';
      if (kind === 'expression') {
        const expression = typeof config.expression === 'string' ? config.expression : '';
        if (expression.trim()) {
          try {
            checkFields(
              node,
              collectConditionFields(parseConditionTree(expression)),
              left,
              diagnostics
            );
          } catch {
            push(
              diagnostics,
              'error',
              node,
              'expectExpressionInvalid',
              `Expect expression is not parseable: ${expression.slice(0, 120)}`
            );
          }
        }
      } else if (kind === 'unique') {
        checkFields(node, strList(config.columns), left, diagnostics);
      }
      return left;
    }
    default:
      return left;
  }
}

function validateJoinNode(
  node: WorkflowPlanNode,
  config: Record<string, unknown>,
  left: PlanSchema,
  right: PlanSchema,
  diagnostics: WorkflowPlanDiagnostic[]
): void {
  const checkSide = (
    value: unknown,
    side: 'left' | 'right',
    diagnostics: WorkflowPlanDiagnostic[]
  ): void => {
    const ref = parseFieldRef(String(value ?? ''));
    if (!ref?.name) return;
    const schema = side === 'left' ? left : right;
    if (!schema.known) return;
    if (!schema.columns.some((column) => column.name === ref.name)) {
      push(
        diagnostics,
        'error',
        node,
        'planFieldNotFound',
        `Join ${side} field "${ref.name}" is not in the ${side} input columns`,
        { field: ref.name }
      );
    }
  };

  const conditions = recordArray(config.conditions);
  for (const condition of conditions) {
    const leftRef = parseFieldRef(String(condition.left ?? ''));
    const rightRef = parseFieldRef(String(condition.right ?? ''));
    checkSide(condition.left, 'left', diagnostics);
    checkSide(condition.right, 'right', diagnostics);
    if (
      condition.operator === '=' &&
      left.known &&
      right.known &&
      leftRef?.name &&
      rightRef?.name
    ) {
      const leftType = left.columns.find((column) => column.name === leftRef.name)?.type;
      const rightType = right.columns.find((column) => column.name === rightRef.name)?.type;
      const leftFamily = planTypeFamily(leftType);
      const rightFamily = planTypeFamily(rightType);
      if (
        leftType &&
        rightType &&
        leftFamily !== 'other' &&
        rightFamily !== 'other' &&
        leftFamily !== rightFamily
      ) {
        push(
          diagnostics,
          'warning',
          node,
          'joinConditionTypeMismatch',
          `Join compares "${leftRef.name}" (${leftType}) with "${rightRef.name}" (${rightType}) across incompatible type families`,
          { field: leftRef.name, leftType, rightType, rightField: rightRef.name }
        );
      }
    }
  }

  const asof = isRecord(config.asof) ? config.asof : undefined;
  if (asof) {
    const leftTime = parseFieldRef(String(asof.leftTime ?? ''))?.name;
    const rightTime = parseFieldRef(String(asof.rightTime ?? ''))?.name;
    checkSide(asof.leftTime, 'left', diagnostics);
    checkSide(asof.rightTime, 'right', diagnostics);
    for (const side of ['left', 'right'] as const) {
      const timeField = side === 'left' ? leftTime : rightTime;
      const schema = side === 'left' ? left : right;
      if (!timeField || !schema.known) continue;
      const type = schema.columns.find((column) => column.name === timeField)?.type;
      if (type && planTypeFamily(type) !== 'temporal') {
        push(
          diagnostics,
          'warning',
          node,
          'asofTimeFieldNotTemporal',
          `ASOF ${side} time field "${timeField}" has type ${type}; temporal types are expected`,
          { field: timeField }
        );
      }
    }
    for (const condition of recordArray(asof.by)) {
      checkSide(condition.left, 'left', diagnostics);
      checkSide(condition.right, 'right', diagnostics);
    }
  }

  for (const item of recordArray(config.keep)) {
    if (item.wildcard === true) continue;
    const ref = parseFieldRef(String(item.source ?? ''));
    if (!ref?.name) continue;
    const leftMatch = left.known && left.columns.some((column) => column.name === ref.name);
    const rightMatch = right.known && right.columns.some((column) => column.name === ref.name);
    if ((left.known || right.known) && !leftMatch && !rightMatch) {
      push(
        diagnostics,
        'error',
        node,
        'planFieldNotFound',
        `Join keep field "${ref.name}" is not in either input's columns`,
        { field: ref.name }
      );
    }
  }
}

function validateSetOpNode(
  node: WorkflowPlanNode,
  config: Record<string, unknown>,
  left: PlanSchema,
  right: PlanSchema,
  diagnostics: WorkflowPlanDiagnostic[]
): void {
  if (!left.known || !right.known) return;
  const match = config.match === 'by_position' ? 'by_position' : 'by_name';
  if (match === 'by_position') {
    if (left.columns.length !== right.columns.length) {
      push(
        diagnostics,
        'error',
        node,
        'setOpColumnCountMismatch',
        `Set operation by position requires equal column counts; left has ${left.columns.length}, right has ${right.columns.length}`,
        { left: left.columns.length, right: right.columns.length }
      );
    }
    return;
  }
  const rightNames = new Set(right.columns.map((column) => column.name));
  const rightByName = new Map(right.columns.map((column) => [column.name, column]));
  for (const column of left.columns) {
    if (!rightNames.has(column.name)) {
      push(
        diagnostics,
        'warning',
        node,
        'setOpColumnMissing',
        `Right input has no column "${column.name}"; it will be filled with null`,
        { field: column.name }
      );
      continue;
    }
    const leftFamily = planTypeFamily(column.type);
    const rightType = rightByName.get(column.name)?.type;
    const rightFamily = planTypeFamily(rightType);
    if (
      column.type &&
      rightType &&
      leftFamily !== 'other' &&
      rightFamily !== 'other' &&
      leftFamily !== rightFamily
    ) {
      push(
        diagnostics,
        'warning',
        node,
        'setOpTypeMismatch',
        `Column "${column.name}" has type ${column.type} on the left but ${rightType} on the right`,
        { field: column.name, leftType: column.type, rightType }
      );
    }
  }
}

function collectConditionFields(node: FilterConditionNode): string[] {
  if (node.kind === 'leaf') return node.field ? [node.field] : [];
  return node.items.flatMap(collectConditionFields);
}

function checkFields(
  node: WorkflowPlanNode,
  fields: string[],
  schema: PlanSchema,
  diagnostics: WorkflowPlanDiagnostic[],
  context?: string
): void {
  if (!schema.known) return;
  const available = new Set(schema.columns.map((column) => column.name));
  for (const field of fields) {
    const ref = parseFieldRef(field);
    const name = ref?.name ?? field;
    if (!name || available.has(name)) continue;
    push(
      diagnostics,
      'error',
      node,
      'planFieldNotFound',
      context === 'expression'
        ? `Expression references field "${name}" which is not in the upstream columns`
        : `Field "${name}" is not in the upstream columns`,
      { field: name }
    );
  }
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function strArray(value: unknown, key: string): string[] {
  return recordArray(value)
    .map((item) => item[key])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function push(
  diagnostics: WorkflowPlanDiagnostic[],
  severity: WorkflowPlanDiagnostic['severity'],
  node: WorkflowPlanNode,
  code: string,
  message: string,
  params?: Record<string, string | number>
): void {
  diagnostics.push({
    severity,
    code,
    message,
    params: { ...(params ?? {}), nodeId: node.id, nodeType: node.type },
    nodeId: node.id,
    nodeType: node.type,
  });
}
