import { DataCommandError } from '../data-command-types';
import {
  getWorkflowExpressionFunctionDefinition,
  isWorkflowDecimalScale,
  normalizeWorkflowExpressionCastType,
  WORKFLOW_DECIMAL_SCALE_MAX,
  WORKFLOW_DECIMAL_SCALE_MIN,
  WORKFLOW_DEFAULT_DECIMAL_SCALE,
  WORKFLOW_DATE_DIFF_UNITS,
  workflowExpressionArityDescription,
  workflowExpressionArityIsValid,
  workflowExpressionFunctionResultType,
  workflowExpressionFunctionToDsl,
} from './workflow-expression-registry';
import type { WorkflowExpressionArgumentType } from './workflow-expression-registry';
import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
} from '../../../renderer/types';
import {
  formatDslField,
  inferUnpivotValueType,
  isDecimalLikeDslType,
  isRecord,
  isNumericDslType,
  literalToDsl,
  normalizeDslTypeName,
  normalizeRequiredName,
} from './utils';

import type {
  GeneratedWorkflowIrSemantics,
  GeneratedWorkflowOperationOrigin,
  GeneratedWorkflowColumnBinding,
  GeneratedWorkflowPlatformOperatorDraft,
  GeneratedWorkflowPlatformOperatorType,
  GeneratedWorkflowRequiredColumnResolver,
  WorkflowExpressionIr,
  WorkflowIr,
  WorkflowMetricIr,
  WorkflowOperationIr,
  WorkflowWindowFrame,
  WorkflowWindowFrameBound,
} from './workflow-model';
import { validateAndNormalizeWorkflowIr } from './workflow-ir';
import { getAiPrepDslExpressionLowering } from './prep-dsl-capability-profile';
import {
  getWorkflowAggregateFunctionDefinition,
  normalizeWorkflowAggregateFunction,
} from './workflow-aggregate-registry';
export type {
  GeneratedDataTaskWorkflow,
  GeneratedWorkflowColumnBinding,
  GeneratedWorkflowIrSemantics,
  GeneratedWorkflowPlatformOperatorDraft,
  GeneratedWorkflowPlatformOperatorType,
  GeneratedWorkflowRequiredColumnResolver,
} from './workflow-model';

