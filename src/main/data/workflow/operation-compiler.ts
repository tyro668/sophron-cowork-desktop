import { DataCommandError } from '../data-command-types';
import {
  DSL_FIELD_REF_TOKEN_PATTERN,
  DSL_STRING_LITERAL_PATTERN,
  escapeDslString,
  extractFieldNamesFromExpression,
  findDslBacktickFieldEnd,
  formatDslField,
  isRecord,
  literalToDsl,
  normalizeDslTypeName,
  normalizeRequiredName,
  unescapeDslBacktickField,
} from './utils';

import type {
  GeneratedWorkflowColumnBinding,
  GeneratedWorkflowGenerationResult,
  GeneratedWorkflowRequiredColumnResolver,
} from './types';
export type {
  GeneratedWorkflowColumnBinding,
  GeneratedWorkflowGenerationResult,
  GeneratedWorkflowRequiredColumnResolver,
} from './types';

export class ColumnStateTracker {
  private readonly columnsByName = new Map<string, GeneratedWorkflowColumnBinding>();

  constructor(
    columns: Array<{ name: string; type?: string }> | GeneratedWorkflowColumnBinding[],
    private readonly normalizeName: (name: string) => string = (name) => name.trim()
  ) {
    for (const column of columns) {
      const normalized = this.normalizeName(column.name);
      if (!normalized) continue;
      this.columnsByName.set(normalized.toLowerCase(), {
        ...column,
        name: normalized,
        sourceColumn:
          'sourceColumn' in column ? column.sourceColumn : { name: column.name, type: column.type },
        sourceColumns:
          'sourceColumns' in column
            ? sourceColumnsFromBinding(column)
            : [{ name: column.name, type: column.type }],
      });
    }
  }

  requireColumn(
    name: unknown,
    context = 'operation',
    missingMessage = `Generated workflow ${context} is missing an input column`,
    unknownMessage = (columnName: string) =>
      `Generated workflow ${context} references unknown input column: ${columnName}`
  ): GeneratedWorkflowColumnBinding {
    const normalized = typeof name === 'string' ? this.normalizeName(name) : '';
    if (!normalized) {
      throw new DataCommandError('VALIDATION_FAILED', missingMessage);
    }
    const column = this.columnsByName.get(normalized.toLowerCase());
    if (!column) {
      throw new DataCommandError('VALIDATION_FAILED', unknownMessage(String(name)));
    }
    return column;
  }

  findColumn(name: string): GeneratedWorkflowColumnBinding | undefined {
    const normalized = this.normalizeName(name);
    return normalized ? this.columnsByName.get(normalized.toLowerCase()) : undefined;
  }

  renameColumn(sourceName: string, targetName: string): void {
    const source = this.findColumn(sourceName);
    const normalizedTarget = this.normalizeName(targetName);
    if (!source || !normalizedTarget) return;
    this.columnsByName.delete(this.normalizeName(sourceName).toLowerCase());
    this.columnsByName.set(normalizedTarget.toLowerCase(), {
      name: normalizedTarget,
      type: source.type,
      sourceColumn: source.sourceColumn,
      sourceColumns: sourceColumnsFromBinding(source),
      expression: source.expression,
    });
  }

  upsertColumn(column: GeneratedWorkflowColumnBinding): void {
    const normalized = this.normalizeName(column.name);
    if (!normalized) return;
    this.columnsByName.set(normalized.toLowerCase(), {
      ...column,
      name: normalized,
      sourceColumns: sourceColumnsFromBinding(column),
    });
  }

  removeColumn(name: string): void {
    const normalized = this.normalizeName(name);
    if (!normalized) return;
    this.columnsByName.delete(normalized.toLowerCase());
  }

  keepColumns(names: string[]): void {
    const kept = new Map<string, GeneratedWorkflowColumnBinding>();
    for (const name of names) {
      const column = this.findColumn(name);
      if (column) kept.set(column.name.toLowerCase(), column);
    }
    this.replaceMap(kept);
  }

  replaceColumns(columns: GeneratedWorkflowColumnBinding[]): void {
    const replacement = new Map<string, GeneratedWorkflowColumnBinding>();
    for (const column of columns) {
      const normalized = this.normalizeName(column.name);
      if (!normalized) continue;
      replacement.set(normalized.toLowerCase(), {
        ...column,
        name: normalized,
        sourceColumns: sourceColumnsFromBinding(column),
      });
    }
    this.replaceMap(replacement);
  }

  getCurrentColumns(): GeneratedWorkflowColumnBinding[] {
    return [...this.columnsByName.values()];
  }

