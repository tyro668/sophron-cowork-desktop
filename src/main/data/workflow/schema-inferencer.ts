import {
  parsePrepDsl,
  type PrepDiagnostic,
  type PrepOperatorAst,
  type PrepWorkflowAst,
} from '../../../shared/prep-dsl';
import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
  DataInputTablePreview,
} from '../../../renderer/types';
import { DataCommandError } from '../data-command-types';
import { computeMappingTarget } from '../operators/utils';
import {
  ColumnStateTracker,
  type GeneratedWorkflowColumnBinding,
  type GeneratedWorkflowGenerationResult,
  areComparableColumnTypes,
  assertExpressionTypeCompatible,
  inferAggregateMetricType,
  inferExpressionResultType,
  uniqueSourceColumns,
} from './operation-compiler';
import {
  mergeAutomationColumns,
  sourceColumnsFromBinding,
  toAutomationColumnSnapshot,
  toAutomationLineageEntry,
} from './lineage';
import {
  diagnosticsWithSeverity,
  extractFieldNamesFromExpression,
  extractJsonObject,
  findDslBacktickFieldEnd,
  isRecord,
  normalizeColumnType,
  normalizeDslTypeName,
  objectArray,
  stripQualifiedFieldName,
  summarizeDiagnostics,
} from './utils';

export function reconcileGeneratedWorkflowWithDslInference(
  compiled: GeneratedWorkflowGenerationResult,
  columns: Array<{ name: string; type?: string }>
): GeneratedWorkflowGenerationResult {
  return validateCompiledWorkflowDsl(compiled, columns);
}

export function validateCompiledWorkflowDsl(
  compiled: GeneratedWorkflowGenerationResult,
  columns: Array<{ name: string; type?: string }>
): GeneratedWorkflowGenerationResult {
  const validated = parseGeneratedWorkflowDslResponse(
    JSON.stringify({
      workflowDsl: compiled.workflowDsl,
      requiredColumns: compiled.requiredColumns,
    }),
    columns
  );
  return {
    ...compiled,
    requiredColumns: mergeAutomationColumns(compiled.requiredColumns, validated.requiredColumns),
    expectedOutputSchema: validated.expectedOutputSchema,
    lineage: validated.lineage,
  };
}

export function parseGeneratedWorkflowDslResponse(
  text: string,
  columns: Array<{ name: string; type?: string }>
): GeneratedWorkflowGenerationResult {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || typeof parsed.workflowDsl !== 'string') {
    throw new Error('Workflow DSL generation response must include workflowDsl');
  }
  const workflowDsl = parsed.workflowDsl.trim();
  validateGeneratedWorkflowDslText(workflowDsl);
  const parsedDsl = parsePrepDsl(workflowDsl);
  const parseErrors = diagnosticsWithSeverity(parsedDsl.diagnostics, 'error');
  if (!parsedDsl.ast || parseErrors.length > 0) {
    throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(parseErrors), {
      diagnostics: parsedDsl.diagnostics,
    });
  }
  if (parsedDsl.ast.sources.length === 0 || !parsedDsl.ast.output) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow must include an input source and an output table'
    );
  }
  validateGeneratedWorkflowAst(parsedDsl.ast.operators);

  const columnsByName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
  const modelRequiredColumns = Array.isArray(parsed.requiredColumns)
    ? parsed.requiredColumns
        .map((column) => {
          const name = isRecord(column) ? String(column.name ?? '').trim() : '';
          if (!name) return null;
          return columnsByName.get(name.toLowerCase()) ?? null;
        })
        .filter((column): column is { name: string; type?: string } => Boolean(column))
    : [];
  const inferredWorkflow = inferGeneratedWorkflowSchema(parsedDsl.ast, columns);
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  for (const column of modelRequiredColumns) {
    requiredColumnsByName.set(column.name.toLowerCase(), column);
  }
  for (const column of inferredWorkflow.requiredColumns) {
    requiredColumnsByName.set(column.name.toLowerCase(), column);
  }
  return {
    workflowDsl,
    requiredColumns: [...requiredColumnsByName.values()],
    expectedOutputSchema: inferredWorkflow.expectedOutputSchema,
    lineage: inferredWorkflow.lineage,
  };
}

