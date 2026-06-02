import type { PrepOperatorType } from './ast';

export interface PrepFlowNodeLike {
  id: string;
  type: PrepOperatorType;
  config?: Record<string, unknown>;
}

export interface PrepFlowEdgeLike {
  sourceNodeId: string;
  targetNodeId: string;
  targetHandle?: string | null;
}

export function exportPrepWorkflowDsl(
  nodes: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): string {
  const sources = nodes.filter((node) => node.type === 'input_source');
  const operators = nodes.filter((node) => node.type !== 'input_source');
  const sourceLines = sources.map((source) => source.config?.dsl).filter(isString);
  const mainSource = inferMainSource(sources, operators, edges);
  const operatorLines = operators.map((operator) => formatOperator(operator)).filter(isString);

  if (sources.length > 1) {
    return [...sourceLines, '', `from ${mainSource}`, ...operatorLines.map((line) => `  | ${line}`)]
      .join('\n')
      .trim();
  }

  const firstSource = sourceLines[0] ?? 'input source task';
  return [firstSource, ...operatorLines.map((line) => `  | ${line}`)].join('\n').trim();
}

export function exportPrepOperatorDsl(node: PrepFlowNodeLike): string {
  return formatOperator(node) ?? '';
}

function inferMainSource(
  sources: PrepFlowNodeLike[],
  operators: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): string {
  const firstOperator = operators.find((operator) => operator.type !== 'output');
  const sourceId =
    firstOperator &&
    edges.find(
      (edge) =>
        edge.targetNodeId === firstOperator.id &&
        (((firstOperator.type === 'join' || firstOperator.type === 'set_op') &&
          edge.targetHandle === 'left') ||
          (firstOperator.type !== 'join' &&
            firstOperator.type !== 'set_op' &&
            (edge.targetHandle ?? 'input') === 'input'))
    )?.sourceNodeId;
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];
  return getAlias(source) ?? 'source';
}

function formatOperator(node: PrepFlowNodeLike): string | null {
  if (typeof node.config?.dsl === 'string') return node.config.dsl;
  switch (node.type) {
    case 'filter':
      return `filter ${String(node.config?.condition ?? 'true')}`;
    case 'field_select':
      return formatFieldSelect(node.config);
    case 'missing_value':
      return formatMissingValue(node.config);
    case 'type_convert':
      return formatTypeConvert(node.config);
    case 'field_mapping':
      return formatFieldMapping(node.config);
    case 'sort':
      return formatSort(node.config);
    case 'deduplicate':
      return formatDeduplicate(node.config);
    case 'aggregate':
      return formatAggregate(node.config);
    case 'calculate_field':
      return formatCalculateField(node.config);
    case 'join':
      return formatJoin(node.config);
    case 'limit':
      return formatLimit(node.config);
    case 'pivot':
      return formatPivot(node.config);
    case 'unpivot':
      return formatUnpivot(node.config);
    case 'set_op':
      return formatSetOp(node.config);
    case 'unnest':
      return formatUnnest(node.config);
    case 'output':
      return `output table "${String(node.config?.table ?? 'clean_result')}" mode ${String(
        node.config?.mode ?? 'replace'
      )}`;
    default:
      return null;
  }
}

function formatFieldSelect(config: Record<string, unknown> | undefined): string {
  const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
  return `${config?.mode === 'exclude' ? 'drop' : 'select'} ${columns || '[field]'}`;
}

function formatTypeConvert(config: Record<string, unknown> | undefined): string {
  const conversions = objectArray(config?.conversions);
  if (conversions.length === 0) return 'cast [field] as string';
  return `cast ${conversions
    .map((item) => {
      const options = [
        typeof item.format === 'string' ? `format ${quoteString(item.format)}` : '',
        typeof item.onError === 'string' ? `on_error ${item.onError}` : '',
        typeof item.locale === 'string' ? `locale ${quoteString(item.locale)}` : '',
        typeof item.timezone === 'string' ? `timezone ${quoteString(item.timezone)}` : '',
      ].filter(Boolean);
      return `${formatFieldRef(String(item.column ?? 'field'))} as ${String(item.type ?? 'string')}${
        options.length > 0 ? ` ${options.join(' ')}` : ''
      }`;
    })
    .join(', ')}`;
}

function formatFieldMapping(config: Record<string, unknown> | undefined): string {
  const mappings = objectArray(config?.mappings);
  if (mappings.length === 0) return 'map [source_field] to [target_field]';
  return `map ${mappings
    .map(
      (item) =>
        `${formatFieldRef(String(item.source ?? 'source_field'))} to ${formatFieldRef(
          String(item.target ?? 'target_field')
        )}`
    )
    .join(', ')}`;
}

