import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  Info,
  MoreHorizontal,
  RefreshCw,
  Search,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { DataRawTable, DataResultTable, DataPipelineStatus } from '../../types';
import type { RawTableSourceKind } from '../../features/data/model/types';
import { GlassDropdownMenu, GlassMenuItem, GlassMenuSub } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { Button, Input } from '../ui';

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export const TABLE_PAGE_SIZE = 10;
export const RAW_TABLE_PREVIEW_PAGE_SIZE = 100;
export const RESULT_TABLE_INPUT_CHOICES_LIMIT = 200;
export const DATA_DELETE_BATCH_SIZE = 200;

export function makeLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Underline-tab trigger styling for `TabsTrigger` — preserves the legacy
 * text + bottom-accent-line look on top of the semantic `Tabs` primitives.
 */
export const underlineTabTriggerClass =
  'relative h-11 rounded-none bg-transparent px-2.5 text-[13px] text-text-secondary shadow-none ' +
  'hover:text-text-primary data-[state=active]:bg-transparent data-[state=active]:text-accent ' +
  'data-[state=active]:shadow-none after:absolute after:bottom-0 after:left-0 after:h-px ' +
  'after:w-full after:rounded-full data-[state=active]:after:bg-accent';

/**
 * Shared underline-tab bar chrome for the main workspace pages (data, skills,
 * automation): a fixed-height row with a baseline border that the active
 * trigger underline sits on. Keeps tab height/spacing identical across pages.
 */
export const underlineTabBarClass =
  'flex h-12 flex-shrink-0 items-end border-b border-border-subtle px-3';
export const underlineTabListClass =
  'inline-flex items-end gap-5 rounded-none border-0 bg-transparent p-0';

/**
 * Bottom tab bar (cloud list panels style): the strip sits at the panel's
 * bottom edge; the active tab is tinted and marked by a top accent line.
 */
export const bottomTabBarClass =
  'flex h-12 flex-shrink-0 items-stretch border-t border-border-muted';
export const bottomTabListClass =
  'flex h-full items-stretch gap-0 rounded-none border-0 bg-transparent p-0';
export const bottomTabTriggerClass =
  'relative h-full rounded-none bg-transparent px-4 text-xs font-medium text-text-secondary shadow-none ' +
  'hover:bg-surface-hover/50 hover:text-text-primary ' +
  'data-[state=active]:bg-accent-muted/60 data-[state=active]:text-accent data-[state=active]:shadow-none ' +
  'after:absolute after:inset-x-0 after:top-0 after:h-px data-[state=active]:after:bg-accent';

/**
 * Flat full-width header strip for workspace list pages: search/create on the
 * left, row actions on the right. Replaces the old floating `mb-3` toolbar so
 * the bar sits flush against the tab underline and the table below it.
 */
export const flatToolbarRowClass =
  'flex min-h-10 flex-shrink-0 flex-wrap items-center gap-2.5 border-b border-border-subtle px-3 py-1.5';

/**
 * Editor header strip (pipeline/raw-table/result-table editors): sits where the
 * workspace tab bar would be, so it must match `underlineTabBarClass` height
 * (h-12) to avoid a vertical shift when drilling into an editor.
 */
export const editorHeaderRowClass =
  'flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-border-subtle px-3';

export function DataToolbarButton({
  icon,
  label,
  disabled,
  danger,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="md"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 text-xs shadow-soft disabled:opacity-45 ${
        active
          ? 'border-accent/40 bg-accent-muted text-accent'
          : 'text-text-secondary ' +
            (danger
              ? 'hover:border-error/30 hover:bg-error/10 hover:text-error'
              : 'hover:border-accent/30 hover:bg-accent-muted hover:text-accent')
      }`}
      title={label}
    >
      {icon}
      {label}
    </Button>
  );
}

export function DataTableSearch({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-[18rem]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft"
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
  onClick?: () => void;
  children?: DataMoreMenuItem[];
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
        <Button
          variant="secondary"
          size="icon"
          className="text-text-secondary shadow-soft hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
          title={t('data.actions.more')}
          aria-label={t('data.actions.more')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      }
    >
      {items.map((item) =>
        item.children?.length ? (
          <GlassMenuSub key={item.key} label={item.label} icon={item.icon} disabled={item.disabled}>
            {item.children.map((child) => (
              <GlassMenuItem
                key={child.key}
                disabled={child.disabled}
                danger={child.danger}
                icon={child.icon}
                onSelect={child.onClick}
              >
                {child.label}
              </GlassMenuItem>
            ))}
          </GlassMenuSub>
        ) : (
          <GlassMenuItem
            key={item.key}
            disabled={item.disabled}
            danger={item.danger}
            icon={item.icon}
            onSelect={item.onClick}
          >
            {item.label}
          </GlassMenuItem>
        )
      )}
    </GlassDropdownMenu>
  );
}

export function StatusBadge({ status }: { status: DataPipelineStatus }) {
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

export function RawTableStatusBadge({
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
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-surface px-3 py-2 shadow-soft">
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

export function RawTableFormLabel({
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

export function RawTableInfo({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-11 items-center gap-2 rounded-lg border border-accent/15 bg-accent-muted px-3 text-xs font-medium text-text-muted ${className}`}
    >
      <Info className="h-4 w-4 flex-shrink-0 text-accent" />
      <span>{children}</span>
    </div>
  );
}