function validateGeneratedWorkflowDslText(workflowDsl: string): void {
  const invalidQuotedFieldRef = /\[\s*['"]/.exec(workflowDsl);
  if (invalidQuotedFieldRef) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow uses invalid quoted field syntax. Use [`field name`] for fields with spaces.'
    );
  }
  if (hasBareBacktickOutsideString(workflowDsl)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow uses invalid bare backtick field syntax. Use [`field name`] inside expressions.'
    );
  }
}

function hasBareBacktickOutsideString(value: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' && value[index + 1] === '`') {
      const fieldEnd = findDslBacktickFieldEnd(value, index + 2);
      if (fieldEnd !== null) {
        index = fieldEnd;
        continue;
      }
    }
    if (char === '`') {
      return true;
    }
  }
  return false;
}

function validateGeneratedWorkflowAst(operators: PrepOperatorAst[]): void {
  for (const operator of operators) {
    if (
      operator.type === 'calculate_field' &&
      objectArray(operator.config.calculations).length === 0
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Generated derive operator has no valid calculations'
      );
    }
  }
}

function inferGeneratedWorkflowSchema(
  ast: PrepWorkflowAst,
  columns: Array<{ name: string; type?: string }>
): {
  requiredColumns: DataAutomationColumnSnapshot[];
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
} {
  const columnTracker = new ColumnStateTracker(columns, (name) =>
    stripQualifiedFieldName(name.trim())
  );
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  const requireName = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const name = stripQualifiedFieldName(value.trim());
    const column = columnTracker.requireColumn(
      name,
      'operation',
      'Generated workflow references empty input column',
      (columnName) => `Generated workflow references unknown input column(s): ${columnName}`
    );
    for (const sourceColumn of sourceColumnsFromBinding(column)) {
      requiredColumnsByName.set(sourceColumn.name.toLowerCase(), sourceColumn);
    }
    return column;
  };
  const requireNames = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value
      .map(requireName)
      .filter((column): column is GeneratedWorkflowColumnBinding => Boolean(column));
  };
  const requireExpression = (value: unknown, context = 'expression') => {
    if (typeof value !== 'string') return null;
    const referenced = extractFieldNamesFromExpression(value)
      .map((name) => requireName(name))
      .filter((column): column is GeneratedWorkflowColumnBinding => Boolean(column));
    assertExpressionTypeCompatible(value, referenced, context);
    return {
      name: '',
      type: inferExpressionResultType(value, referenced),
      sourceColumns: uniqueSourceColumns(referenced.flatMap(sourceColumnsFromBinding)),
      expression: value,
    };
  };
  const removeName = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    columnTracker.removeColumn(value);
  };
  const upsertName = (name: unknown, source?: GeneratedWorkflowColumnBinding | null) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const normalized = stripQualifiedFieldName(name.trim());
    columnTracker.upsertColumn({
      name: normalized,
      type: source?.type,
      sourceColumn: source?.sourceColumn,
      sourceColumns: source ? sourceColumnsFromBinding(source) : [],
      expression: source?.expression,
    });
  };
  const keepNames = (names: unknown) => {
    if (!Array.isArray(names)) return;
    columnTracker.keepColumns(
      names.map((item) => requireName(item)?.name).filter((name): name is string => Boolean(name))
    );
  };

  for (const operator of ast.operators) {
    const config = operator.config ?? {};
    switch (operator.type) {
      case 'field_select':
        if (config.mode === 'exclude') {
          requireNames(config.columns);
          if (Array.isArray(config.columns)) config.columns.forEach(removeName);
        } else {
          keepNames(config.columns);
        }
        break;
      case 'field_mapping':
        objectArray(config.mappings).forEach((mapping) => {
          const source = requireName(mapping.source);
          removeName(mapping.source);
          upsertName(computeMappingTarget(mapping), source);
        });
        break;
      case 'filter':
        requireExpression(config.condition, 'filter.condition');
        break;
      case 'deduplicate':
        requireNames(config.columns);
        objectArray(config.orderBy).forEach((key) => requireName(key.field));
        break;
      case 'missing_value':
        requireNames(config.columns);
        objectArray(config.rules).forEach((rule) => requireName(rule.column));
        break;
      case 'type_convert':
        objectArray(config.conversions).forEach((conversion) => {
          const column = requireName(conversion.column);
          if (column) {
            const targetType =
              typeof conversion.targetType === 'string'
                ? conversion.targetType
                : typeof conversion.type === 'string'
                  ? conversion.type
                  : undefined;
            columnTracker.upsertColumn({
              ...column,
              type: targetType ? normalizeDslTypeName(targetType) : column.type,
              sourceColumns: sourceColumnsFromBinding(column),
            });
          }
        });
        break;
      case 'sort':
        objectArray(config.keys).forEach((key) => requireName(key.field));
        break;
      case 'aggregate':
        {
          const groupBy = requireNames(config.groupBy);
          const metrics = objectArray(config.metrics).map((metric) => {
            const source =
              metric.expression === '*'
                ? null
                : requireExpression(metric.expression, 'aggregate.metrics');
            return {
              name: typeof metric.alias === 'string' ? metric.alias : '',
              type:
                typeof metric.function === 'string'
                  ? inferAggregateMetricType(metric.function, source)
                  : source?.type,
              sourceColumns: source ? sourceColumnsFromBinding(source) : [],
            };
          });
          columnTracker.replaceColumns(
            [...groupBy, ...metrics]
              .filter((column) => Boolean(column.name))
              .map((column) => ({
                name: column.name,
                type: column.type,
                sourceColumns: sourceColumnsFromBinding(column),
              }))
          );
        }
        break;
      case 'calculate_field':
        objectArray(config.calculations).forEach((calculation) => {
          upsertName(
            calculation.field,
            requireExpression(calculation.expression, 'derive.expression')
          );
        });
        break;
      case 'pivot':
        requireNames(config.on);
        requireNames(config.groupBy);
        objectArray(config.using).forEach((metric) => {
          if (metric.expression !== '*') requireExpression(metric.expression, 'pivot.metric');
        });
        break;
      case 'unpivot':
        requireNames(config.columns);
        break;
      case 'unnest':
        requireName(config.column);
        break;
      case 'join':
        objectArray(config.conditions).forEach((condition) => {
          requireName(condition.left);
          requireName(condition.right);
        });
        if (isRecord(config.asof)) {
          requireName(config.asof.leftTime);
          requireName(config.asof.rightTime);
          objectArray(config.asof.by).forEach((condition) => {
            requireName(condition.left);
            requireName(condition.right);
          });
        }
        objectArray(config.keep).forEach((item) => requireName(item.source));
        break;
      default:
        break;
    }
  }
  const outputColumns = columnTracker.getCurrentColumns();
  return {
    requiredColumns: [...requiredColumnsByName.values()],
    expectedOutputSchema: outputColumns.map(toAutomationColumnSnapshot),
    lineage: outputColumns.map(toAutomationLineageEntry),
  };
}