function formatMissingValue(config: Record<string, unknown> | undefined): string {
  if (config?.strategy === 'drop_empty_rows') return 'missing value row drop when all_null';
  if (config?.strategy === 'drop_rows_by_nulls') {
    return `missing value row drop when ${String(config.condition ?? 'any_null')}`;
  }
  const rules = objectArray(config?.rules).map((rule) => formatMissingRule(rule));
  return `missing value ${rules.join(', ') || '[field] skip'}`;
}

function formatMissingRule(rule: Record<string, unknown>): string {
  const column = formatFieldRef(String(rule.column ?? 'field'));
  const method = String(rule.method ?? 'skip');
  if (method === 'skip') return `${column} skip`;
  if (method === 'drop') return `${column} drop rows`;
  if (method === 'nullify_values') {
    const values = Array.isArray(rule.values) ? rule.values : [];
    return `${column} nullify values (${values.map(literalToDsl).join(', ')})`;
  }
  const fillMethods: Record<string, string> = {
    forward_fill: 'forward',
    backward_fill: 'backward',
    mean_fill: 'mean',
    median_fill: 'median',
    mode_fill: 'mode',
  };
  if (method in fillMethods) return `${column} fill ${fillMethods[method]}`;
  return `${column} fill ${literalToDsl(rule.value ?? null)}`;
}

function formatSort(config: Record<string, unknown> | undefined): string {
  const keys = formatSortKeys(config?.keys);
  return `sort by ${keys || '[field] asc'}`;
}

function formatDeduplicate(config: Record<string, unknown> | undefined): string {
  const parts = ['deduplicate'];
  const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
  if (columns) parts.push(`by ${columns}`);
  if (typeof config?.keep === 'string') parts.push(`keep ${config.keep}`);
  const orderBy = formatSortKeys(config?.orderBy);
  if (orderBy) parts.push(`order by ${orderBy}`);
  return parts.join(' ');
}

function formatCalculateField(config: Record<string, unknown> | undefined): string {
  const calculations = objectArray(config?.calculations).map(
    (item) =>
      `${formatFieldRef(String(item.field ?? 'new_field'))} = ${String(item.expression ?? 'null')}`
  );
  return `derive ${calculations.join(', ') || '[new_field] = null'}`;
}

function formatAggregate(config: Record<string, unknown> | undefined): string {
  const groupBy = stringArray(config?.groupBy).map(formatFieldRef).join(', ');
  const metrics = objectArray(config?.metrics).map(
    (item) =>
      `${String(item.function ?? 'count')}(${String(item.expression ?? '*')}) as ${formatFieldRef(
        String(item.alias ?? 'row_count')
      )}`
  );
  return `aggregate ${groupBy ? `by ${groupBy}` : 'all'} metrics ${
    metrics.join(', ') || 'count(*) as [row_count]'
  }`;
}

function formatJoin(config: Record<string, unknown> | undefined): string {
  const joinType = String(config?.joinType ?? 'left');
  const rightInput = String(config?.rightInput ?? 'right_source');
  if (joinType === 'asof') {
    const asof = objectValue(config?.asof);
    const parts = [
      `join asof ${rightInput} on ${formatFieldRef(String(asof?.leftTime ?? 'left.time'))} ${String(
        asof?.operator ?? '>='
      )} ${formatFieldRef(String(asof?.rightTime ?? `${rightInput}.time`))}`,
    ];
    const by = formatJoinConditions(asof?.by);
    if (by) parts.push(`by ${by}`);
    if (typeof asof?.direction === 'string') parts.push(`direction ${asof.direction}`);
    if (typeof asof?.tolerance === 'string') parts.push(`tolerance ${asof.tolerance}`);
    const keep = formatJoinKeep(config?.keep);
    if (keep) parts.push(`keep ${keep}`);
    if (typeof config?.cardinality === 'string') parts.push(`expect ${config.cardinality}`);
    return parts.join(' ');
  }
  const parts = [`join ${joinType} ${rightInput}`];
  const conditions = formatJoinConditions(config?.conditions);
  if (joinType !== 'cross') parts.push(`on ${conditions || '[left].[id] = [right_source].[id]'}`);
  const keep = formatJoinKeep(config?.keep);
  if (keep) parts.push(`keep ${keep}`);
  if (typeof config?.cardinality === 'string') parts.push(`expect ${config.cardinality}`);
  return parts.join(' ');
}

function formatLimit(config: Record<string, unknown> | undefined): string {
  const limit = Number(config?.limit ?? 100);
  if (config?.mode === 'top') {
    return `top ${limit} by ${formatSortKeys(config?.orderBy) || '[field] desc'}`;
  }
  const unit = config?.unit === 'percent' ? ' percent' : '';
  const offset = typeof config?.offset === 'number' ? ` offset ${config.offset}` : '';
  return `limit ${limit}${unit}${offset}`;
}