  asMap(): Map<string, GeneratedWorkflowColumnBinding> {
    return this.columnsByName;
  }

  private replaceMap(columns: Map<string, GeneratedWorkflowColumnBinding>): void {
    this.columnsByName.clear();
    for (const [key, column] of columns) {
      this.columnsByName.set(key, column);
    }
  }
}

interface GeneratedWorkflowOperationCompileContext {
  columns: Array<{ name: string; type?: string }>;
  lines: string[];
  requirement: string;
  requireColumn: GeneratedWorkflowRequiredColumnResolver;
  normalizeExpression: (expression: string) => string;
  inferExpression: (expression: string, context: string) => GeneratedWorkflowColumnBinding;
  assertComparableFilter: (
    left: GeneratedWorkflowColumnBinding,
    operator: string,
    right: GeneratedWorkflowColumnBinding | unknown,
    context: string
  ) => void;
  renameColumn: (sourceName: string, targetName: string) => void;
  upsertColumn: (column: GeneratedWorkflowColumnBinding) => void;
  removeColumn: (name: string) => void;
  keepColumns: (names: string[]) => void;
  replaceColumns: (columns: GeneratedWorkflowColumnBinding[]) => void;
  getCurrentColumns: () => GeneratedWorkflowColumnBinding[];
}

interface GeneratedWorkflowOperationDefinition {
  compile: (
    operation: Record<string, unknown> & { type: string },
    context: GeneratedWorkflowOperationCompileContext
  ) => void;
}