class ColumnStateTracker {
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

interface WorkflowIrLoweringContext {
  columns: Array<{ name: string; type?: string }>;
  requirement: string;
  emitOperator: (
    type: GeneratedWorkflowPlatformOperatorType,
    config: Record<string, unknown>
  ) => void;
  requireColumn: GeneratedWorkflowRequiredColumnResolver;
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

type WorkflowIrOperationByType<T extends WorkflowOperationIr['type']> = Extract<
  WorkflowOperationIr,
  { type: T }
>;

type WorkflowIrOperationLowererRegistry = {
  [T in WorkflowOperationIr['type']]: {
    compile: (operation: WorkflowIrOperationByType<T>, context: WorkflowIrLoweringContext) => void;
  };
};

const WORKFLOW_IR_OPERATION_LOWERERS = {
  filter: {
    compile(operation, context) {
      const conditionIr = operation.condition;
      if (conditionIr.kind !== 'binary' && conditionIr.kind !== 'unary') {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'filter() requires a comparison expression such as col("Sales").gt(lit(100))'
        );
      }
      const compiled = compileWorkflowExpression(conditionIr, context, 'filter.condition');
      if (
        getAiPrepDslExpressionLowering(conditionIr, 'filter') === 'materialize_filter_predicate'
      ) {
        const temporaryColumn = createGeneratedCompatibilityColumnName(
          'filter_predicate',
          context.getCurrentColumns()
        );
        context.emitOperator('calculate_field', {
          calculations: [{ field: temporaryColumn, expression: compiled.dsl }],
        });
        context.upsertColumn({
          name: temporaryColumn,
          type: 'boolean',
          sourceColumns: compiled.sourceColumns,
          expression: compiled.dsl,
        });
        context.emitOperator('filter', {
          condition: `${formatDslField(temporaryColumn)} = true`,
        });
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: [temporaryColumn],
        });
        context.removeColumn(temporaryColumn);
        return;
      }
      context.emitOperator('filter', { condition: compiled.dsl });
    },
  },
  sort: {
    compile(operation, context) {
      const requestedKeys =
        operation.keys && operation.keys.length > 0
          ? operation.keys
          : [
              {
                field: requireWorkflowColumnName(operation.column!, 'sort.column'),
                direction: operation.direction ?? 'asc',
              },
            ];
      const keys = requestedKeys.map((key) => ({
        ...key,
        field: context.requireColumn(key.field, 'sort.keys').name,
      }));
      context.emitOperator('sort', {
        keys,
      });
    },
  },
  convert_type: {
    compile(operation, context) {
      const column = context.requireColumn(operation.column, 'convert_type.column');
      const targetType = normalizePlanTargetType(operation.targetType);
      const onError = operation.options.onError === 'fail' ? 'fail' : 'null';
      const removeChars = Array.isArray(operation.options.removeChars)
        ? operation.options.removeChars.filter(
            (value): value is string => typeof value === 'string'
          )
        : [];
      const removePrefix =
        typeof operation.options.removePrefix === 'string' && operation.options.removePrefix
          ? operation.options.removePrefix
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
      if (removePrefix || removeChars.length > 0 || operation.options.scale !== undefined) {
        const tempColumn = createGeneratedTemporaryColumnName(
          column.name,
          context.getCurrentColumns()
        );
        const expression = compilePlanTypeConversionExpression({
          columnName: column.name,
          targetType,
          removePrefix,
          removeChars,
          scale: operation.options.scale,
          failOnError: onError === 'fail',
        });
        context.emitOperator('calculate_field', {
          calculations: [{ field: tempColumn, expression }],
        });
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: [column.name],
        });
        context.emitOperator('field_mapping', {
          mappings: [{ source: tempColumn, target: column.name }],
        });
        context.removeColumn(column.name);
        context.upsertColumn({ ...convertedColumn, expression });
      } else {
        context.emitOperator('type_convert', {
          conversions: [{ column: column.name, type: targetType, onError }],
        });
        context.upsertColumn(convertedColumn);
      }
    },
  },
  select: {
    compile(operation, context) {
      const rawSelected = operation.columns;
      const inferredDropped = inferDroppedColumnsFromSelectOperation(rawSelected, context);
      if (inferredDropped.length > 0) {
        const dropped = inferredDropped.map(
          (name) => context.requireColumn(name, 'drop.columns').name
        );
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: dropped,
        });
        dropped.forEach((name) => context.removeColumn(name));
        return;
      }
      const selected = rawSelected.map(
        (name) => context.requireColumn(name, 'select.columns').name
      );
      if (selected.length > 0) {
        context.emitOperator('field_select', {
          mode: 'include',
          columns: selected,
        });
        context.keepColumns(selected);
      }
    },
  },
  drop: {
    compile(operation, context) {
      const dropped = operation.columns.map(
        (name) => context.requireColumn(name, 'drop.columns').name
      );
      if (dropped.length > 0) {
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: dropped,
        });
        dropped.forEach((name) => context.removeColumn(name));
      }
    },
  },
  rename: {
    compile(operation, context) {
      const source = context.requireColumn(operation.source, 'rename.source');
      const target = normalizeRequiredName(
        operation.target,
        'Generated rename operation requires target'
      );
      context.emitOperator('field_mapping', {
        mappings: [{ source: source.name, target }],
      });
      context.renameColumn(source.name, target);
    },
  },
  derive: {
    compile(operation, context) {
      const column = normalizeRequiredName(
        operation.column,
        'Generated derive operation requires column'
      );
      const compiledExpression = compileWorkflowExpression(
        operation.expression,
        context,
        'derive.expression'
      );
      const expression = compiledExpression.dsl;
      const inferredColumn = {
        name: column,
        type: compiledExpression.type,
        sourceColumns: compiledExpression.sourceColumns,
        expression,
      };
      const existingColumn = context
        .getCurrentColumns()
        .find((currentColumn) => currentColumn.name.toLowerCase() === column.toLowerCase());
      if (existingColumn) {
        const tempColumn = createGeneratedTemporaryColumnName(column, context.getCurrentColumns());
        context.emitOperator('calculate_field', {
          calculations: [{ field: tempColumn, expression }],
        });
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: [existingColumn.name],
        });
        context.emitOperator('field_mapping', {
          mappings: [{ source: tempColumn, target: existingColumn.name }],
        });
        context.removeColumn(existingColumn.name);
        context.upsertColumn({
          ...inferredColumn,
          name: existingColumn.name,
        });
        return;
      }
      context.emitOperator('calculate_field', {
        calculations: [{ field: column, expression }],
      });
      context.upsertColumn(inferredColumn);
    },
  },
  derive_window: {
    compile(operation, context) {
      const column = normalizeRequiredName(
        operation.column,
        'Generated derive_window operation requires column'
      );
      const windowValue = compileWorkflowWindowValue(operation, context);
      const partitionBy = operation.partitionBy.map((name) =>
        context.requireColumn(name, 'derive_window.partitionBy')
      );
      const orderBy = operation.orderBy.map((key) => ({
        ...key,
        column: context.requireColumn(key.field, 'derive_window.orderBy'),
      }));
      const windowClauses: string[] = [];
      if (partitionBy.length > 0) {
        windowClauses.push(
          `PARTITION BY ${partitionBy.map((binding) => formatDslField(binding.name)).join(', ')}`
        );
      }
      if (orderBy.length > 0) {
        windowClauses.push(
          `ORDER BY ${orderBy
            .map(
              (key) =>
                `${formatDslField(key.column.name)} ${key.direction.toUpperCase()}${
                  key.nulls ? ` NULLS ${key.nulls.toUpperCase()}` : ''
                }`
            )
            .join(', ')}`
        );
      }
      if (operation.frame) windowClauses.push(formatWorkflowWindowFrame(operation.frame));
      const expression = `${windowValue.call} OVER (${windowClauses.join(' ')})`;
      const sourceColumns = uniqueSourceColumns([
        ...windowValue.sourceColumns,
        ...partitionBy.flatMap(sourceColumnsFromBinding),
        ...orderBy.flatMap((key) => sourceColumnsFromBinding(key.column)),
      ]);
      const inferredColumn = {
        name: column,
        type: windowValue.type,
        sourceColumns,
        expression,
      };
      const existingColumn = context
        .getCurrentColumns()
        .find((currentColumn) => currentColumn.name.toLowerCase() === column.toLowerCase());
      if (existingColumn) {
        const tempColumn = createGeneratedTemporaryColumnName(column, context.getCurrentColumns());
        context.emitOperator('calculate_field', {
          calculations: [{ field: tempColumn, expression }],
        });
        context.emitOperator('field_select', {
          mode: 'exclude',
          columns: [existingColumn.name],
        });
        context.emitOperator('field_mapping', {
          mappings: [{ source: tempColumn, target: existingColumn.name }],
        });
        context.removeColumn(existingColumn.name);
        context.upsertColumn({
          ...inferredColumn,
          name: existingColumn.name,
        });
        return;
      }
      context.emitOperator('calculate_field', {
        calculations: [{ field: column, expression }],
      });
      context.upsertColumn(inferredColumn);
    },
  },
  aggregate: {
    compile(operation, context) {
      const groupBy = operation.groupBy.map((expression) => {
        const name = requireWorkflowColumnName(expression, 'aggregate.groupBy');
        return context.requireColumn(name, 'aggregate.groupBy');
      });
      const metrics = operation.metrics.map((metric) =>
        compileWorkflowAggregateMetric(metric, context)
      );
      if (metrics.length === 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated aggregate operation requires metrics'
        );
      }
      context.emitOperator('aggregate', {
        groupBy: groupBy.map((column) => column.name),
        metrics: metrics.map((metric, index) => ({
          function: normalizePlanAggregateFunction(operation.metrics[index]?.fn),
          expression: metric.expression ?? '*',
          alias: metric.alias,
        })),
      });
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
          expression: metric.expression,
        })),
      ]);
    },
  },
  deduplicate: {
    compile(operation, context) {
      const columns = operation.config.columns.map(
        (name) => context.requireColumn(name, 'deduplicate.columns').name
      );
      const orderBy = operation.config.orderBy.map((key) => ({
        ...key,
        field: context.requireColumn(key.field, 'deduplicate.orderBy').name,
      }));
      context.emitOperator('deduplicate', {
        strategy: columns.length > 0 ? 'by_columns' : 'all_columns',
        columns: columns.length > 0 ? columns : undefined,
        keep: 'first',
        orderBy: orderBy.length > 0 ? orderBy : undefined,
      });
    },
  },
  missing_value: {
    compile(operation, context) {
      if (operation.config.strategy === 'drop_empty_rows') {
        context.emitOperator('missing_value', {
          strategy: 'drop_empty_rows',
          condition: 'all_null',
        });
        return;
      }
      if (operation.config.strategy === 'drop_rows_by_nulls') {
        const columns = operation.config.columns.map(
          (name) => context.requireColumn(name, 'missing_value.columns').name
        );
        context.emitOperator('missing_value', {
          strategy: 'drop_rows_by_nulls',
          columns,
          condition: operation.config.condition,
        });
        return;
      }
      const rules = operation.config.rules.map((rule) => {
        const column = context.requireColumn(rule.column, 'missing_value.rules');
        switch (rule.method) {
          case 'skip':
            return { column: column.name, method: 'skip' };
          case 'drop':
            return { column: column.name, method: 'drop' };
          case 'nullify_values':
            if (!rule.values?.length) {
              throw new DataCommandError(
                'VALIDATION_FAILED',
                `Missing-value nullify rule for ${column.name} requires values`
              );
            }
            return {
              column: column.name,
              method: 'nullify_values',
              values: rule.values,
            };
          case 'literal_fill':
            if (rule.value === undefined) {
              throw new DataCommandError(
                'VALIDATION_FAILED',
                `Missing-value fill rule for ${column.name} requires value`
              );
            }
            assertGeneratedFilterComparable(column, '=', rule.value, 'missing_value.literal_fill');
            return { column: column.name, method: 'literal_fill', value: rule.value };
        }
      });
      context.emitOperator('missing_value', { strategy: 'by_column', rules });
    },
  },
  limit: {
    compile(operation, context) {
      const config = operation.config;
      if (!Number.isFinite(config.limit) || config.limit <= 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated limit must be greater than zero'
        );
      }
      if (config.unit === 'percent' && config.limit > 100) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated limit percent cannot exceed 100'
        );
      }
      if (!Number.isInteger(config.offset) || config.offset < 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated limit offset must be a non-negative integer'
        );
      }
      const orderBy = config.orderBy.map((key) => ({
        ...key,
        field: context.requireColumn(key.field, 'limit.orderBy').name,
      }));
      const groupBy = (config.groupBy ?? []).map(
        (name) => context.requireColumn(name, 'limit.groupBy').name
      );
      if (config.mode === 'top') {
        if (orderBy.length === 0) {
          throw new DataCommandError(
            'VALIDATION_FAILED',
            'Generated top operation requires orderBy'
          );
        }
        context.emitOperator('limit', {
          mode: 'fixed',
          limit: Math.floor(config.limit),
          unit: 'rows',
          orderBy,
          ties: false,
        });
        return;
      }
      if (config.mode === 'random') {
        context.emitOperator('limit', {
          mode: 'random',
          limit: config.unit === 'rows' ? Math.floor(config.limit) : config.limit,
          unit: config.unit,
          method: config.method ?? 'system',
          seed: config.seed,
        });
        return;
      }
      context.emitOperator('limit', {
        mode: 'fixed',
        limit: config.unit === 'rows' ? Math.floor(config.limit) : config.limit,
        unit: config.unit === 'percent' ? 'percent' : 'rows',
        orderBy: orderBy.length > 0 ? orderBy : undefined,
        groupBy: groupBy.length > 0 ? groupBy : undefined,
        ties: config.ties === true,
        offset: config.offset > 0 ? config.offset : undefined,
      });
    },
  },
  unpivot: {
    compile(operation, context) {
      const config = operation.config;
      const current = context.getCurrentColumns();
      const configured = config.columns.map(
        (name) => context.requireColumn(name, 'unpivot.columns').name
      );
      const unpivoted =
        config.mode === 'except'
          ? current.filter((column) => !configured.includes(column.name))
          : configured.map((name) => context.requireColumn(name, 'unpivot.columns'));
      if (unpivoted.length === 0) {
        throw new DataCommandError('VALIDATION_FAILED', 'Generated unpivot requires columns');
      }
      const kept = current.filter(
        (column) => !unpivoted.some((unpivotColumn) => unpivotColumn.name === column.name)
      );
      if (
        kept.some(
          (column) =>
            column.name.toLowerCase() === config.nameColumn.toLowerCase() ||
            column.name.toLowerCase() === config.valueColumn.toLowerCase()
        )
      ) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated unpivot output columns conflict with retained input columns'
        );
      }
      context.emitOperator('unpivot', {
        mode: config.mode === 'except' ? 'except' : 'include',
        columns: configured,
        nameColumn: config.nameColumn,
        valueColumn: config.valueColumn,
        includeNulls: config.includeNulls,
      });
      context.replaceColumns([
        ...kept,
        {
          name: config.nameColumn,
          type: 'text',
          sourceColumns: uniqueSourceColumns(unpivoted.flatMap(sourceColumnsFromBinding)),
          expression: 'unpivot field name',
        },
        {
          name: config.valueColumn,
          type: inferUnpivotValueType(unpivoted),
          sourceColumns: uniqueSourceColumns(unpivoted.flatMap(sourceColumnsFromBinding)),
          expression: 'unpivot field value',
        },
      ]);
    },
  },
  unnest: {
    compile(operation, context) {
      const config = operation.config;
      const source = context.requireColumn(config.column, 'unnest.column');
      if (!config.alias) {
        throw new DataCommandError('VALIDATION_FAILED', 'Generated unnest requires alias');
      }
      if (
        context
          .getCurrentColumns()
          .some((column) => column.name.toLowerCase() === config.alias.toLowerCase())
      ) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Generated unnest alias already exists: ${config.alias}`
        );
      }
      if (
        config.withIndex &&
        context
          .getCurrentColumns()
          .some((column) => column.name.toLowerCase() === config.withIndex?.toLowerCase())
      ) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Generated unnest index column already exists: ${config.withIndex}`
        );
      }
      if (config.sourceKind === 'json' && !config.path) {
        throw new DataCommandError('VALIDATION_FAILED', 'Generated JSON unnest requires path');
      }
      if (config.maxDepth !== undefined && (!config.recursive || config.maxDepth <= 0)) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated unnest maxDepth requires recursive mode and a positive value'
        );
      }
      const alias =
        config.keepParentNames && config.sourceKind === 'json'
          ? `${source.name}_${config.alias}`
          : config.alias;
      context.emitOperator('unnest', {
        sourceKind: config.sourceKind,
        column: source.name,
        path: config.sourceKind === 'json' ? config.path : undefined,
        alias: config.alias,
        withIndex: config.withIndex,
        recursive: config.recursive,
        maxDepth: config.maxDepth,
        keepParentNames: config.keepParentNames,
      });
      context.upsertColumn({
        name: alias,
        type: config.sourceKind === 'json' ? 'json' : undefined,
        sourceColumns: sourceColumnsFromBinding(source),
        expression: `${config.sourceKind} unnest ${source.name}`,
      });
      if (config.withIndex) {
        context.upsertColumn({
          name: config.withIndex,
          type: 'integer',
          sourceColumns: sourceColumnsFromBinding(source),
          expression: `unnest index ${source.name}`,
        });
      }
    },
  },
  pivot: {
    compile(operation, context) {
      const config = operation.config;
      if (config.on.length !== 1 || config.using.length === 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated automation pivot requires exactly one on field and at least one metric'
        );
      }
      const axis = config.on[0];
      const values = axis.values ?? [];
      if (values.length === 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Generated automation pivot requires fixed non-empty values for the on field'
        );
      }
      const on = context.requireColumn(axis.field, 'pivot.on');
      const groupBy = config.groupBy.map((name) => context.requireColumn(name, 'pivot.groupBy'));
      const metrics = config.using.map((metric) =>
        compileWorkflowAggregateMetric(
          {
            fn: metric.function,
            expression: metric.expression,
            alias: metric.alias,
            parameters: metric.parameters,
          },
          context
        )
      );
      context.emitOperator('pivot', {
        on: [
          {
            field: on.name,
            values,
          },
        ],
        using: metrics.map((metric, index) => ({
          function: normalizePlanAggregateFunction(config.using[index].function),
          expression: metric.expression ?? '*',
          alias: metric.alias,
        })),
        groupBy: groupBy.map((column) => column.name),
      });
      context.replaceColumns([
        ...groupBy,
        ...values.flatMap((value) =>
          metrics.map((metric) => ({
            name: `${String(value)}_${metric.alias}`,
            type: metric.type,
            sourceColumns: uniqueSourceColumns([
              ...sourceColumnsFromBinding(on),
              ...metric.sourceColumns,
            ]),
            expression: `pivot ${on.name} = ${String(value)} using ${metric.alias}`,
          }))
        ),
      ]);
    },
  },
} satisfies WorkflowIrOperationLowererRegistry;

