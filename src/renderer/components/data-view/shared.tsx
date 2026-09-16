import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Info,
  MoreHorizontal,
  RefreshCw,
  Search,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { DataOutputTable, DataTaskStatus } from '../../types';
import type { InputTableSourceKind } from '../../features/data/model/types';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export const TABLE_PAGE_SIZE = 10;
export const INPUT_TABLE_PREVIEW_PAGE_SIZE = 100;
export const OUTPUT_TABLE_INPUT_CHOICES_LIMIT = 200;
export const DATA_DELETE_BATCH_SIZE = 200;

export function makeLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-9 px-2.5 text-left text-[13px] font-medium transition-colors ${
        active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      {active && <span className="absolute bottom-0 left-0 h-px w-full rounded-full bg-accent" />}
    </button>
  );
}

export function DataToolbarButton({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'hover:border-error/30 hover:bg-error/10 hover:text-error'
          : 'hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
      }`}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}

export function DataTableSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-[18rem]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

export interface DataMoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function DataMoreMenu({ items }: { items: DataMoreMenuItem[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <GlassDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-40"
      trigger={
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          title={t('data.actions.more')}
          aria-label={t('data.actions.more')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {items.map((item) => (
        <GlassMenuItem
          key={item.key}
          disabled={item.disabled}
          danger={item.danger}
          icon={item.icon}
          onSelect={item.onClick}
        >
          {item.label}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
}

export function StatusBadge({ status }: { status: DataTaskStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${statusBadgeClass(
        status
      )}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`data.status.${status}`)}
    </span>
  );
}

export function InputTableStatusBadge({
  label,
  tone = 'success',
}: {
  label: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <span
      className={`inline-flex h-6 whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function EmptyState({
  label,
  description,
  action,
}: {
  label: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="text-[14px] font-medium text-text-primary">{label}</p>
      {description && (
        <p className="max-w-sm text-[13px] leading-6 text-text-secondary">{description}</p>
      )}
      {action}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-background/42 px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}

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
      className={`flex min-h-11 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-1' : 'mt-3'
      }`}
    >
      <span>{t('data.totalCount', { count })}</span>
      <div className="flex items-center gap-2">
        <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-text-secondary shadow-soft">
          {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-2">
          {pageCount > 1 && (
            <button
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={safeCurrentPage <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              onClick={() => onPageChange(pageNumber)}
              aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium shadow-soft ${
                pageNumber === safeCurrentPage
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-muted bg-surface text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          {pageCount > 1 && (
            <button
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={safeCurrentPage >= pageCount}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InputTableFormLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-[13px] font-medium text-text-secondary ${className}`}>{children}</div>
  );
}

export function InputTableInfo({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-11 items-center gap-2 rounded-lg border border-accent/15 bg-accent/5 px-3 text-xs font-medium text-text-muted ${className}`}
    >
      <Info className="h-4 w-4 flex-shrink-0 text-accent" />
      <span>{children}</span>
    </div>
  );
}

export function InputTableSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <GlassSelect
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[13px] font-medium text-text-secondary disabled:opacity-60"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </label>
  );
}

export function InputTableCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-text-secondary">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border-muted text-accent focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {label}
    </label>
  );
}

export function getTablePageCount(count: number): number {
  return Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
}

export function matchesSearchText(value: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return value.toLowerCase().includes(normalizedQuery);
}

export function getVisiblePageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export function formatTimestamp(timestamp: number | null, t: (key: string) => string): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (timestamp >= startToday) {
    return `${t('data.relative.today')} ${time}`;
  }
  if (timestamp >= startYesterday) {
    return `${t('data.relative.yesterday')} ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatRelatedTaskNames(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return t('data.inputTables.noRelatedTasks');
  return names.join(', ');
}

export function formatOutputTableRelatedTaskNames(
  outputTable: DataOutputTable,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (outputTable.relatedTaskNames.length > 0) {
    return formatRelatedTaskNames(outputTable.relatedTaskNames, t);
  }
  if (outputTable.sourceDatasetId) {
    return t('data.outputTables.relatedInputTable');
  }
  return t('data.inputTables.noRelatedTasks');
}

export function formatDisplayPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^\/Users\/[^/]+/, '~');
}

function statusBadgeClass(status: DataTaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-success/10 text-success';
    case 'completed':
      return 'bg-accent/10 text-accent';
    case 'stopped':
      return 'bg-text-muted/10 text-text-muted';
    case 'pending':
      return 'bg-warning/10 text-warning';
    case 'failed':
      return 'bg-error/10 text-error';
    case 'draft':
    default:
      return 'bg-surface-active text-text-secondary';
  }
}

export function getInputTableSourceMeta(kind: InputTableSourceKind): {
  Icon: LucideIcon;
  labelKey: string;
  className: string;
  badgeClassName: string;
} {
  switch (kind) {
    case 'draft':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.notConfigured',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    case 'excel':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.excel',
        className: 'bg-success/10 text-success',
        badgeClassName: 'bg-success/10 text-success',
      };
    case 'csv':
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.csv',
        className: 'bg-accent/10 text-accent',
        badgeClassName: 'bg-accent/10 text-accent',
      };
    case 'folder':
      return {
        Icon: Folder,
        labelKey: 'data.inputTables.sources.folder',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    default:
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.file',
        className: 'bg-surface-active/70 text-text-secondary',
        badgeClassName: 'bg-surface-active/70 text-text-secondary',
      };
  }
}
