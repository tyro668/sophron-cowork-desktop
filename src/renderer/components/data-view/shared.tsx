import { formatAppDateTime, formatClockTime } from '../../utils/i18n-format';
import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import {
  GlassDropdownMenu,
  GlassMenuItem,
  GlassMenuSeparator,
  GlassMenuSub,
} from '../GlassDropdownMenu';
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
  'relative h-full rounded-none border-r border-border-subtle bg-transparent px-4 text-[13px] font-medium text-text-secondary shadow-none ' +
  'hover:bg-surface-hover/60 hover:text-text-primary data-[state=active]:bg-accent-muted data-[state=active]:text-accent ' +
  'data-[state=active]:shadow-none after:absolute after:bottom-0 after:left-0 after:h-0.5 ' +
  'after:w-full data-[state=active]:after:bg-accent';

/**
 * Fixed tab width shared by the data page top tabs, the raw/result editor
 * bottom tabs and the cloud space bottom tabs. Widths include the 1px divider,
 * so N tabs span exactly N × FIXED_TAB_WIDTH (the cloud tree = 4 tabs).
 */
export const FIXED_TAB_WIDTH = 112;
export const fixedTabWidthClass = 'w-[112px] min-w-0 flex-none justify-center px-2';
export const fixedTabGroupWidth = (count: number) => count * FIXED_TAB_WIDTH;
export const fixedUnderlineTabTriggerClass = `${underlineTabTriggerClass} ${fixedTabWidthClass}`;

/**
 * Shared underline-tab bar chrome for the main workspace pages (data, skills,
 * automation): a fixed-height row with a baseline border that the active
 * trigger underline sits on. Keeps tab height/spacing identical across pages.
 */
export const underlineTabBarClass =
  'flex h-12 flex-shrink-0 items-stretch border-b border-border-subtle px-0';
export const underlineTabListClass =
  'inline-flex h-full items-stretch gap-0 rounded-none border-0 bg-transparent p-0';

/**
 * Bottom tab bar (cloud list panels style): the strip sits at the panel's
 * bottom edge; the active tab is tinted and marked by a top accent line.
 */
export const bottomTabBarClass =
  'flex h-12 flex-shrink-0 items-stretch border-t border-border-muted';
export const bottomTabListClass =
  'flex h-full items-stretch gap-0 rounded-none border-0 bg-transparent p-0';
export const bottomTabTriggerClass =
  'relative h-full w-[112px] min-w-0 flex-none justify-center rounded-none border-r border-border-subtle bg-transparent px-2 text-xs font-medium text-text-secondary shadow-none ' +
  'hover:bg-surface-hover/50 hover:text-text-primary ' +
  'data-[state=active]:bg-accent-muted data-[state=active]:text-accent data-[state=active]:shadow-none ' +
  'after:absolute after:inset-x-0 after:top-0 after:h-0.5 data-[state=active]:after:bg-accent';

/**
 * Flat full-width header strip for workspace list pages: search/create on the
 * left, row actions on the right. Replaces the old floating `mb-3` toolbar so
 * the bar sits flush against the tab underline and the table below it.
 */
export const flatToolbarRowClass =
  'flex h-10 flex-shrink-0 items-stretch gap-0 border-b border-border-subtle p-0 ' +
  '[&>div]:flex-nowrap [&>div]:items-stretch [&>div]:gap-0';

/** Primary create button rendered as a flush toolbar cell (no radius / gap). */
export const toolbarPrimaryCellClass =
  'inline-flex h-full flex-shrink-0 items-center justify-center gap-1.5 rounded-none jade-primary-button px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

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
      className={`h-full rounded-none border-0 border-l border-border-subtle bg-transparent px-3 text-xs shadow-none disabled:opacity-45 ${
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
    <div className="relative min-w-[12rem] flex-1 border-l border-border-subtle">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-full rounded-none border-0 bg-transparent pl-8 pr-3 text-xs font-medium text-text-secondary shadow-none focus:ring-0 focus-visible:ring-0"
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
  /** Secondary hint text under the label (leaf items only). */
  description?: ReactNode;
  /** Render a divider above this item, e.g. to separate destructive actions. */
  separatorBefore?: boolean;
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
          className="h-full w-10 rounded-none border-0 border-l border-border-subtle bg-transparent text-text-secondary shadow-none hover:bg-accent-muted hover:text-accent"
          title={t('data.actions.more')}
          aria-label={t('data.actions.more')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      }
    >
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.separatorBefore ? <GlassMenuSeparator /> : null}
          {item.children?.length ? (
            <GlassMenuSub label={item.label} icon={item.icon} disabled={item.disabled}>
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
              disabled={item.disabled}
              danger={item.danger}
              icon={item.icon}
              description={item.description}
              onSelect={item.onClick}
            >
              {item.label}
            </GlassMenuItem>
          )}
        </Fragment>
      ))}
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
  icon,
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted text-accent-text">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-text-primary">{label}</p>
      {description && (
        <p className="max-w-sm text-[13px] leading-6 text-text-muted">{description}</p>
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
  searchPlaceholder,
  value,
  options,
  disabled,
  onChange,
  flush,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  searchPlaceholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Fill a `.ui-form-flush` value cell (no border / radius). */
  flush?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className={flush ? 'ui-flush-split flex flex-1' : 'block'}>
      <GlassSelect
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        searchable
        searchPlaceholder={searchPlaceholder ?? t('data.aiPipelineInputSearch')}
        searchEmptyText={t('common.noResults')}
        triggerClassName={
          flush
            ? 'w-full justify-between text-text-primary disabled:opacity-60'
            : '!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-secondary disabled:opacity-60'
        }
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
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const time = formatClockTime(date);

  if (timestamp >= startToday) {
    return `${t('data.relative.today')} ${time}`;
  }
  if (timestamp >= startYesterday) {
    return `${t('data.relative.yesterday')} ${time}`;
  }
  return formatAppDateTime(date);
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '—';
  return formatAppDateTime(timestamp);
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

/**
 * List pages put their "+ 新建…" action at the far right of the top tab bar.
 * The page renders <TabBarActionSlot /> inside the tab bar and wraps its content in
 * the provider; panels render <TabBarAction> which portals into the slot (or renders
 * inline when no slot is present, e.g. isolated tests).
 */
const TabBarActionContext = createContext<HTMLElement | null>(null);

export function useTabBarActionSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return { slot, slotRef: setSlot, Provider: TabBarActionContext.Provider };
}

export function TabBarActionSlot({ slotRef }: { slotRef: (el: HTMLElement | null) => void }) {
  return (
    <div ref={slotRef} data-testid="tab-bar-action-slot" className="ml-auto flex items-stretch" />
  );
}

export function TabBarAction({ children }: { children: ReactNode }) {
  const slot = useContext(TabBarActionContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

/** Compact flush "+ 新建…" cell at the right end of the tab bar: accent text, hover tint. */
export const tabBarNewCellClass =
  'inline-flex h-full flex-shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-4 text-xs font-medium text-accent transition-colors hover:bg-accent-muted/60 disabled:cursor-not-allowed disabled:opacity-50';
