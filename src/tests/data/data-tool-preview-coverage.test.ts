import { describe, expect, it } from 'vitest';
import {
  AGENT_RESULT_PREVIEW_MAX_ROWS,
  formatPreviewCoverage,
} from '../../main/data/data-tool-preview-format';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe('formatPreviewCoverage', () => {
  it('marks a truncated preview and tells the agent how to fetch the rest', () => {
    const text = formatPreviewCoverage({ rows: rows(5), totalRows: 6, offset: 0, limit: 5 }, true, {
      tableKind: 'result',
      id: 'r1',
    });
    expect(text).toContain('rows 1-5 of 6 shown; 1 row(s) NOT shown');
    expect(text).toContain('Never describe, count or fill in rows you have not seen');
    expect(text).toContain('id:"r1", includeRows:true, limit:100, offset:5');
  });

  it('confirms a complete preview', () => {
    expect(formatPreviewCoverage({ rows: rows(7), totalRows: 7, offset: 0, limit: 20 }, true)).toBe(
      'Coverage: all 7 row(s) shown above (complete).'
    );
  });

  it('says no rows were seen for schema-only previews', () => {
    const text = formatPreviewCoverage(
      { rows: rows(1), totalRows: 6, offset: 0, limit: 1 },
      false,
      {
        tableKind: 'result',
        id: 'r1',
      }
    );
    expect(text).toContain('Row values NOT included');
    expect(text).toContain('You have not seen any row');
  });

  it('handles paging and empty tables', () => {
    expect(
      formatPreviewCoverage({ rows: rows(2), totalRows: 7, offset: 5, limit: 100 }, true)
    ).toContain('rows 6-7 of 7 shown');
    expect(formatPreviewCoverage({ rows: [], totalRows: 0, offset: 0, limit: 5 }, true)).toBe(
      'The table has 0 rows.'
    );
  });

  it('returns enough inline result rows for small reconciliation outputs', () => {
    expect(AGENT_RESULT_PREVIEW_MAX_ROWS).toBeGreaterThanOrEqual(20);
  });
});