export function lowerGeneratedWorkflowIrSemantics({
  ir,
  requirement,
  columns,
}: {
  ir: WorkflowIr;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): GeneratedWorkflowIrSemantics {
  ir = validateAndNormalizeWorkflowIr(ir);
  const provenanceByOperationId = new Map(
    ir.provenance.map((entry) => [entry.operationId, entry.source] as const)
  );
  const columnTracker = new ColumnStateTracker(columns);
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  const requireColumn = (name: unknown, context = 'operation'): GeneratedWorkflowColumnBinding => {
    const column = columnTracker.requireColumn(name, context);
    for (const sourceColumn of sourceColumnsFromBinding(column)) {
      requiredColumnsByName.set(sourceColumn.name.toLowerCase(), sourceColumn);
    }
    return column;
  };
  const platformOperators: GeneratedWorkflowPlatformOperatorDraft[] = [];
  const operationOrigins: GeneratedWorkflowOperationOrigin[] = [];
  let operatorIndex = 0;
  const context: WorkflowIrLoweringContext = {
    columns,
    requirement,
    emitOperator: (type, config) => {
      platformOperators.push({
        type,
        config: withoutUndefinedProperties(config),
      });
    },
    requireColumn,
    assertComparableFilter: assertGeneratedFilterComparable,
    renameColumn: (sourceName, targetName) => columnTracker.renameColumn(sourceName, targetName),
    upsertColumn: (column) => columnTracker.upsertColumn(column),
    removeColumn: (name) => columnTracker.removeColumn(name),
    keepColumns: (names) => columnTracker.keepColumns(names),
    replaceColumns: (columns) => columnTracker.replaceColumns(columns),
    getCurrentColumns: () => columnTracker.getCurrentColumns(),
  };
  for (const operation of ir.operations) {
    const source = operation.operationId
      ? (provenanceByOperationId.get(operation.operationId) ?? operation.location)
      : operation.location;
    try {
      const operatorCountBefore = platformOperators.length;
      lowerWorkflowIrOperation(operation, context);
      const emittedOperatorCount = platformOperators.length - operatorCountBefore;
      if (source) {
        for (let emittedIndex = 0; emittedIndex < emittedOperatorCount; emittedIndex += 1) {
          operationOrigins.push({
            ...source,
            operationId:
              emittedIndex === 0
                ? (operation.operationId ??
                  `${source.functionName}:${operation.type}:${operatorIndex}`)
                : `${operation.operationId ?? `${source.functionName}:${operation.type}`}:${emittedIndex}`,
            operatorIndex: operatorIndex + emittedIndex,
            operationType: operation.type,
          });
        }
      }
      operatorIndex += emittedOperatorCount;
    } catch (error) {
      if (!(error instanceof DataCommandError) || !source) throw error;
      const existingDiagnostics =
        isRecord(error.details) && Array.isArray(error.details.diagnostics)
          ? error.details.diagnostics
          : [];
      throw new DataCommandError(error.code, error.message.replace(/^\[[A-Z_]+\]\s*/, ''), {
        diagnostics: [
          ...existingDiagnostics,
          {
            severity: 'error',
            code: error.code,
            message: error.message.replace(/^\[[A-Z_]+\]\s*/, ''),
            ...source,
          },
        ],
      });
    }
  }
  const outputColumns = columnTracker.getCurrentColumns();
  return {
    workflowIr: ir,
    platformOperators,
    operationOrigins,
    requiredColumns: [...requiredColumnsByName.values()],
    expectedOutputSchema: outputColumns.map(toAutomationColumnSnapshot),
    lineage: outputColumns.map(toAutomationLineageEntry),
  };
}

function lowerWorkflowIrOperation(
  operation: WorkflowOperationIr,
  context: WorkflowIrLoweringContext
): void {
  switch (operation.type) {
    case 'filter':
      return WORKFLOW_IR_OPERATION_LOWERERS.filter.compile(operation, context);
    case 'sort':
      return WORKFLOW_IR_OPERATION_LOWERERS.sort.compile(operation, context);
    case 'convert_type':
      return WORKFLOW_IR_OPERATION_LOWERERS.convert_type.compile(operation, context);
    case 'select':
      return WORKFLOW_IR_OPERATION_LOWERERS.select.compile(operation, context);
    case 'drop':
      return WORKFLOW_IR_OPERATION_LOWERERS.drop.compile(operation, context);
    case 'rename':
      return WORKFLOW_IR_OPERATION_LOWERERS.rename.compile(operation, context);
    case 'derive':
      return WORKFLOW_IR_OPERATION_LOWERERS.derive.compile(operation, context);
    case 'derive_window':
      return WORKFLOW_IR_OPERATION_LOWERERS.derive_window.compile(operation, context);
    case 'aggregate':
      return WORKFLOW_IR_OPERATION_LOWERERS.aggregate.compile(operation, context);
    case 'deduplicate':
      return WORKFLOW_IR_OPERATION_LOWERERS.deduplicate.compile(operation, context);
    case 'missing_value':
      return WORKFLOW_IR_OPERATION_LOWERERS.missing_value.compile(operation, context);
    case 'limit':
      return WORKFLOW_IR_OPERATION_LOWERERS.limit.compile(operation, context);
    case 'pivot':
      return WORKFLOW_IR_OPERATION_LOWERERS.pivot.compile(operation, context);
    case 'unpivot':
      return WORKFLOW_IR_OPERATION_LOWERERS.unpivot.compile(operation, context);
    case 'unnest':
      return WORKFLOW_IR_OPERATION_LOWERERS.unnest.compile(operation, context);
  }
}

function requireWorkflowColumnName(expression: WorkflowExpressionIr, context: string): string {
  if (expression.kind === 'column') return expression.name;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow JS ${context} must be a column reference`
  );
}

interface CompiledWorkflowExpression {
  dsl: string;
  type?: string;
  sourceColumns: Array<{ name: string; type?: string }>;
  columnBinding?: GeneratedWorkflowColumnBinding;
  literalValue?: string | number | boolean | null;
  precedence: number;
}

function compileWorkflowExpression(
  expression: WorkflowExpressionIr,
  context: WorkflowIrLoweringContext,
  expressionContext: string
): CompiledWorkflowExpression {
  switch (expression.kind) {
    case 'column': {
      const column = context.requireColumn(expression.name, expressionContext);
      return {
        dsl: formatDslField(column.name),
        type: column.type,
        sourceColumns: sourceColumnsFromBinding(column),
        columnBinding: column,
        precedence: 4,
      };
    }
    case 'literal':
      return {
        dsl: literalToDsl(expression.value),
        type: inferLiteralValueType(expression.value),
        sourceColumns: [],
        literalValue: expression.value,
        precedence: 4,
      };
    case 'binary': {
      const left = compileWorkflowExpression(expression.left, context, expressionContext);
      const right = compileWorkflowExpression(expression.right, context, expressionContext);
      const sourceColumns = uniqueSourceColumns([...left.sourceColumns, ...right.sourceColumns]);
      if (expression.op === 'and' || expression.op === 'or') {
        assertCompiledBooleanOperand(left, expressionContext);
        assertCompiledBooleanOperand(right, expressionContext);
        const precedence = expression.op === 'and' ? -1 : -2;
        return {
          dsl: `${formatCompiledOperand(left, precedence)} ${expression.op.toUpperCase()} ${formatCompiledOperand(right, precedence)}`,
          type: 'boolean',
          sourceColumns,
          precedence,
        };
      }
      if (['+', '-', '*', '/'].includes(expression.op)) {
        assertCompiledArithmeticTypes(left, right, expressionContext);
        const precedence = expression.op === '*' || expression.op === '/' ? 2 : 1;
        return {
          dsl: `${formatCompiledOperand(left, precedence)} ${expression.op} ${formatCompiledOperand(
            right,
            precedence,
            expression.op === '-' || expression.op === '/'
          )}`,
          type:
            (left.type && isDecimalLikeDslType(left.type)) ||
            (right.type && isDecimalLikeDslType(right.type))
              ? 'decimal'
              : 'integer',
          sourceColumns,
          precedence,
        };
      }
      const operator = normalizePlanFilterOperator(expression.op);
      if (
        operator === '=' ||
        operator === '<>' ||
        operator === '>' ||
        operator === '>=' ||
        operator === '<' ||
        operator === '<='
      ) {
        assertCompiledFilterComparable(left, operator, right, context, expressionContext);
        return {
          dsl: `${left.dsl} ${operator} ${right.dsl}`,
          type: 'boolean',
          sourceColumns,
          precedence: 0,
        };
      }
      if (operator === 'contains' || operator === 'not_contains') {
        return {
          dsl: `${operator === 'not_contains' ? 'NOT ' : ''}contains(CAST(${left.dsl} AS VARCHAR), ${right.dsl})`,
          type: 'boolean',
          sourceColumns,
          precedence: 0,
        };
      }
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported workflow expression operator: ${expression.op}`
      );
    }
    case 'unary': {
      const value = compileWorkflowExpression(expression.value, context, expressionContext);
      if (expression.op === 'not') {
        assertCompiledBooleanOperand(value, `${expressionContext} NOT operand`);
        return {
          dsl: `NOT (${value.dsl})`,
          type: 'boolean',
          sourceColumns: value.sourceColumns,
          precedence: 0,
        };
      }
      return {
        dsl: `${value.dsl} ${expression.op === 'is_null' ? 'IS NULL' : 'IS NOT NULL'}`,
        type: 'boolean',
        sourceColumns: value.sourceColumns,
        precedence: 0,
      };
    }
    case 'cast': {
      const value = compileWorkflowExpression(expression.value, context, expressionContext);
      const targetType = normalizePlanTargetType(expression.targetType);
      const sqlType =
        targetType === 'decimal'
          ? `DECIMAL(18,${normalizeDecimalScale(expression.options.scale)})`
          : targetType.toUpperCase();
      return {
        dsl: `CAST(${value.dsl} AS ${sqlType})`,
        type: targetType,
        sourceColumns: value.sourceColumns,
        precedence: 4,
      };
    }
    case 'function': {
      const functionDefinition = getWorkflowExpressionFunctionDefinition(expression.name);
      assertWorkflowFunctionArity(expression.name, expression.args.length, expressionContext);
      const args = normalizeWorkflowFunctionArgs(expression).map((argument) =>
        compileWorkflowExpression(argument, context, expressionContext)
      );
      assertWorkflowFunctionArgumentTypes(
        expression.name,
        functionDefinition?.argumentTypes,
        args,
        expressionContext
      );
      switch (functionDefinition?.semanticRule) {
        case 'date_diff':
          assertCompiledDateDiffArgs(args, expressionContext);
          break;
        case 'date_part':
          assertCompiledDatePartArgs(args, expressionContext);
          break;
        case 'format_literal':
          assertCompiledFormatLiteralArgs(expression.name, args, expressionContext);
          break;
        case 'conditional':
          return compileWorkflowIfElse(args, expressionContext);
        case 'compatible':
          assertCompiledCompatibleFunctionArgs(expression.name, args, expressionContext);
          break;
        case 'numeric':
          assertCompiledNumericFunctionArgs(expression.name, args, expressionContext);
          break;
      }
      const functionName = workflowFunctionNameToDsl(expression.name);
      const dslArgs = args.map((argument, index) =>
        functionDefinition?.coerceFirstArgToText &&
        index === 0 &&
        argument.type &&
        normalizeDslTypeName(argument.type) !== 'text'
          ? `CAST(${argument.dsl} AS VARCHAR)`
          : argument.dsl
      );
      return {
        dsl:
          functionDefinition?.callSyntax === 'bare'
            ? functionName
            : `${functionName}(${dslArgs.join(', ')})`,
        type: inferWorkflowFunctionType(expression.name, args),
        sourceColumns: uniqueSourceColumns(args.flatMap((argument) => argument.sourceColumns)),
        precedence: 4,
      };
    }
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported workflow expression in ${expressionContext}`
      );
  }
}

function assertCompiledCompatibleFunctionArgs(
  name: string,
  args: CompiledWorkflowExpression[],
  context: string
): void {
  const knownTypes = args
    .map((argument) => argument.type)
    .filter((type): type is string => Boolean(type));
  if (knownTypes.length <= 1) return;
  const first = knownTypes[0];
  if (knownTypes.every((type) => areComparableColumnTypes(first, type))) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} ${name} arguments have incompatible types: ${knownTypes.join(', ')}`
  );
}

