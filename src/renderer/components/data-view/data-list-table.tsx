import type { ReactNode } from 'react';

/** Shared header chrome for page-variant data list tables (原始表 / 结果表). */
export const DATA_LIST_HEADER_ROW_CLASS =
  'h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted';

/** Shared data-row chrome for page-variant lists: solid rules, result-table typography. */
export const DATA_LIST_PAGE_ROW_CLASS =
  'h-[3.25rem] cursor-pointer border-b border-border-muted/85 transition-colors';

/** Boxed type icon used by the 结果表 list; raw-table page rows reuse the same treatment. */
export function DataListTypeIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted">
      {children}
    </span>
  );
}

/**
 * Fill-height list table: sticky header, a borderless filler so leftover space stays
 * plain surface (column rules stop at the last data row), and a single ancestor
 * scroller (`overflow-auto`) so the thead can stick.
 */
export function DataListTable({
  testId,
  colSpan,
  header,
  children,
}: {
  testId: string;
  colSpan: number;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="data-list-table-shell" data-testid={testId}>
      <table className="data-list-table data-list-table-fill w-full table-fixed border-collapse text-left">
        <thead>{header}</thead>
        <tbody>
          {children}
          <tr data-list-filler="true" data-testid="data-list-filler" aria-hidden="true">
            <td colSpan={colSpan} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