const GENERATED_WORKFLOW_OPERATION_REGISTRY: Record<string, GeneratedWorkflowOperationDefinition> =
  {
    filter: {
      compile(operation, context) {
        const column = context.requireColumn(columnNameFromPlan(operation), 'filter.column');
        const operator = normalizePlanFilterOperator(operation.operator);
        const field = formatDslField(column.name);
        const rightColumnName = resolvePlanFilterRightColumnName(operation);
        const rightColumn = rightColumnName
          ? context.requireColumn(rightColumnName, 'filter.rightColumn')
          : null;
        context.assertComparableFilter(
          column,
          operator,
          rightColumn ?? operation.value,
          'filter.condition'
        );
        const condition =
          operator === 'is_null' || operator === 'is_not_null'
            ? `${field} ${operator === 'is_null' ? 'IS NULL' : 'IS NOT NULL'}`
            : operator === 'contains' || operator === 'not_contains'
              ? `${operator === 'not_contains' ? 'NOT ' : ''}contains(CAST(${field} AS VARCHAR), ${literalToDsl(operation.value)})`
              : rightColumn
                ? `${field} ${operator} ${formatDslField(rightColumn.name)}`
                : `${field} ${operator} ${literalToDsl(operation.value)}`;
        context.lines.push(`  | filter ${condition}`);
      },
    },
    sort: {
      compile(operation, context) {
        const column = context.requireColumn(
          columnNameFromPlan(operation) ||
            inferColumnNameFromRequirement(context.requirement, context.columns, 'sort'),
          'sort.column'
        );
        const direction = normalizePlanSortDirection(operation.direction ?? operation.order);
        context.lines.push(`  | sort by ${formatDslField(column.name)} ${direction}`);
      },
    },
    convert_type: {
      compile(operation, context) {
        const column = context.requireColumn(columnNameFromPlan(operation), 'convert_type.column');
        const targetType = normalizePlanTargetType(operation.targetType);
        const onError = operation.onError === 'fail' ? 'fail' : 'null';
        const removeChars = Array.isArray(operation.removeChars)
          ? operation.removeChars.filter((value): value is string => typeof value === 'string')
          : [];
        const removePrefix =
          typeof operation.removePrefix === 'string' && operation.removePrefix
            ? operation.removePrefix
            : inferPlanConversionRemovePrefixFromRequirement(
                column.name,
                targetType,
                context.requirement
              );
        const convertedColumn: GeneratedWorkflowColumnBinding = {
          name: column.name,
          type: targetType,
          sourceColumn: column.sourceColumn,
          sourceColumns: sourceColumnsFromBinding(column),
        };
        if (removePrefix || removeChars.length > 0 || operation.scale !== undefined) {
          const tempColumn = createGeneratedTemporaryColumnName(
            column.name,
            context.getCurrentColumns()
          );
          const expression = compilePlanTypeConversionExpression({
            columnName: column.name,
            targetType,
            removePrefix,
            removeChars,
            scale: operation.scale,
          });
          context.lines.push(`  | derive ${formatDslField(tempColumn)} = ${expression}`);
          context.lines.push(`  | drop ${formatDslField(column.name)}`);
          context.lines.push(
            `  | map ${formatDslField(tempColumn)} to ${formatDslField(column.name)}`
          );
          context.removeColumn(column.name);
          context.upsertColumn(convertedColumn);
        } else {
          context.lines.push(
            `  | cast ${formatDslField(column.name)} as ${targetType} on_error ${onError}`
          );
          context.upsertColumn(convertedColumn);
        }
      },
    },
    select: {
      compile(operation, context) {
        const rawSelected = columnListFromPlan(operation);
        const inferredDropped = inferDroppedColumnsFromSelectOperation(rawSelected, context);
        if (inferredDropped.length > 0) {
          const dropped = inferredDropped.map(
            (name) => context.requireColumn(name, 'drop.columns').name
          );
          context.lines.push(`  | drop ${dropped.map(formatDslField).join(', ')}`);
          dropped.forEach((name) => context.removeColumn(name));
          return;
        }
        const selected = rawSelected.map(
          (name) => context.requireColumn(name, 'select.columns').name
        );
        if (selected.length > 0) {
          context.lines.push(`  | select ${selected.map(formatDslField).join(', ')}`);
          context.keepColumns(selected);
        }
      },
    },
    drop: {
      compile(operation, context) {
        const dropped = columnListFromPlan(operation).map(
          (name) => context.requireColumn(name, 'drop.columns').name
        );
        if (dropped.length > 0) {
          context.lines.push(`  | drop ${dropped.map(formatDslField).join(', ')}`);
          dropped.forEach((name) => context.removeColumn(name));
        }
      },
    },
    rename: {
      compile(operation, context) {
        const source = context.requireColumn(
          operation.source ?? columnNameFromPlan(operation),
          'rename.source'
        );
        const target = normalizeRequiredName(
          typeof operation.target === 'string' ? operation.target : '',
          'Generated rename operation requires target'
        );
        context.lines.push(`  | map ${formatDslField(source.name)} to ${formatDslField(target)}`);
        context.renameColumn(source.name, target);
      },
    },
    derive: {
      compile(operation, context) {
        const column = normalizeRequiredName(
          typeof operation.column === 'string' ? operation.column : '',
          'Generated derive operation requires column'
        );
        const expression = normalizeRequiredName(
          typeof operation.expression === 'string' ? operation.expression : '',
          'Generated derive operation requires expression'
        );
        const inferredColumn = {
          ...context.inferExpression(expression, 'derive.expression'),
          name: column,
          expression,
        };
        const existingColumn = context
          .getCurrentColumns()
          .find((currentColumn) => currentColumn.name.toLowerCase() === column.toLowerCase());
        if (existingColumn) {
          const tempColumn = createGeneratedTemporaryColumnName(
            column,
            context.getCurrentColumns()
          );
          context.lines.push(
            `  | derive ${formatDslField(tempColumn)} = ${context.normalizeExpression(expression)}`
          );
          context.lines.push(`  | drop ${formatDslField(existingColumn.name)}`);
          context.lines.push(
            `  | map ${formatDslField(tempColumn)} to ${formatDslField(existingColumn.name)}`
          );
          context.removeColumn(existingColumn.name);
          context.upsertColumn({
            ...inferredColumn,
            name: existingColumn.name,
          });
          return;
        }
        context.lines.push(
          `  | derive ${formatDslField(column)} = ${context.normalizeExpression(expression)}`
        );
        context.upsertColumn(inferredColumn);
      },
    },
    aggregate: {
      compile(operation, context) {
        const groupBy = stringArrayFromPlan(operation.groupBy).map((name) =>
          context.requireColumn(name, 'aggregate.groupBy')
        );
        const metrics = Array.isArray(operation.metrics)
          ? operation.metrics
              .filter(isRecord)
              .map((metric) => compilePlanAggregateMetric(metric, context.requireColumn))
          : [];
        if (metrics.length === 0) {
          throw new DataCommandError(
            'VALIDATION_FAILED',
            'Generated aggregate operation requires metrics'
          );
        }
        context.lines.push(
          `  | aggregate ${
            groupBy.length > 0
              ? `by ${groupBy.map((column) => formatDslField(column.name)).join(', ')}`
              : 'all'
          } metrics ${metrics.map((metric) => metric.dsl).join(', ')}`
        );
        context.replaceColumns([
          ...groupBy.map((column) => ({
            name: column.name,
            type: column.type,
            sourceColumn: column,
            sourceColumns: sourceColumnsFromBinding(column),
          })),
          ...metrics.map((metric) => ({
            name: metric.alias,
            type: metric.type,
            sourceColumns: metric.sourceColumns,
          })),
        ]);
      },
    },
  };