function assertWorkflowFunctionArity(name: string, count: number, context: string): void {
  const definition = getWorkflowExpressionFunctionDefinition(name);
  if (!definition || workflowExpressionArityIsValid(definition, count)) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} ${name} requires ${workflowExpressionArityDescription(definition)} argument(s); received ${count}`
  );
}

function assertWorkflowFunctionArgumentTypes(
  name: string,
  expectedTypes: readonly WorkflowExpressionArgumentType[] | undefined,
  args: CompiledWorkflowExpression[],
  context: string
): void {
  if (!expectedTypes) return;
  expectedTypes.forEach((expectedType, index) => {
    const argument = args[index];
    if (!argument?.type || expectedType === 'any') return;
    const actualType = normalizeDslTypeName(argument.type);
    const compatible =
      (expectedType === 'text' &&
        (actualType === 'text' || typeof argument.literalValue === 'string')) ||
      (expectedType === 'numeric' && isNumericDslType(actualType)) ||
      (expectedType === 'integer' && actualType === 'integer') ||
      (expectedType === 'temporal' && ['date', 'datetime'].includes(actualType)) ||
      (expectedType === 'boolean' && actualType === 'boolean');
    if (compatible) return;
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} ${name} argument ${index + 1} must be ${expectedType}; received ${argument.dsl} (${argument.type})`
    );
  });
}

