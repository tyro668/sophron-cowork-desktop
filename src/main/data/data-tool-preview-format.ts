import type { DataRawTablePreview } from '../../shared/contracts/data';

/** Max result rows returned inline to the agent after a run / run-result lookup. */
export const AGENT_RESULT_PREVIEW_MAX_ROWS = 20;

export interface PreviewCoverageTarget {
  tableKind: 'raw' | 'result';
  id: string;
}

/**
 * Explicit statement of which rows the agent has actually seen, so conclusions
 * are grounded in returned data instead of inferred / invented rows.
 */
export function formatPreviewCoverage(
  preview: Pick<DataRawTablePreview, 'rows' | 'totalRows' | 'offset' | 'limit'>,
  includeRows: boolean,
  target?: PreviewCoverageTarget
): string {
  const total = preview.totalRows;
  const fetchHint = (offset: number) =>
    target
      ? `data_preview_table({tableKind:"${target.tableKind}", id:"${target.id}", includeRows:true, limit:100, offset:${offset}})`
      : 'data_preview_table with includeRows=true and an offset';
  if (!includeRows) {
    return total > 0
      ? `Row values NOT included (schema only; totalRows=${total}). You have not seen any row of this table: do not list, count by category or summarize its rows until you read them with ${fetchHint(0)}.`
      : 'The table has 0 rows.';
  }
  const shown = Math.min(preview.rows.length, preview.limit || preview.rows.length);
  const offset = preview.offset ?? 0;
  if (total === 0 || shown === 0) {
    return total === 0
      ? 'The table has 0 rows.'
      : `No rows returned at offset ${offset} (totalRows=${total}).`;
  }
  const end = offset + shown;
  if (offset === 0 && end >= total) {
    return `Coverage: all ${total} row(s) shown above (complete).`;
  }
  const missing = total - shown;
  return (
    `Coverage: rows ${offset + 1}-${end} of ${total} shown; ${missing} row(s) NOT shown. ` +
    `Never describe, count or fill in rows you have not seen — say the data is incomplete, or read the rest with ${fetchHint(end >= total ? 0 : end)}.`
  );
}

const NUMERIC_FIELD_TYPES = new Set(['integer', 'float', 'decimal']);
const DECIMAL_LITERAL = /^(-?)(\d+)(?:\.(\d+))?$/;
/** Totals are only computed for small, fully returned result sets. */
const COLUMN_TOTALS_MAX_ROWS = 200;

/** Exact decimal sum of the literal values, avoiding binary float drift. */
function sumDecimalLiterals(values: string[]): string | null {
  const parsed = values.map((value) => DECIMAL_LITERAL.exec(value));
  if (parsed.some((match) => !match)) return null;
  const scale = Math.max(0, ...parsed.map((match) => match![3]?.length ?? 0));
  let total = 0n;
  for (const match of parsed) {
    const [, sign, whole, fraction = ''] = match!;
    const units = BigInt(whole + fraction.padEnd(scale, '0'));
    total += sign ? -units : units;
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Exact totals of numeric columns when every row of a small table was returned,
 * so the model quotes them instead of adding numbers itself.
 */
export function formatNumericColumnTotals(
  preview: Pick<DataRawTablePreview, 'rows' | 'totalRows' | 'offset' | 'limit' | 'columnTypes'>
): string {
  const rows = preview.limit ? preview.rows.slice(0, preview.limit) : preview.rows;
  const complete =
    (preview.offset ?? 0) === 0 && rows.length > 1 && rows.length >= preview.totalRows;
  if (!complete || rows.length > COLUMN_TOTALS_MAX_ROWS) return '';
  const totals: Record<string, string> = {};
  for (const column of preview.columnTypes) {
    if (!NUMERIC_FIELD_TYPES.has(column.type)) continue;
    const values = rows
      .map((row) => row[column.name])
      .filter((value) => value !== null && value !== undefined && value !== '');
    if (values.length === 0) continue;
    if (values.some((value) => typeof value !== 'number' && typeof value !== 'string')) continue;
    const total = sumDecimalLiterals(values.map((value) => String(value).trim()));
    if (total !== null) totals[column.name] = total;
  }
  if (Object.keys(totals).length === 0) return '';
  return `Exact column totals over all ${rows.length} rows (computed by the app; quote these instead of adding values yourself; round half up only when converting units): ${JSON.stringify(totals)}`;
}
