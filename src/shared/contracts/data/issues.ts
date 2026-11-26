export interface RawTableIssue {
  kind: 'raw-table-issue';
  code: 'E_RAW_TABLE_ABNORMAL' | 'DATA_CSV_ENCODING_ERROR';
  message: string;
}

export type RawTableResult<T> = T | RawTableIssue;

export function isRawTableIssue(value: unknown): value is RawTableIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'raw-table-issue' &&
    'code' in value &&
    (value.code === 'E_RAW_TABLE_ABNORMAL' || value.code === 'DATA_CSV_ENCODING_ERROR') &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

export class RawTableError extends Error implements RawTableIssue {
  readonly kind = 'raw-table-issue' as const;

  constructor(
    readonly code: RawTableIssue['code'],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'RawTableError';
  }
}

export function unwrapRawTableResult<T>(value: RawTableResult<T>): T {
  if (isRawTableIssue(value)) throw new RawTableError(value.code, value.message);
  return value;
}
