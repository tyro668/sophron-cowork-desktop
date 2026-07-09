export const DATA_FIELD_TYPES = [
  'text',
  'date',
  'datetime',
  'integer',
  'float',
  'decimal',
  'boolean',
] as const;

export type DataFieldType = (typeof DATA_FIELD_TYPES)[number];

export interface DataColumnTypeInfo {
  name: string;
  type: DataFieldType;
  storageType: string;
}

export const DATA_FIELD_TYPE_LABELS: Record<DataFieldType, string> = {
  text: '文本',
  date: '日期',
  datetime: '日期时间',
  integer: '整数',
  float: '浮点小数',
  decimal: '定点小数',
  boolean: '布尔',
};

export function normalizeDataFieldType(value: string | null | undefined): DataFieldType {
  const type = String(value ?? '')
    .trim()
    .toLowerCase();
  const normalized = type as DataFieldType;
  return isDataFieldType(type) ? normalized : 'text';
}

export function isDataFieldType(value: string | null | undefined): boolean {
  return DATA_FIELD_TYPES.includes(
    String(value ?? '')
      .trim()
      .toLowerCase() as DataFieldType
  );
}

export function requireDataFieldType(
  value: string | null | undefined,
  context = 'data field type'
): DataFieldType {
  const type = String(value ?? '')
    .trim()
    .toLowerCase();
  const normalized = type as DataFieldType;
  if (isDataFieldType(type)) return normalized;
  throw new Error(
    `Unsupported ${context}: ${String(value ?? '')}. Use one of ${DATA_FIELD_TYPES.join(', ')}.`
  );
}

export function dataFieldTypeFromDuckDbType(storageType: string | null | undefined): DataFieldType {
  const type = String(storageType ?? '')
    .trim()
    .toUpperCase();
  if (!type) return 'text';
  if (type.includes('TIMESTAMP') || type.includes('TIME WITH TIME ZONE')) return 'datetime';
  if (type === 'DATE') return 'date';
  if (type.includes('BOOL')) return 'boolean';
  if (type.includes('DECIMAL') || type.includes('NUMERIC')) return 'decimal';
  if (type.includes('DOUBLE') || type.includes('FLOAT') || type.includes('REAL')) return 'float';
  if (
    type.includes('INT') ||
    type === 'TINYINT' ||
    type === 'SMALLINT' ||
    type === 'BIGINT' ||
    type === 'HUGEINT'
  ) {
    return 'integer';
  }
  return 'text';
}

export function duckDbTypeForDataFieldType(value: string | null | undefined): string {
  switch (requireDataFieldType(value, 'DuckDB storage type')) {
    case 'text':
      return 'VARCHAR';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'TIMESTAMPTZ';
    case 'integer':
      return 'BIGINT';
    case 'float':
      return 'DOUBLE';
    case 'decimal':
      return 'DECIMAL(18, 6)';
    case 'boolean':
      return 'BOOLEAN';
  }
}

export function dataFieldTypeLabel(value: string | null | undefined): string {
  return DATA_FIELD_TYPE_LABELS[normalizeDataFieldType(value)];
}

export function isNumericDataFieldType(value: string | null | undefined): boolean {
  const type = normalizeDataFieldType(value);
  return type === 'integer' || type === 'float' || type === 'decimal';
}

export function isTemporalDataFieldType(value: string | null | undefined): boolean {
  const type = normalizeDataFieldType(value);
  return type === 'date' || type === 'datetime';
}