export function compileGeneratedWorkflowPlan({
  operations,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  operations: unknown[];
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): GeneratedWorkflowGenerationResult {
  const columnTracker = new ColumnStateTracker(columns);
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  const requireColumn = (name: unknown, context = 'operation'): GeneratedWorkflowColumnBinding => {
    const column = columnTracker.requireColumn(name, context);
    for (const sourceColumn of sourceColumnsFromBinding(column)) {
      requiredColumnsByName.set(sourceColumn.name.toLowerCase(), sourceColumn);
    }
    return column;
  };
  const lines = [`input source dataset "${escapeDslString(inputTableId)}" as src`];
  const context: GeneratedWorkflowOperationCompileContext = {
    columns,
    lines,
    requirement,
    requireColumn,
    normalizeExpression: (expression) =>
      normalizeGeneratedPlanExpression(expression, columnTracker.asMap()),
    inferExpression: (expression, context) =>
      inferGeneratedExpressionBinding(expression, columnTracker.asMap(), context),
    assertComparableFilter: assertGeneratedFilterComparable,
    renameColumn: (sourceName, targetName) => columnTracker.renameColumn(sourceName, targetName),
    upsertColumn: (column) => columnTracker.upsertColumn(column),
    removeColumn: (name) => columnTracker.removeColumn(name),
    keepColumns: (names) => columnTracker.keepColumns(names),
    replaceColumns: (columns) => columnTracker.replaceColumns(columns),
    getCurrentColumns: () => columnTracker.getCurrentColumns(),
  };
  for (const rawOperationInput of operations) {
    const rawOperation = normalizeGeneratedWorkflowOperation(rawOperationInput);
    const compiler = GENERATED_WORKFLOW_OPERATION_REGISTRY[rawOperation.type];
    if (!compiler) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow uses unsupported operation: ${rawOperation.type}`
      );
    }
    compiler.compile(rawOperation, context);
  }
  lines.push(`  | output table "${escapeDslString(outputTableName)}" mode replace`);
  const outputColumns = columnTracker.getCurrentColumns();
  return {
    workflowDsl: lines.join('\n'),
    requiredColumns: [...requiredColumnsByName.values()],
    expectedOutputSchema: outputColumns.map(toAutomationColumnSnapshot),
    lineage: outputColumns.map(toAutomationLineageEntry),
  };
}

function normalizeGeneratedWorkflowOperation(operation: unknown): Record<string, unknown> & {
  type: string;
} {
  if (!isRecord(operation) || typeof operation.type !== 'string' || !operation.type.trim()) {
    throw new DataCommandError('VALIDATION_FAILED', 'Generated workflow has invalid operation');
  }
  const fields = isRecord(operation.fields) ? operation.fields : {};
  return {
    ...fields,
    ...operation,
    type: operation.type.trim().toLowerCase(),
  };
}

function normalizeGeneratedPlanExpression(
  expression: string,
  columnsByName: Map<string, GeneratedWorkflowColumnBinding>
): string {
  let normalized = '';
  let index = 0;
  let quote: '"' | "'" | null = null;

  while (index < expression.length) {
    const char = expression[index];
    if (quote) {
      if (char === '\\') {
        const next = expression[index + 1];
        if (next !== undefined) {
          const following = expression[index + 2];
          if (next === '\\' && following === 'd') {
            normalized += '[0-9]';
            index += 3;
            continue;
          }
          normalized += normalizeGeneratedRegexEscape(next);
          index += 2;
          continue;
        }
      }
      normalized += char;
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      normalized += char;
      index += 1;
      continue;
    }

    if (char === '[' && expression[index + 1] === '`') {
      const fieldEnd = findDslBacktickFieldEnd(expression, index + 2);
      if (fieldEnd !== null) {
        normalized += expression.slice(index, fieldEnd + 1);
        index = fieldEnd + 1;
        continue;
      }
    }

    if (char === '[') {
      const parsed = readBracketFieldToken(expression, index);
      if (parsed) {
        const column = columnsByName.get(parsed.value.toLowerCase());
        normalized += column ? formatDslField(column.name) : parsed.raw;
        index = parsed.end;
        continue;
      }
    }

    if (char === '`') {
      const parsed = readBacktickToken(expression, index);
      if (parsed) {
        const column = columnsByName.get(parsed.value.toLowerCase());
        normalized += column ? formatDslField(column.name) : parsed.raw;
        index = parsed.end;
        continue;
      }
    }

    normalized += char;
    index += 1;
  }

  return castStringFunctionFieldArguments(normalized, columnsByName);
}

