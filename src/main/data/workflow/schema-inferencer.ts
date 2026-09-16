import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import type {
  DataAutomationColumnSnapshot,
  DataInputTablePreview,
} from '../../../shared/contracts';
import { DataCommandError } from '../data-command-types';
import {
  type GeneratedDataTaskWorkflow,
  areComparableColumnTypes,
  toAutomationColumnSnapshot,
} from './workflow-ir-lowerer';
import { normalizeColumnType } from './utils';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from './prep-dsl-capability-profile';
import { computeWorkflowIrSemanticHash, validateAndNormalizeWorkflowIr } from './workflow-ir';
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
  generated: GeneratedDataTaskWorkflow,
  sourceColumns: DataAutomationColumnSnapshot[]
): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = [];
  const sourceByName = new Map(sourceColumns.map((column) => [column.name.toLowerCase(), column]));

  if (generated.runtimeCompatibilityProfileVersion !== AI_PREP_DSL_RUNTIME_PROFILE_VERSION) {
    diagnostics.push({
      severity: 'error',
      code: 'runtimeCompatibilityProfileMismatch',
      message: `Generated workflow runtime compatibility profile mismatch: expected ${AI_PREP_DSL_RUNTIME_PROFILE_VERSION}, got ${generated.runtimeCompatibilityProfileVersion || 'missing'}`,
    });
  }

  try {
    const normalizedIr = validateAndNormalizeWorkflowIr(generated.workflowIr);
    const semanticHash = computeWorkflowIrSemanticHash(normalizedIr);
    if (!generated.workflowIrSemanticHash) {
      diagnostics.push({
        severity: 'error',
        code: 'workflowIrSemanticHashMissing',
        message: 'Generated workflow is missing its Workflow IR semantic hash',
      });
    } else if (generated.workflowIrSemanticHash !== semanticHash) {
      diagnostics.push({
        severity: 'error',
        code: 'workflowIrSemanticHashMismatch',
        message:
          'Generated workflow JavaScript, Workflow IR, and derived artifacts no longer describe the same semantics',
      });
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'workflowIrInvalid',
      message: `Generated workflow contains invalid Workflow IR: ${
        error instanceof Error ? error.message.replace(/^\[[A-Z_]+\]\s*/, '') : String(error)
      }`,
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
  generated: GeneratedDataTaskWorkflow,
  preview: DataInputTablePreview | undefined,
  sourceColumns: DataAutomationColumnSnapshot[]
): GeneratedDataTaskWorkflow {
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