export function hashColumns(columns: Array<{ name: string; type?: string }>): string {
  const value = JSON.stringify(
    columns.map((column) => ({ name: column.name, type: column.type ?? null }))
  );
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `columns_${Math.abs(hash).toString(16)}`;
}

export function validateGeneratedTaskSchema(
  actualColumns: Array<{ name: string; type?: string }>,
  requiredColumns: Array<{ name: string; type?: string }>,
  policy: 'strict' | 'required_subset'
): void {
  const actualByName = new Map(actualColumns.map((column) => [column.name.toLowerCase(), column]));
  const missing = requiredColumns.filter((column) => !actualByName.has(column.name.toLowerCase()));
  if (missing.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Input schema drift detected. Missing required column(s): ${missing
        .map((column) => column.name)
        .join(', ')}`
    );
  }
  const incompatible = requiredColumns.filter((column) => {
    if (!column.type) return false;
    const actual = actualByName.get(column.name.toLowerCase());
    return Boolean(
      actual?.type && normalizeColumnType(actual.type) !== normalizeColumnType(column.type)
    );
  });
  if (incompatible.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Input schema drift detected. Incompatible required column type(s): ${incompatible
        .map((column) => {
          const actual = actualByName.get(column.name.toLowerCase());
          return `${column.name} expected ${column.type}, got ${actual?.type}`;
        })
        .join(', ')}`
    );
  }
  if (policy === 'strict' && actualColumns.length !== requiredColumns.length) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Input schema drift detected. Strict schema policy requires the same column set.'
    );
  }
}

