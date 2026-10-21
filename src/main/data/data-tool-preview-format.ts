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