function normalizeGeneratedRegexEscape(char: string): string {
  return char === 'd' ? '[0-9]' : `\\${char}`;
}

function castStringFunctionFieldArguments(
  expression: string,
  columnsByName: Map<string, GeneratedWorkflowColumnBinding>
): string {
  const stringFunctions = ['REGEXP_EXTRACT', 'UPPER', 'LOWER', 'TRIM', 'REPLACE'];
  let normalized = expression;
  for (const functionName of stringFunctions) {
    const pattern = new RegExp(
      `\\b${functionName}\\s*\\(\\s*(${DSL_FIELD_REF_TOKEN_PATTERN})`,
      'giu'
    );
    normalized = normalized.replace(pattern, (match, fieldToken: string) => {
      const fieldName = extractSingleFieldNameFromExpression(fieldToken);
      if (!fieldName) return match;
      const column = columnsByName.get(fieldName.toLowerCase());
      if (!column?.type || normalizeDslTypeName(column.type) === 'text') return match;
      return match.replace(fieldToken, `CAST(${fieldToken} AS VARCHAR)`);
    });
  }
  return normalized;
}

function extractSingleFieldNameFromExpression(expression: string): string | null {
  const names = extractFieldNamesFromExpression(expression);
  return names.length === 1 ? (names[0] ?? null) : null;
}

function readBacktickToken(
  expression: string,
  start: number
): { raw: string; value: string; end: number } | null {
  let raw = '`';
  let value = '';
  for (let index = start + 1; index < expression.length; index += 1) {
    const char = expression[index];
    raw += char;
    if (char === '\\') {
      const next = expression[index + 1];
      if (next !== undefined) {
        raw += next;
        value += next;
        index += 1;
      }
      continue;
    }
    if (char === '`') {
      return { raw, value, end: index + 1 };
    }
    value += char;
  }
  return null;
}

function readBracketFieldToken(
  expression: string,
  start: number
): { raw: string; value: string; end: number } | null {
  let raw = '[';
  let value = '';
  for (let index = start + 1; index < expression.length; index += 1) {
    const char = expression[index];
    raw += char;
    if (char === ']') {
      return { raw, value: value.trim(), end: index + 1 };
    }
    value += char;
  }
  return null;
}