export function validateGeneratedWorkflowGenerationContract(
  generated: GeneratedWorkflowGenerationResult,
  sourceColumns: DataAutomationColumnSnapshot[]
): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = [];
  const sourceByName = new Map(sourceColumns.map((column) => [column.name.toLowerCase(), column]));

  if (!generated.workflowDsl.trim()) {
    diagnostics.push({
      severity: 'error',
      code: 'workflowContractInvalid',
      message: 'Generated workflow is missing DSL text',
    });
  }

  if (generated.expectedOutputSchema.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'outputSchemaMissing',
      message:
        'Generated workflow must infer a non-empty expected output schema before it can be saved',
    });
  }

  const outputNames = new Set<string>();
  for (const column of generated.expectedOutputSchema) {
    const key = column.name.trim().toLowerCase();
    if (!key) {
      diagnostics.push({
        severity: 'error',
        code: 'outputSchemaInvalid',
        message: 'Generated workflow output schema contains an unnamed column',
      });
      continue;
    }
    if (outputNames.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'outputSchemaInvalid',
        message: `Generated workflow output schema contains duplicate column: ${column.name}`,
      });
    }
    outputNames.add(key);
    if (!column.type) {
      diagnostics.push({
        severity: 'error',
        code: 'outputSchemaInvalid',
        message: `Generated workflow output schema must infer a type for column: ${column.name}`,
      });
    }
  }

  for (const column of generated.requiredColumns) {
    const source = sourceByName.get(column.name.toLowerCase());
    if (!source) {
      diagnostics.push({
        severity: 'error',
        code: 'inputSchemaInvalid',
        message: `Generated workflow requires unknown input column: ${column.name}`,
      });
      continue;
    }
    if (column.type && source.type && !areComparableColumnTypes(column.type, source.type)) {
      diagnostics.push({
        severity: 'error',
        code: 'inputSchemaInvalid',
        message: `Generated workflow required column type mismatch: ${column.name} expected ${column.type}, source has ${source.type}`,
      });
    }
  }

  if (generated.lineage.length !== generated.expectedOutputSchema.length) {
    diagnostics.push({
      severity: 'error',
      code: 'lineageInvalid',
      message: `Generated workflow lineage count mismatch: expected ${generated.expectedOutputSchema.length}, got ${generated.lineage.length}`,
    });
  }

  const lineageLength = Math.min(generated.lineage.length, generated.expectedOutputSchema.length);
  for (let index = 0; index < lineageLength; index += 1) {
    const expected = generated.expectedOutputSchema[index];
    const lineage = generated.lineage[index];
    if (!expected || !lineage) continue;
    if (lineage.name !== expected.name) {
      diagnostics.push({
        severity: 'error',
        code: 'lineageInvalid',
        message: `Generated workflow lineage mismatch at position ${index + 1}: expected ${expected.name}, got ${lineage.name}`,
      });
    }
    if (expected.type && lineage.type && !areComparableColumnTypes(expected.type, lineage.type)) {
      diagnostics.push({
        severity: 'error',
        code: 'lineageInvalid',
        message: `Generated workflow lineage type mismatch: ${expected.name} expected ${expected.type}, got ${lineage.type}`,
      });
    }
    for (const sourceColumn of lineage.sourceColumns ?? []) {
      const source = sourceByName.get(sourceColumn.name.toLowerCase());
      if (!source) {
        diagnostics.push({
          severity: 'error',
          code: 'lineageInvalid',
          message: `Generated workflow lineage references unknown source column: ${sourceColumn.name}`,
        });
        continue;
      }
      if (
        sourceColumn.type &&
        source.type &&
        !areComparableColumnTypes(sourceColumn.type, source.type)
      ) {
        diagnostics.push({
          severity: 'error',
          code: 'lineageInvalid',
          message: `Generated workflow lineage source type mismatch: ${sourceColumn.name} expected ${sourceColumn.type}, source has ${source.type}`,
        });
      }
    }
  }

  return diagnostics;
}