export function RawTableSelect({
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
  const { t } = useTranslation();
  return (
    <label className="block">
      <GlassSelect
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        searchable
        searchPlaceholder={t('data.aiPipelineInputSearch')}
        searchEmptyText={t('common.noResults')}
        triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-secondary disabled:opacity-60"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </label>
  );
}

export function RawTableCheckbox({
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

export function formatRelatedPipelineNames(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return t('data.rawTables.noRelatedPipelines');
  return names.join(', ');
}

export function formatResultTableRelatedPipelineNames(
  resultTable: DataResultTable,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (resultTable.relatedPipelineNames.length > 0) {
    return formatRelatedPipelineNames(resultTable.relatedPipelineNames, t);
  }
  if (resultTable.sourceRawTableId) {
    return t('data.resultTables.relatedRawTable');
  }
  return t('data.rawTables.noRelatedPipelines');
}

export function formatDisplayPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^\/Users\/[^/]+/, '~');
}

function statusBadgeClass(status: DataPipelineStatus): string {
  switch (status) {
    case 'running':
      return 'bg-success/10 text-success';
    case 'completed':
      return 'bg-accent-muted text-accent';
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

export function getRawTableSourceMeta(kind: RawTableSourceKind): {
  Icon: LucideIcon;
  labelKey: string;
  className: string;
  badgeClassName: string;
} {
  switch (kind) {
    case 'draft':
      return {
        Icon: Table2,
        labelKey: 'data.rawTables.sources.notConfigured',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    case 'excel':
      return {
        Icon: Table2,
        labelKey: 'data.rawTables.sources.excel',
        className: 'bg-success/10 text-success',
        badgeClassName: 'bg-success/10 text-success',
      };
    case 'cloud':
      return getCloudMirrorSourceMeta();
    case 'csv':
      return {
        Icon: FileText,
        labelKey: 'data.rawTables.sources.csv',
        className: 'bg-accent-muted text-accent',
        badgeClassName: 'bg-accent-muted text-accent',
      };
    case 'folder':
      return {
        Icon: Folder,
        labelKey: 'data.rawTables.sources.folder',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    default:
      return {
        Icon: FileText,
        labelKey: 'data.rawTables.sources.file',
        className: 'bg-surface-active text-text-secondary',
        badgeClassName: 'bg-surface-active text-text-secondary',
      };
  }
}

export type CloudMirrorInfo = NonNullable<
  Extract<DataRawTable['inputConfig'], { sourceKind: 'cloud' }>['cloudMirror']
>;

/** Includes legacy Csv mirrors while older records are being migrated. */
export function getCloudMirror(
  rawTable: Pick<DataRawTable, 'inputConfig'> | null | undefined
): CloudMirrorInfo | undefined {
  const config = rawTable?.inputConfig;
  return config?.sourceKind === 'cloud' || config?.sourceKind === 'csv'
    ? config.cloudMirror
    : undefined;
}

export function getCloudMirrorSourceMeta(): ReturnType<typeof getRawTableSourceMeta> {
  return {
    Icon: Cloud,
    labelKey: 'data.rawTables.sources.cloud',
    className: 'bg-accent-muted text-accent',
    badgeClassName: 'bg-accent-muted text-accent',
  };
}

/** `space / project / table` breadcrumb, falling back to ids when names are unknown. */
export function formatCloudMirrorLocation(mirror: CloudMirrorInfo): string {
  const parts = [
    mirror.spaceName || mirror.spaceId,
    mirror.projectName || mirror.projectId,
    mirror.tableName || mirror.tableId,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' / ');
}
