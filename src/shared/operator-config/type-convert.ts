import type { DataFieldType } from '../data-field-types';
import { SCALE_MAX, SCALE_MIN, type TypeConversionEntry } from '../operator-schemas/type-convert';

export function prepareTypeConversion(type: DataFieldType): Partial<TypeConversionEntry> {
  return {
    type,
    ...(type === 'date' || type === 'datetime' ? {} : { format: undefined }),
    ...(type === 'decimal' ? {} : { scale: undefined }),
  };
}

export function parseTypeConversionScale(value: string): number | undefined {
  if (value === '') return undefined;
  const scale = Number(value);
  if (!Number.isInteger(scale) || scale < SCALE_MIN || scale > SCALE_MAX) return undefined;
  return scale;
}
