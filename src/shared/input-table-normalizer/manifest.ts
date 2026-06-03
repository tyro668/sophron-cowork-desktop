export type InputTableNormalizerOutputFormat = 'csv' | 'parquet';

export interface InputTableNormalizerManifestColumn {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface InputTableNormalizerManifest {
  output: string;
  format: InputTableNormalizerOutputFormat;
  rowCount?: number;
  columns: InputTableNormalizerManifestColumn[];
  warnings: string[];
}

export function parseInputTableNormalizerManifest(value: unknown): InputTableNormalizerManifest {
  if (!isRecord(value)) {
    throw new Error('Normalizer manifest must be a JSON object');
  }
  const output = stringField(value.output, 'output');
  const format = normalizeManifestFormat(value.format);
  const columns = normalizeManifestColumns(value.columns);
  return {
    output,
    format,
    rowCount: optionalPositiveInteger(value.rowCount),
    columns,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function normalizeManifestFormat(value: unknown): InputTableNormalizerOutputFormat {
  if (value === 'csv' || value === 'parquet') {
    return value;
  }
  throw new Error('Normalizer manifest format must be csv or parquet');
}

function normalizeManifestColumns(value: unknown): InputTableNormalizerManifestColumn[] {
  if (!Array.isArray(value)) {
    throw new Error('Normalizer manifest columns must be an array');
  }
  const columns = value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [
        {
          name: item.trim(),
          type: 'string',
          nullable: undefined,
        },
      ];
    }
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) {
      return [];
    }
    return [
      {
        name: item.name.trim(),
        type: typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'string',
        nullable: typeof item.nullable === 'boolean' ? item.nullable : undefined,
      },
    ];
  });
  if (columns.length === 0) {
    throw new Error('Normalizer manifest must include at least one column');
  }
  return columns;
}

function stringField(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`Normalizer manifest ${name} is required`);
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