function normalizePlanFilterOperator(operator: unknown): string {
  switch (operator) {
    case '=':
    case '<>':
    case '>':
    case '>=':
    case '<':
    case '<=':
    case 'contains':
    case 'not_contains':
    case 'is_null':
    case 'is_not_null':
      return operator;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated filter operation uses unsupported operator: ${String(operator)}`
      );
  }
}

function resolvePlanFilterRightColumnName(operation: Record<string, unknown>): string {
  for (const key of ['rightColumn', 'compareColumn', 'rightField', 'fieldValue']) {
    const value = operation[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return parseDslFieldRefName(operation.value);
}

function parseDslFieldRefName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const backtickMatch = /^\[\s*`((?:[^`\\]|\\.)*)`\s*\]$/u.exec(trimmed);
  if (backtickMatch?.[1]) {
    return unescapeDslBacktickField(backtickMatch[1]);
  }
  const simpleMatch = /^\[\s*([\p{L}_][\p{L}\p{N}_]*)\s*\]$/u.exec(trimmed);
  if (simpleMatch?.[1]) return simpleMatch[1];
  const looseMatch = /^\[\s*([^\]]+?)\s*\]$/u.exec(trimmed);
  return looseMatch?.[1]?.trim() ?? '';
}

function normalizePlanSortDirection(direction: unknown): 'asc' | 'desc' {
  const normalized = typeof direction === 'string' ? direction.toLowerCase().trim() : '';
  return normalized === 'desc' || normalized === 'descending' ? 'desc' : 'asc';
}

function normalizePlanTargetType(targetType: unknown): string {
  switch (targetType) {
    case 'text':
    case 'integer':
    case 'float':
    case 'decimal':
    case 'date':
    case 'datetime':
    case 'boolean':
      return targetType;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated convert_type operation uses unsupported targetType: ${String(targetType)}`
      );
  }
}

function compilePlanTypeConversionExpression({
  columnName,
  targetType,
  removePrefix,
  removeChars,
  scale,
}: {
  columnName: string;
  targetType: string;
  removePrefix: string;
  removeChars: string[];
  scale: unknown;
}): string {
  let expression = `CAST(${formatDslField(columnName)} AS VARCHAR)`;
  for (const value of [removePrefix, ...removeChars].filter(Boolean)) {
    expression = `REPLACE(${expression}, ${literalToDsl(value)}, '')`;
  }
  if (targetType === 'text') return expression;
  const storageType =
    targetType === 'decimal'
      ? `DECIMAL(18,${normalizeDecimalScale(scale)})`
      : targetType.toUpperCase();
  return `CAST(${expression} AS ${storageType})`;
}

function inferPlanConversionRemovePrefixFromRequirement(
  columnName: string,
  targetType: string,
  requirement: string
): string {
  if (!['integer', 'float', 'decimal'].includes(normalizeDslTypeName(targetType))) return '';
  if (!requirement.includes('$')) return '';
  if (!/(去除|去掉|删除|移除|删掉|剔除|remove|strip)/i.test(requirement)) return '';
  if (
    columnName &&
    !requirement.toLowerCase().includes(columnName.toLowerCase()) &&
    !/(美元|金额|价格|price|money|currency)/i.test(requirement)
  ) {
    return '';
  }
  return '$';
}

function createGeneratedTemporaryColumnName(
  baseName: string,
  currentColumns: GeneratedWorkflowColumnBinding[]
): string {
  const existing = new Set(currentColumns.map((column) => column.name.toLowerCase()));
  const safeBase = baseName.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'field';
  let candidate = `__sophron_cast_${safeBase}`;
  let index = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `__sophron_cast_${safeBase}_${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeDecimalScale(scale: unknown): number {
  const numericScale = Number(scale);
  if (Number.isFinite(numericScale) && numericScale >= 0 && numericScale <= 12) {
    return Math.floor(numericScale);
  }
  return 2;
}

function compilePlanAggregateMetric(
  metric: Record<string, unknown>,
  requireColumn: (name: unknown, context?: string) => GeneratedWorkflowColumnBinding
): {
  dsl: string;
  alias: string;
  type?: string;
  sourceColumns: Array<{ name: string; type?: string }>;
} {
  const fn = normalizePlanAggregateFunction(metric.function);
  const sourceColumn =
    metric.column === '*'
      ? null
      : requireColumn(metric.column ?? metric.expression, 'aggregate.metrics.column');
  assertAggregateMetricType(fn, sourceColumn);
  const column = sourceColumn ? formatDslField(sourceColumn.name) : '*';
  const alias = normalizeRequiredName(
    typeof metric.alias === 'string' ? metric.alias : `${fn}_${String(metric.column ?? 'all')}`,
    'Generated aggregate metric requires alias'
  );
  const metricFunction = fn === 'count_distinct' ? 'count_distinct' : fn;
  return {
    dsl: `${metricFunction}(${column}) as ${formatDslField(alias)}`,
    alias,
    type: inferAggregateMetricType(fn, sourceColumn),
    sourceColumns: sourceColumn ? sourceColumnsFromBinding(sourceColumn) : [],
  };
}

function normalizePlanAggregateFunction(fn: unknown): string {
  switch (fn) {
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'count':
    case 'count_distinct':
      return fn;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated aggregate operation uses unsupported function: ${String(fn)}`
      );
  }
}

import {
  sourceColumnsFromBinding,
  toAutomationColumnSnapshot,
  toAutomationLineageEntry,
} from './lineage';
export {
  sourceColumnsFromBinding,
  toAutomationColumnSnapshot,
  toAutomationLineageEntry,
} from './lineage';

function inferGeneratedExpressionBinding(
  expression: string,
  columnsByName: Map<string, GeneratedWorkflowColumnBinding>,
  context: string
): GeneratedWorkflowColumnBinding {
  const normalizedExpression = normalizeGeneratedPlanExpression(expression, columnsByName);
  const referencedColumns = extractFieldNamesFromExpression(normalizedExpression).map((name) => {
    const column = columnsByName.get(name.toLowerCase());
    if (!column) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow ${context} references unknown input column: ${name}`
      );
    }
    return column;
  });
  assertExpressionTypeCompatible(normalizedExpression, referencedColumns, context);
  return {
    name: '',
    type: inferExpressionResultType(normalizedExpression, referencedColumns),
    sourceColumns: uniqueSourceColumns(referencedColumns.flatMap(sourceColumnsFromBinding)),
    expression: normalizedExpression,
  };
}

export function assertExpressionTypeCompatible(
  expression: string,
  referencedColumns: GeneratedWorkflowColumnBinding[],
  context: string
): void {
  if (!expressionUsesArithmetic(expression)) return;
  const incompatible = referencedColumns.filter(
    (column) => column.type && !isNumericColumnType(column.type)
  );
  if (incompatible.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} uses non-numeric column(s) in arithmetic expression: ${incompatible
        .map((column) => `${column.name} (${column.type})`)
        .join(', ')}`
    );
  }
}

export function inferExpressionResultType(
  expression: string,
  referencedColumns: GeneratedWorkflowColumnBinding[]
): string | undefined {
  const castMatches = [...expression.matchAll(/\bAS\s+([A-Z]+)(?:\s*\([^)]*\))?/gi)];
  const lastCastMatch = castMatches[castMatches.length - 1];
  if (lastCastMatch?.[1]) return normalizeDslTypeName(lastCastMatch[1]);
  if (/\b(REGEXP_EXTRACT|CONCAT|SUBSTR|LOWER|UPPER|TRIM|REPLACE)\s*\(/i.test(expression)) {
    return 'text';
  }
  if (/\b(YEAR|MONTH|DAY|DATE_PART|EXTRACT)\s*\(/i.test(expression)) {
    return 'integer';
  }
  if (/\b(COUNT)\s*\(/i.test(expression)) return 'integer';
  if (/\b(SUM|AVG|ROUND)\s*\(/i.test(expression)) return 'decimal';
  if (expressionUsesArithmetic(expression)) {
    return referencedColumns.some((column) => column.type && isDecimalLikeColumnType(column.type))
      ? 'decimal'
      : 'integer';
  }
  if (referencedColumns.length === 1) return referencedColumns[0]?.type;
  return undefined;
}

function assertGeneratedFilterComparable(
  left: GeneratedWorkflowColumnBinding,
  operator: string,
  right: GeneratedWorkflowColumnBinding | unknown,
  context: string
): void {
  if (operator === 'is_null' || operator === 'is_not_null' || operator === 'contains') return;
  if (operator === 'not_contains') return;
  const rightType = isGeneratedWorkflowColumnBinding(right)
    ? right.type
    : inferLiteralValueType(right);
  if (!left.type || !rightType) return;
  if (operator === '=' || operator === '<>') {
    if (areComparableColumnTypes(left.type, rightType)) return;
  } else if (areOrderedComparableColumnTypes(left.type, rightType)) {
    return;
  }
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} compares incompatible types: ${left.name} (${left.type}) ${operator} ${isGeneratedWorkflowColumnBinding(right) ? `${right.name} (${right.type})` : `${String(right)} (${rightType})`}`
  );
}

function isGeneratedWorkflowColumnBinding(value: unknown): value is GeneratedWorkflowColumnBinding {
  return isRecord(value) && typeof value.name === 'string';
}

function inferLiteralValueType(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return 'text';
  if (/^-?\d+$/.test(trimmed)) return 'integer';
  if (/^-?\d+\.\d+$/.test(trimmed)) return 'decimal';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'date';
  return 'text';
}

function assertAggregateMetricType(
  fn: string,
  sourceColumn: GeneratedWorkflowColumnBinding | null
): void {
  if (!sourceColumn || fn === 'count' || fn === 'count_distinct' || fn === 'min' || fn === 'max') {
    return;
  }
  if (sourceColumn.type && !isNumericColumnType(sourceColumn.type)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated aggregate metric ${fn} requires a numeric column, got ${sourceColumn.name} (${sourceColumn.type})`
    );
  }
}

export function inferAggregateMetricType(
  fn: string,
  sourceColumn: GeneratedWorkflowColumnBinding | null
): string | undefined {
  if (fn === 'count' || fn === 'count_distinct') return 'integer';
  if (fn === 'avg') return 'decimal';
  if (fn === 'sum')
    return sourceColumn?.type && isDecimalLikeColumnType(sourceColumn.type) ? 'decimal' : 'integer';
  return sourceColumn?.type;
}

export function uniqueSourceColumns(
  columns: Array<{ name: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const unique = new Map<string, { name: string; type?: string }>();
  for (const column of columns) {
    unique.set(column.name.toLowerCase(), column);
  }
  return [...unique.values()];
}

function expressionUsesArithmetic(expression: string): boolean {
  const withoutStrings = expression.replace(DSL_STRING_LITERAL_PATTERN, '');
  return /(?:^|[^<>!=])[-+*/](?:[^=]|$)/.test(withoutStrings);
}

function isNumericColumnType(type: string): boolean {
  return [
    'integer',
    'float',
    'double',
    'real',
    'decimal',
    'numeric',
    'bigint',
    'smallint',
  ].includes(normalizeDslTypeName(type));
}

function isDecimalLikeColumnType(type: string): boolean {
  return ['float', 'double', 'real', 'decimal', 'numeric'].includes(normalizeDslTypeName(type));
}

export function areComparableColumnTypes(left: string, right: string): boolean {
  const normalizedLeft = normalizeDslTypeName(left);
  const normalizedRight = normalizeDslTypeName(right);
  return (
    normalizedLeft === normalizedRight ||
    (isNumericColumnType(normalizedLeft) && isNumericColumnType(normalizedRight))
  );
}

export function areOrderedComparableColumnTypes(left: string, right: string): boolean {
  const normalizedLeft = normalizeDslTypeName(left);
  const normalizedRight = normalizeDslTypeName(right);
  if (isNumericColumnType(normalizedLeft) && isNumericColumnType(normalizedRight)) return true;
  if (
    ['date', 'datetime'].includes(normalizedLeft) &&
    ['date', 'datetime'].includes(normalizedRight)
  ) {
    return true;
  }
  return normalizedLeft === 'text' && normalizedRight === 'text';
}

function stringArrayFromPlan(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function columnListFromPlan(operation: Record<string, unknown>): string[] {
  const fromColumns = stringArrayFromPlan(operation.columns);
  if (fromColumns.length > 0) return fromColumns;
  const singleColumn = columnNameFromPlan(operation);
  return singleColumn ? [singleColumn] : [];
}

function columnNameFromPlan(operation: Record<string, unknown>): string {
  for (const key of ['column', 'field', 'by', 'sortBy', 'orderBy', 'name']) {
    const value = operation[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const key of ['columns', 'fields']) {
    const value = stringArrayFromPlan(operation[key]);
    if (value.length > 0) return value[0];
  }
  if (isRecord(operation.target) && typeof operation.target.column === 'string') {
    return operation.target.column.trim();
  }
  return '';
}

function inferDroppedColumnsFromSelectOperation(
  selectedNames: string[],
  context: GeneratedWorkflowOperationCompileContext
): string[] {
  if (selectedNames.length === 0 || !requirementHasColumnRemovalIntent(context.requirement)) {
    return [];
  }
  const currentColumns = context.getCurrentColumns();
  const currentByName = new Map(
    currentColumns.map((column) => [column.name.toLowerCase(), column.name])
  );
  const selected = new Set<string>();
  for (const name of selectedNames) {
    const currentName = currentByName.get(name.trim().toLowerCase());
    if (!currentName) return [];
    selected.add(currentName.toLowerCase());
  }
  if (selected.size !== selectedNames.length || selected.size >= currentColumns.length) {
    return [];
  }
  const dropped = currentColumns
    .filter((column) => !selected.has(column.name.toLowerCase()))
    .map((column) => column.name);
  if (dropped.length === 0) return [];
  const normalizedRequirement = normalizeColumnMatchText(context.requirement);
  return dropped.every((name) =>
    normalizedRequirementContainsColumnName(normalizedRequirement, normalizeColumnMatchText(name))
  )
    ? dropped
    : [];
}

function requirementHasColumnRemovalIntent(requirement: string): boolean {
  return /删除|去掉|移除|去除|删掉|剔除|排除|不要|\bdrop\b|\bdelete\b|\bremove\b|\bexclude\b/i.test(
    requirement
  );
}

function inferColumnNameFromRequirement(
  requirement: string,
  columns: Array<{ name: string; type?: string }>,
  _operationType: string
): string {
  const normalizedRequirement = normalizeColumnMatchText(requirement);
  const matched = columns
    .filter((column) => {
      const normalizedColumnName = normalizeColumnMatchText(column.name);
      return (
        normalizedColumnName &&
        normalizedRequirementContainsColumnName(normalizedRequirement, normalizedColumnName)
      );
    })
    .sort((left, right) => right.name.length - left.name.length);
  return matched[0]?.name ?? '';
}

function normalizeColumnMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function normalizedRequirementContainsColumnName(
  normalizedRequirement: string,
  normalizedColumnName: string
): boolean {
  if (!/^[a-z0-9_]+$/i.test(normalizedColumnName)) {
    return normalizedRequirement.includes(normalizedColumnName);
  }
  const escapedName = normalizedColumnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escapedName}($|[^a-z0-9_])`, 'i').test(normalizedRequirement);
}