function assertCompiledNumericFunctionArgs(
  name: string,
  args: CompiledWorkflowExpression[],
  context: string
): void {
  const zero = { dsl: '0', type: 'integer', sourceColumns: [], precedence: 4 };
  assertCompiledArithmeticTypes(args[0], zero, context);
  if (name === 'round' && args[1]) {
    assertCompiledArithmeticTypes(args[1], zero, `${context} round digits`);
  }
}

function compileWorkflowIfElse(
  args: CompiledWorkflowExpression[],
  context: string
): CompiledWorkflowExpression {
  if (args.length !== 3) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} fn.ifElse requires exactly 3 arguments: condition, whenTrue, whenFalse`
    );
  }
  const [condition, whenTrue, whenFalse] = args;
  assertCompiledBooleanOperand(condition, `${context} fn.ifElse condition`);
  const resultType = inferWorkflowConditionalResultType(whenTrue, whenFalse, context);
  return {
    dsl: `if ${condition.dsl} then ${whenTrue.dsl} else ${whenFalse.dsl} end`,
    type: resultType,
    sourceColumns: uniqueSourceColumns(args.flatMap((argument) => argument.sourceColumns)),
    precedence: 4,
  };
}

function inferWorkflowConditionalResultType(
  whenTrue: CompiledWorkflowExpression,
  whenFalse: CompiledWorkflowExpression,
  context: string
): string | undefined {
  if (!whenTrue.type) return whenFalse.type;
  if (!whenFalse.type) return whenTrue.type;
  const trueType = normalizeDslTypeName(whenTrue.type);
  const falseType = normalizeDslTypeName(whenFalse.type);
  if (trueType === falseType) return whenTrue.type;
  if (isNumericDslType(trueType) && isNumericDslType(falseType)) {
    return isDecimalLikeDslType(trueType) || isDecimalLikeDslType(falseType)
      ? 'decimal'
      : 'integer';
  }
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} fn.ifElse result branches have incompatible types: ${whenTrue.dsl} (${whenTrue.type}) and ${whenFalse.dsl} (${whenFalse.type})`
  );
}