function formatPivot(config: Record<string, unknown> | undefined): string {
  const on = stringArray(config?.on).map(formatFieldRef).join(', ') || '[field]';
  const values = Array.isArray(config?.values) && config.values.length > 0
    ? ` in (${config.values.map(literalToDsl).join(', ')})`
    : '';
  const using =
    objectArray(config?.using)
      .map(formatMetric)
      .join(', ') || 'count(*)';
  const groupBy = stringArray(config?.groupBy).map(formatFieldRef).join(', ');
  return `pivot on ${on}${values} using ${using}${groupBy ? ` group by ${groupBy}` : ''}`;
}

function formatUnpivot(config: Record<string, unknown> | undefined): string {
  const includeNulls = config?.includeNulls ? 'include nulls ' : '';
  const mode = config?.mode === 'except' ? 'columns except ' : '';
  const columns = stringArray(config?.columns).map(formatFieldRef).join(', ') || '[field]';
  const nameColumn = formatFieldRef(String(config?.nameColumn ?? 'name'));
  const valueColumn = formatFieldRef(String(config?.valueColumn ?? 'value'));
  return `unpivot ${includeNulls}${mode}${columns} into name ${nameColumn} value ${valueColumn}`;
}

function formatSetOp(config: Record<string, unknown> | undefined): string {
  const operation = String(config?.operation ?? 'union');
  const rightInput = String(config?.rightInput ?? 'right_source');
  const mode = typeof config?.mode === 'string' ? ` mode ${config.mode}` : '';
  const match =
    operation === 'union'
      ? ` by ${config?.match === 'by_name' ? 'name' : 'position'}`
      : '';
  return `${operation} ${rightInput}${mode}${match}`;
}

function formatUnnest(config: Record<string, unknown> | undefined): string {
  const column = formatFieldRef(String(config?.column ?? 'items'));
  const alias = formatFieldRef(String(config?.alias ?? 'item'));
  const withIndex =
    typeof config?.withIndex === 'string' ? ` with index ${formatFieldRef(config.withIndex)}` : '';
  const recursive = config?.recursive ? ' recursive true' : '';
  const maxDepth = typeof config?.maxDepth === 'number' ? ` max_depth ${config.maxDepth}` : '';
  const keepParentNames = config?.keepParentNames ? ' keep parent names true' : '';
  if (config?.sourceKind === 'json') {
    return `explode json ${column} path ${quoteString(String(config.path ?? '$'))} as ${alias}${withIndex}${recursive}${maxDepth}${keepParentNames}`;
  }
  return `unnest ${column} as ${alias}${withIndex}${recursive}${maxDepth}${keepParentNames}`;
}

function formatMetric(item: Record<string, unknown>): string {
  const alias = typeof item.alias === 'string' ? ` as ${formatFieldRef(item.alias)}` : '';
  return `${String(item.function ?? 'count')}(${String(item.expression ?? '*')})${alias}`;
}

function formatSortKeys(value: unknown): string {
  return objectArray(value)
    .map((key) => {
      const nulls = typeof key.nulls === 'string' ? ` nulls ${key.nulls}` : '';
      return `${formatFieldRef(String(key.field ?? 'field'))} ${String(key.direction ?? 'asc')}${nulls}`;
    })
    .join(', ');
}

function formatJoinConditions(value: unknown): string {
  return objectArray(value)
    .map(
      (condition) =>
        `${formatFieldRef(String(condition.left ?? 'left.id'))} = ${formatFieldRef(
          String(condition.right ?? 'right.id')
        )}`
    )
    .join(' and ');
}

function formatJoinKeep(value: unknown): string {
  return objectArray(value)
    .map((item) => {
      if (item.wildcard) return `${String(item.side ?? 'left')} *`;
      const alias = typeof item.alias === 'string' ? ` as ${formatFieldRef(item.alias)}` : '';
      return `${formatFieldRef(String(item.source ?? 'right.field'))}${alias}`;
    })
    .join(', ');
}

function formatFieldRef(value: string): string {
  const parts = value.split('.');
  if (parts.length === 2) return `${formatFieldName(parts[0])}.${formatFieldName(parts[1])}`;
  return formatFieldName(value);
}

function formatFieldName(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? `[${value}]`
    : `[\`${value.replace(/`/g, '\\`')}\`]`;
}

function literalToDsl(value: unknown): string {
  if (typeof value === 'string') return quoteString(value);
  if (value === null) return 'null';
  return String(value);
}

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getAlias(node: PrepFlowNodeLike | undefined): string | null {
  const alias = node?.config?.alias;
  return typeof alias === 'string' ? alias : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}