export function reconcileGeneratedWorkflowWithOutputPreview(
  generated: GeneratedWorkflowGenerationResult,
  preview: DataInputTablePreview | undefined,
  sourceColumns: DataAutomationColumnSnapshot[]
): GeneratedWorkflowGenerationResult {
  const actualOutputSchema = outputSchemaFromPreview(preview);
  if (actualOutputSchema.length === 0) return generated;

  const sourceByName = new Map(
    sourceColumns.map((column) => [column.name.toLowerCase(), toAutomationColumnSnapshot(column)])
  );
  const lineageByName = new Map(
    generated.lineage.map((entry) => [entry.name.toLowerCase(), entry])
  );
  const lineage = actualOutputSchema.map((column) => {
    const existing = lineageByName.get(column.name.toLowerCase());
    if (existing) {
      return {
        ...existing,
        type: column.type ?? existing.type,
      };
    }
    const source = sourceByName.get(column.name.toLowerCase());
    return {
      ...column,
      sourceColumns: source ? [source] : [],
    };
  });

  return {
    ...generated,
    expectedOutputSchema: actualOutputSchema,
    lineage,
  };
}

function outputSchemaFromPreview(
  preview: DataInputTablePreview | undefined
): DataAutomationColumnSnapshot[] {
  if (!preview) return [];
  const columns = preview.columnTypes.length
    ? preview.columnTypes.map((column) => ({ name: column.name, type: column.type }))
    : preview.columns.map((name) => ({ name }));
  return columns.map(toAutomationColumnSnapshot);
}

export function validateGeneratedOutputPreviewSchema(
  preview: DataInputTablePreview | undefined,
  expectedOutputSchema: Array<{ name: string; type?: string }>
): PrepDiagnostic[] {
  if (expectedOutputSchema.length === 0) return [];
  if (!preview) {
    return [
      {
        severity: 'error',
        code: 'outputSchemaValidationFailed',
        message: 'Generated workflow did not produce an output preview for schema validation',
      },
    ];
  }
  const actualColumns = outputSchemaFromPreview(preview);
  const diagnostics: PrepDiagnostic[] = [];
  if (actualColumns.length !== expectedOutputSchema.length) {
    diagnostics.push({
      severity: 'error',
      code: 'outputSchemaMismatch',
      message: `Generated workflow output column count mismatch: expected ${expectedOutputSchema.length}, got ${actualColumns.length}`,
    });
  }
  const length = Math.min(actualColumns.length, expectedOutputSchema.length);
  for (let index = 0; index < length; index += 1) {
    const expected = expectedOutputSchema[index];
    const actual = actualColumns[index];
    if (!expected || !actual) continue;
    if (expected.name !== actual.name) {
      diagnostics.push({
        severity: 'error',
        code: 'outputSchemaMismatch',
        message: `Generated workflow output column mismatch at position ${index + 1}: expected ${expected.name}, got ${actual.name}`,
      });
      continue;
    }
    if (expected.type && actual.type && !areComparableColumnTypes(expected.type, actual.type)) {
      diagnostics.push({
        severity: 'error',
        code: 'outputSchemaMismatch',
        message: `Generated workflow output column type mismatch: ${expected.name} expected ${expected.type}, got ${actual.type}`,
      });
    }
  }
  return diagnostics;
}
