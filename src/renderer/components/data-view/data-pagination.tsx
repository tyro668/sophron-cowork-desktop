import { getVisiblePageNumbers } from '../../utils/pagination';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui';

export const TABLE_PAGE_SIZE = 10;
export function PaginationFooter({
  count,
  currentPage,
  onPageChange,
  embedded = false,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const pageCount = getTablePageCount(count);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);

  return (
    <div
      className={`flex min-h-14 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-1' : 'mt-3'
      }`}
    >
      <span>{t('data.totalCount', { count })}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="md"
          className="min-w-[7rem] text-text-secondary shadow-soft"
        >
          {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-2">
          {pageCount > 1 && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={safeCurrentPage <= 1}
              className="text-text-muted shadow-soft hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:opacity-45"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {pageNumbers.map((pageNumber) => (
            <Button
              key={pageNumber}
              variant="secondary"
              size="icon"
              onClick={() => onPageChange(pageNumber)}
              aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
              className={`text-sm shadow-soft ${
                pageNumber === safeCurrentPage
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent'
              }`}
            >
              {pageNumber}
            </Button>
          ))}
          {pageCount > 1 && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={safeCurrentPage >= pageCount}
              className="text-text-secondary shadow-soft hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:opacity-45"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function getTablePageCount(count: number): number {
  return Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
}
