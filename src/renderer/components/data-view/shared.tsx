import { toolbarEndControlWidthClass } from './data-view-styles';
import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  FileText,
  Folder,
  Info,
  MoreVertical,
  RefreshCw,
  Search,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { DataRawTable, DataPipelineStatus } from '../../types';
import type { RawTableSourceKind } from '../../features/data/model/types';
import {
  GlassDropdownMenu,
  GlassMenuItem,
  GlassMenuSeparator,
  GlassMenuSub,
} from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { Button, Input } from '../ui';

export { getVisiblePageNumbers } from '../../utils/pagination';
export * from './data-view-styles';
export * from './data-pagination';
export * from './data-format';
export * from './tab-bar-action';

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export const RAW_TABLE_PREVIEW_PAGE_SIZE = 100;
export const RESULT_TABLE_INPUT_CHOICES_LIMIT = 200;
export const DATA_DELETE_BATCH_SIZE = 200;

export function makeLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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
          className={`h-full ${toolbarEndControlWidthClass} rounded-none border-0 border-l border-border-subtle bg-transparent text-text-secondary shadow-none hover:bg-accent-muted hover:text-accent`}
          title={t('data.actions.more')}
          aria-label={t('data.actions.more')}
        >
          <MoreVertical className="h-4 w-4" />
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
  title,
}: {
  label: string;
  tone?: 'success' | 'warning' | 'error';
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
        tone === 'error'
          ? 'bg-error/10 text-error'
          : tone === 'warning'
            ? 'bg-warning/10 text-warning'
            : 'bg-success/10 text-success'
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
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
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
    <div className="flex h-full min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-surface px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
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