function formatCompiledOperand(
  operand: CompiledWorkflowExpression,
  parentPrecedence: number,
  wrapAtEqualPrecedence = false
): string {
  return operand.precedence < parentPrecedence ||
    (wrapAtEqualPrecedence && operand.precedence === parentPrecedence)
    ? `(${operand.dsl})`
    : operand.dsl;
}

function assertCompiledBooleanOperand(operand: CompiledWorkflowExpression, context: string): void {
  if (!operand.type || normalizeDslTypeName(operand.type) === 'boolean') return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} uses a non-boolean logical operand: ${operand.dsl} (${operand.type})`
  );
}

function assertCompiledArithmeticTypes(
  left: CompiledWorkflowExpression,
  right: CompiledWorkflowExpression,
  context: string
): void {
  const incompatible = [left, right].filter(
    (operand) => operand.type && !isNumericDslType(operand.type)
  );
  if (incompatible.length === 0) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} uses non-numeric value(s) in arithmetic expression: ${incompatible
      .map((operand) => `${operand.dsl} (${operand.type})`)
      .join(', ')}`
  );
}

function assertCompiledFilterComparable(
  left: CompiledWorkflowExpression,
  operator: string,
  right: CompiledWorkflowExpression,
  context: WorkflowIrLoweringContext,
  expressionContext: string
): void {
  if (left.columnBinding) {
    context.assertComparableFilter(
      left.columnBinding,
      operator,
      right.columnBinding ?? right.literalValue,
      expressionContext
    );
    return;
  }
  if (!left.type || !right.type) return;
  const comparable =
    operator === '=' || operator === '<>'
      ? areComparableColumnTypes(left.type, right.type)
      : areOrderedComparableColumnTypes(left.type, right.type);
  if (comparable) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${expressionContext} compares incompatible expression types: ${left.dsl} (${left.type}) ${operator} ${right.dsl} (${right.type})`
  );
}

function inferWorkflowFunctionType(
  name: string,
  args: CompiledWorkflowExpression[] = []
): string | undefined {
  const type = workflowExpressionFunctionResultType(name);
  if (type === 'same_as_first') return args[0]?.type;
  if (type === 'same_as_second') return args[1]?.type;
  return ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime'].includes(type ?? '')
    ? type
    : undefined;
}

const WORKFLOW_DATE_DIFF_UNIT_SET = new Set<string>(WORKFLOW_DATE_DIFF_UNITS);

function assertCompiledDateDiffArgs(args: CompiledWorkflowExpression[], context: string): void {
  if (args.length !== 3) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} fn.dateDiff requires exactly 3 arguments: unit, start, end`
    );
  }
  const [unit, start, end] = args;
  const normalizedUnit =
    typeof unit.literalValue === 'string' ? unit.literalValue.trim().toLowerCase() : '';
  if (!WORKFLOW_DATE_DIFF_UNIT_SET.has(normalizedUnit)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} fn.dateDiff requires a supported literal unit`
    );
  }
  const temporalType = (value: CompiledWorkflowExpression) => {
    const type = value.type ? normalizeDslTypeName(value.type) : '';
    return type === 'date' || type === 'datetime' ? type : '';
  };
  const startType = temporalType(start);
  const endType = temporalType(end);
  if (!startType || !endType) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} fn.dateDiff start and end must be date or timestamp expressions`
    );
  }
  if (startType !== endType) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} fn.dateDiff start and end must have compatible temporal types; received ${startType} and ${endType}`
    );
  }
}

function assertCompiledDatePartArgs(args: CompiledWorkflowExpression[], context: string): void {
  const unit = args[0];
  const normalizedUnit =
    typeof unit?.literalValue === 'string' ? unit.literalValue.trim().toLowerCase() : '';
  if (!WORKFLOW_DATE_DIFF_UNIT_SET.has(normalizedUnit)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow ${context} date part must be a supported literal unit`
    );
  }
}

