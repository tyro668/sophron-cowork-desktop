import type { DataColumnTypeInfo } from '../../../shared/data-field-types';
import { ColumnType } from '../../local-agent/excel/field-type';

/** DataFieldType → 云端 ExcelMeta.speType（STRING 6 / NUMBER 5 / DATE 9）。 */
export function speTypeFromDataFieldType(type: string | null | undefined): number {
  switch (type) {
    case 'integer':
    case 'float':
    case 'decimal':
      return ColumnType.Double;
    case 'date':
    case 'datetime':
      return ColumnType.Timestamp;
    default:
      return ColumnType.String;
  }
}

export function speTypesFromColumns(types: DataColumnTypeInfo[]): number[] {
  return types.map((column) => speTypeFromDataFieldType(column.type));
}

export function recordToCells(row: Record<string, unknown>, columns: string[]): (string | null)[] {
  return columns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined) return null;
    return String(value);
  });
}
