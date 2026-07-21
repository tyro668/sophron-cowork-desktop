/**
 * Runtime source for the build-only Workflow SDK injected into the V8 sandbox.
 * It never reads real data: SDK calls only append stable, language-neutral IR operations.
 */
export const WORKFLOW_SDK_VERSION = '1.0.0';

export const WORKFLOW_SDK_RUNTIME_SOURCE = String.raw`
const freeze = value => Object.freeze(value);
const expression = value => freeze(value);
const literal = value => expression({ kind: 'literal', value });
const asExpression = value => value && typeof value === 'object' && value.__expression
  ? value.__expression
  : literal(value);
const wrapExpression = ir => {
  const api = Object.create(null);
  Object.defineProperty(api, '__expression', { value: ir, enumerable: false });
  for (const [name, op] of Object.entries({
    eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
    contains: 'contains', notContains: 'not_contains', add: '+', sub: '-', mul: '*', div: '/'
  })) {
    api[name] = value => wrapExpression(expression({
      kind: 'binary', op, left: ir, right: asExpression(value)
    }));
  }
  api.isNull = () => wrapExpression(expression({ kind: 'unary', op: 'is_null', value: ir }));
  api.isNotNull = () => wrapExpression(expression({ kind: 'unary', op: 'is_not_null', value: ir }));
  return freeze(api);
};
const requireWorkflow = value => {
  if (!value || value.__workflow !== true) {
    const error = new TypeError('First argument must be a WorkflowValue');
    error.code = 'INVALID_WORKFLOW_INPUT';
    throw error;
  }
};
const unwrap = value => value && value.__expression ? value.__expression : value;
const deepUnwrap = value => {
  if (Array.isArray(value)) return value.map(deepUnwrap);
  if (value && value.__metric) {
    return { fn: value.fn, expression: value.expression, alias: value.alias };
  }
  if (value && value.__expression) return value.__expression;
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const key of Object.keys(value)) result[key] = deepUnwrap(value[key]);
    return result;
  }
  return value;
};
const stackLocation = () => {
  const stack = String(new Error().stack || '').split('\n');
  for (const line of stack) {
    const match = line.match(/at\s+(?:([^\s(]+)\s+\()?generated-workflow\.js:(\d+):(\d+)\)?/);
    if (match) {
      return {
        functionName: match[1] || 'main',
        line: Number(match[2]),
        column: Number(match[3]),
        start: 0,
        end: 0
      };
    }
  }
  return { functionName: 'main', line: 1, column: 1, start: 0, end: 0 };
};
const slug = value => String(value || 'operation')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'operation';
const operationIdCounts = new Map();
const stableOperationId = (type, location) => {
  const base = slug(location.functionName === 'main'
    ? type
    : location.functionName);
  const count = (operationIdCounts.get(base) || 0) + 1;
  operationIdCounts.set(base, count);
  return count === 1 ? base : base + '-' + count;
};
const workflowValue = nodeId => {
  const value = Object.assign(Object.create(null), { __workflow: true, __nodeId: nodeId });
  for (const name of [
    'filter', 'sort', 'drop', 'select', 'rename', 'derive', 'cast', 'aggregate',
    'deduplicate', 'handleMissing', 'limit', 'top', 'pivot', 'unpivot', 'unnest',
    'inputDataset', 'outputTable'
  ]) {
    value[name] = (...args) => sdk[name](value, ...args);
  }
  return freeze(value);
};
const add = (type, input, fields) => {
  requireWorkflow(input);
  const location = stackLocation();
  const operationId = stableOperationId(type, location);
  operations.push({ operationId, type, inputOperationId: input.__nodeId, ...deepUnwrap(fields) });
  provenance.push({ operationId, language: 'javascript', source: location });
  return workflowValue(operationId);
};
const unaryOperation = (type, mapper) => (input, ...args) => add(type, input, mapper(...args));
const sdk = Object.create(null);
sdk.INPUT_TABLE_ID = payload.inputTableId;
sdk.OUTPUT_TABLE_NAME = payload.outputTableName;
sdk.workflow = () => workflowValue('input');
sdk.inputDataset = () => { inputSeen = true; return workflowValue('input'); };
sdk.outputTable = input => {
  requireWorkflow(input);
  outputSeen = true;
  outputOperationId = input.__nodeId;
  return input;
};
sdk.drop = unaryOperation('drop', columns => ({ columns: Array.isArray(columns) ? columns : [columns] }));
sdk.select = unaryOperation('select', columns => ({ columns }));
sdk.rename = unaryOperation('rename', (source, target) => ({ source, target }));
sdk.filter = unaryOperation('filter', condition => ({ condition: unwrap(condition) }));
sdk.sort = unaryOperation('sort', (column, direction) => ({ column: unwrap(column), direction }));
sdk.derive = unaryOperation('derive', (column, value) => ({ column, expression: unwrap(value) }));
sdk.cast = unaryOperation('convert_type', (column, targetType, options = {}) => ({ column, targetType, options }));
sdk.aggregate = unaryOperation('aggregate', config => config);
sdk.deduplicate = unaryOperation('deduplicate', config => ({
  config: { columns: config.by || config.columns || [], keep: config.keep || 'first', orderBy: config.orderBy || [] }
}));
sdk.handleMissing = unaryOperation('missing_value', config => ({
  config: config.strategy === 'drop_empty_rows'
    ? config
    : { strategy: 'by_column', rules: config.rules || [] }
}));
sdk.limit = unaryOperation('limit', config => ({
  config: typeof config === 'number'
    ? { mode: 'limit', limit: config, unit: 'rows', offset: 0, orderBy: [] }
    : { mode: 'limit', limit: config.count, unit: config.unit || 'rows', offset: config.offset || 0, orderBy: config.orderBy || [] }
}));
sdk.top = unaryOperation('limit', (count, orderBy) => ({
  config: { mode: 'top', limit: count, unit: 'rows', offset: 0, orderBy: orderBy || [] }
}));
sdk.pivot = unaryOperation('pivot', config => ({ config }));
sdk.unpivot = unaryOperation('unpivot', config => ({
  config: {
    mode: config.except ? 'except' : 'columns',
    columns: config.except || config.columns || [],
    nameColumn: config.nameColumn,
    valueColumn: config.valueColumn,
    includeNulls: Boolean(config.includeNulls)
  }
}));
sdk.unnest = unaryOperation('unnest', config => ({
  config: { recursive: false, keepParentNames: false, ...config }
}));
sdk.col = name => wrapExpression(expression({ kind: 'column', name }));
sdk.lit = value => wrapExpression(literal(value));
sdk.fn = freeze(Object.fromEntries([
  'regexpExtract', 'year', 'month', 'upper', 'lower', 'trim', 'replace', 'concat'
].map(name => [name, (...args) => wrapExpression(expression({
  kind: 'function', name, args: args.map(asExpression)
}))])));
const metricFactory = name => value => {
  const result = Object.create(null);
  result.as = alias => freeze({
    __metric: true,
    fn: name,
    expression: value === undefined ? '*' : asExpression(value),
    alias
  });
  return freeze(result);
};
sdk.metric = freeze(Object.fromEntries([
  'sum', 'avg', 'min', 'max', 'count', 'countDistinct'
].map(name => [name, metricFactory(name)])));
sdk.__finish = value => { mainResult = value; };
`;