function assertCompiledFormatLiteralArgs(
  name: string,
  args: CompiledWorkflowExpression[],
  context: string
): void {
  if (typeof args[1]?.literalValue === 'string' && args[1].literalValue.length > 0) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow ${context} ${name} format must be a non-empty string literal`
  );
}

function compileWorkflowWindowValue(
  operation: Extract<WorkflowOperationIr, { type: 'derive_window' }>,
  context: WorkflowIrLoweringContext
): {
  call: string;
  type?: string;
  sourceColumns: Array<{ name: string; type?: string }>;
} {
  const fn = operation.function;
  const aggregateFunction = normalizeWorkflowAggregateFunction(fn);
  if (aggregateFunction) {
    const metric = compileWorkflowAggregateMetric(
      {
        fn: aggregateFunction,
        expression: operation.expression ?? '*',
        alias: operation.column,
        parameters: operation.parameters,
      },
      context
    );
    return {
      call: formatWorkflowAggregateCall(aggregateFunction, metric.expression ?? '*'),
      type: metric.type,
      sourceColumns: metric.sourceColumns,
    };
  }
  if (['row_number', 'rank', 'dense_rank'].includes(fn)) {
    return { call: `${fn}()`, type: 'integer', sourceColumns: [] };
  }
  if (fn === 'percent_rank' || fn === 'cume_dist') {
    return { call: `${fn}()`, type: 'decimal', sourceColumns: [] };
  }
  if (fn === 'ntile') {
    return { call: `ntile(${operation.buckets})`, type: 'integer', sourceColumns: [] };
  }
  const compiled =
    operation.expression && operation.expression !== '*'
      ? compileWorkflowExpression(operation.expression, context, 'derive_window.expression')
      : null;
  if (!compiled) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated derive_window ${fn} requires an expression`
    );
  }
  if (fn === 'first_value' || fn === 'last_value') {
    return {
      call: `${fn}(${compiled.dsl})`,
      type: compiled.type,
      sourceColumns: compiled.sourceColumns,
    };
  }
  if (fn === 'nth_value') {
    return {
      call: `nth_value(${compiled.dsl}, ${operation.nth})`,
      type: compiled.type,
      sourceColumns: compiled.sourceColumns,
    };
  }
  if (fn === 'lag' || fn === 'lead') {
    const args = [compiled.dsl];
    if (operation.offset !== undefined || operation.defaultValue !== undefined) {
      args.push(String(operation.offset ?? 1));
    }
    if (operation.defaultValue !== undefined) {
      const defaultType =
        typeof operation.defaultValue === 'string'
          ? 'text'
          : inferLiteralValueType(operation.defaultValue);
      if (compiled.type && defaultType && !areComparableColumnTypes(compiled.type, defaultType)) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Generated derive_window ${fn} defaultValue is incompatible with ${compiled.dsl} (${compiled.type})`
        );
      }
      args.push(literalToDsl(operation.defaultValue));
    }
    return {
      call: `${fn}(${args.join(', ')})`,
      type: compiled.type,
      sourceColumns: compiled.sourceColumns,
    };
  }
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated derive_window uses unsupported function: ${fn}`
  );
}

function formatWorkflowWindowFrame(frame: WorkflowWindowFrame): string {
  const parts = [
    `${frame.type.toUpperCase()} BETWEEN ${formatWorkflowWindowFrameBound(frame.start)} AND ${formatWorkflowWindowFrameBound(frame.end)}`,
  ];
  if (frame.exclude) parts.push(`EXCLUDE ${frame.exclude.replace('_', ' ').toUpperCase()}`);
  return parts.join(' ');
}

function formatWorkflowWindowFrameBound(bound: WorkflowWindowFrameBound): string {
  switch (bound.type) {
    case 'unbounded_preceding':
      return 'UNBOUNDED PRECEDING';
    case 'current_row':
      return 'CURRENT ROW';
    case 'unbounded_following':
      return 'UNBOUNDED FOLLOWING';
    case 'preceding':
    case 'following': {
      const offset = bound.unit
        ? `INTERVAL ${bound.offset} ${bound.unit.toUpperCase()}`
        : String(bound.offset);
      return `${offset} ${bound.type.toUpperCase()}`;
    }
  }
}

function formatWorkflowAggregateCall(fn: string, expression: string): string {
  return fn === 'count_distinct' ? `count(DISTINCT ${expression})` : `${fn}(${expression})`;
}

