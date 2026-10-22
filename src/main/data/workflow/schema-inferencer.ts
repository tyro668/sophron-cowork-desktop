import type { WorkflowDiagnostic } from '../../../shared/workflow-diagnostics';
import type { DataAutomationColumnSnapshot, DataRawTablePreview } from '../../../shared/contracts';
import { DataCommandError } from '../data-command-types';
import { isNumericDslType, normalizeColumnType, normalizeDslTypeName } from './utils';

export function toAutomationColumnSnapshot(column: {
  name: string;
  type?: string;
}): DataAutomationColumnSnapshot {
  return { name: column.name, type: column.type ? normalizeDslTypeName(column.type) : undefined };
}

export function areComparableColumnTypes(left: string, right: string): boolean {
  const normalizedLeft = normalizeDslTypeName(left);
  const normalizedRight = normalizeDslTypeName(right);
  return (
    normalizedLeft === normalizedRight ||
    (isNumericDslType(normalizedLeft) && isNumericDslType(normalizedRight))
  );
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

export function validateGeneratedPipelineSchema(
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

export function outputSchemaFromPreview(
  preview: DataRawTablePreview | undefined
): DataAutomationColumnSnapshot[] {
  if (!preview) return [];
  const columns = preview.columnTypes.length
    ? preview.columnTypes.map((column) => ({ name: column.name, type: column.type }))
    : preview.columns.map((name) => ({ name }));
  return columns.map(toAutomationColumnSnapshot);
}

export function validateGeneratedOutputPreviewSchema(
  preview: DataRawTablePreview | undefined,
  expectedOutputSchema: Array<{ name: string; type?: string }>
): WorkflowDiagnostic[] {
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
  const diagnostics: WorkflowDiagnostic[] = [];
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

export function normalizeColumnSnapshot(
  primary?: Array<{ name?: string; type?: string }>,
  fallback?: Array<{ name?: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const source = primary?.length ? primary : fallback;
  return (source ?? [])
    .map((column) => ({
      name: String(column.name ?? '').trim(),
      type: typeof column.type === 'string' ? column.type : undefined,
    }))
    .filter((column) => Boolean(column.name));
}