function compileWorkflowAggregateMetric(
  metric: WorkflowMetricIr,
  context: WorkflowIrLoweringContext
): {
  dsl: string;
  alias: string;
  type?: string;
  sourceColumns: Array<{ name: string; type?: string }>;
  expression?: string;
} {
  const fn = normalizePlanAggregateFunction(metric.fn);
  const compiled =
    metric.expression === '*'
      ? null
      : compileWorkflowExpression(metric.expression, context, 'aggregate.metrics.expression');
  const sourceBinding = compiled
    ? {
        name: compiled.dsl,
        type: compiled.type,
        sourceColumns: compiled.sourceColumns,
        expression: compiled.dsl,
      }
    : null;
  assertAggregateMetricType(fn, sourceBinding);
  const alias = normalizeRequiredName(metric.alias, 'Generated aggregate metric requires alias');
  const expression = [compiled?.dsl ?? '*', ...(metric.parameters ?? []).map(literalToDsl)].join(
    ', '
  );
  return {
    dsl: `${formatWorkflowAggregateCall(fn, expression)} as ${formatDslField(alias)}`,
    alias,
    type: inferAggregateMetricType(fn, sourceBinding),
    sourceColumns: compiled?.sourceColumns ?? [],
    expression,
  };
}

function normalizeWorkflowFunctionArgs(
  expression: Extract<WorkflowExpressionIr, { kind: 'function' }>
): WorkflowExpressionIr[] {
  if (expression.name !== 'regexpExtract' || expression.args.length !== 2) {
    return expression.args;
  }
  const pattern = expression.args[1];
  if (
    pattern?.kind === 'literal' &&
    typeof pattern.value === 'string' &&
    regexHasCaptureGroup(pattern.value)
  ) {
    return [...expression.args, { kind: 'literal', value: 1 }];
  }
  return expression.args;
}

function regexHasCaptureGroup(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '(' && pattern[index + 1] !== '?') return true;
  }
  return false;
}

function workflowFunctionNameToDsl(name: string): string {
  const dslName = workflowExpressionFunctionToDsl(name);
  if (dslName) return dslName;
  throw new DataCommandError('VALIDATION_FAILED', `Unsupported workflow function: fn.${name}`);
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

function normalizePlanTargetType(targetType: unknown): string {
  const normalized =
    typeof targetType === 'string' ? normalizeWorkflowExpressionCastType(targetType) : undefined;
  if (normalized) return normalized;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated convert_type operation uses unsupported targetType: ${String(targetType)}`
  );
}

function compilePlanTypeConversionExpression({
  columnName,
  targetType,
  removePrefix,
  removeChars,
  scale,
  failOnError,
}: {
  columnName: string;
  targetType: string;
  removePrefix: string;
  removeChars: string[];
  scale: unknown;
  failOnError: boolean;
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
  return `${failOnError ? 'CAST' : 'TRY_CAST'}(${expression} AS ${storageType})`;
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

function createGeneratedCompatibilityColumnName(
  purpose: string,
  currentColumns: GeneratedWorkflowColumnBinding[]
): string {
  const existing = new Set(currentColumns.map((column) => column.name.toLowerCase()));
  const safePurpose = purpose.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'value';
  let candidate = `__sophron_ai_${safePurpose}`;
  let index = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `__sophron_ai_${safePurpose}_${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeDecimalScale(scale: unknown): number {
  if (scale === undefined || scale === null) return WORKFLOW_DEFAULT_DECIMAL_SCALE;
  if (isWorkflowDecimalScale(scale)) return scale;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated decimal scale must be an integer from ${WORKFLOW_DECIMAL_SCALE_MIN} to ${WORKFLOW_DECIMAL_SCALE_MAX}; received ${String(scale)}`
  );
}

function normalizePlanAggregateFunction(fn: unknown): string {
  const normalized = normalizeWorkflowAggregateFunction(fn);
  if (normalized) return normalized;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated aggregate operation uses unsupported function: ${String(fn)}`
  );
}

function sourceColumnsFromBinding(
  column: GeneratedWorkflowColumnBinding
): Array<{ name: string; type?: string }> {
  if (column.sourceColumns && column.sourceColumns.length > 0) return column.sourceColumns;
  return column.sourceColumn ? [column.sourceColumn] : [];
}

export function toAutomationColumnSnapshot(
  column: GeneratedWorkflowColumnBinding | DataAutomationColumnSnapshot
): DataAutomationColumnSnapshot {
  return {
    name: column.name,
    type: column.type ? normalizeDslTypeName(column.type) : undefined,
  };
}

function toAutomationLineageEntry(
  column: GeneratedWorkflowColumnBinding
): DataAutomationLineageEntry {
  return {
    ...toAutomationColumnSnapshot(column),
    sourceColumns: sourceColumnsFromBinding(column).map(toAutomationColumnSnapshot),
    expression: column.expression,
  };
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
  const definition = getWorkflowAggregateFunctionDefinition(fn);
  if (!sourceColumn || definition?.argumentType === 'any') return;
  const incompatible =
    definition?.argumentType === 'numeric'
      ? sourceColumn.type && !isNumericDslType(sourceColumn.type)
      : sourceColumn.type && normalizeDslTypeName(sourceColumn.type) !== 'text';
  if (incompatible) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated aggregate metric ${fn} requires a ${definition?.argumentType} column, got ${sourceColumn.name} (${sourceColumn.type})`
    );
  }
}

function inferAggregateMetricType(
  fn: string,
  sourceColumn: GeneratedWorkflowColumnBinding | null
): string | undefined {
  const resultType = getWorkflowAggregateFunctionDefinition(fn)?.resultType;
  if (resultType === 'integer' || resultType === 'decimal' || resultType === 'text') {
    return resultType;
  }
  if (fn === 'sum')
    return sourceColumn?.type && isDecimalLikeDslType(sourceColumn.type) ? 'decimal' : 'integer';
  return sourceColumn?.type;
}

function uniqueSourceColumns(
  columns: Array<{ name: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const unique = new Map<string, { name: string; type?: string }>();
  for (const column of columns) {
    unique.set(column.name.toLowerCase(), column);
  }
  return [...unique.values()];
}

function withoutUndefinedProperties(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

export function areComparableColumnTypes(left: string, right: string): boolean {
  const normalizedLeft = normalizeDslTypeName(left);
  const normalizedRight = normalizeDslTypeName(right);
  return (
    normalizedLeft === normalizedRight ||
    (isNumericDslType(normalizedLeft) && isNumericDslType(normalizedRight))
  );
}

function areOrderedComparableColumnTypes(left: string, right: string): boolean {
  const normalizedLeft = normalizeDslTypeName(left);
  const normalizedRight = normalizeDslTypeName(right);
  if (isNumericDslType(normalizedLeft) && isNumericDslType(normalizedRight)) return true;
  if (
    ['date', 'datetime'].includes(normalizedLeft) &&
    ['date', 'datetime'].includes(normalizedRight)
  ) {
    return true;
  }
  return normalizedLeft === 'text' && normalizedRight === 'text';
}

function inferDroppedColumnsFromSelectOperation(
  selectedNames: string[],
  context: WorkflowIrLoweringContext
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
