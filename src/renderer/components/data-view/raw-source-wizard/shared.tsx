import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, FileSpreadsheet, Folder, Info, Layers, RefreshCw } from 'lucide-react';
import type { DataRawSourceScan } from '../../../types';
import { Switch } from '../../ui';
import {
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
  DataMoreMenu,
  RawTableStatusBadge,
} from '../shared';

export type Step = 1 | 2 | 3 | 4;
export type FileRange = 'excel_csv' | 'excel' | 'csv';
export type Tr = (key: string, options?: Record<string, unknown>) => string;

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function hasSameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index]);
}

export const panelClass = 'flex min-h-0 flex-1 flex-col overflow-auto bg-surface';
export const footerClass =
  'flex h-[3.25rem] flex-shrink-0 items-center gap-3 border-t border-border-subtle bg-surface px-4';
export const primaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-[13px] text-text-primary hover:bg-surface-hover disabled:opacity-50';

export function SourceCard(props: {
  icon: ReactNode;
  title: string;
  desc: string;
  ext: string;
  action: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-testid={props.testId}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4 text-left hover:border-accent"
    >
      <span className="text-accent">{props.icon}</span>
      <span className="text-[13.5px] font-medium text-text-primary">{props.title}</span>
      <span className="text-[12.5px] leading-5 text-text-secondary">{props.desc}</span>
      <span className="text-[11.5px] text-text-muted">{props.ext}</span>
      <span className="mt-1 text-[12.5px] text-accent">{props.action}</span>
    </button>
  );
}

/** Config page (design raw_sheetcfg_v1): full-width groups in an 8px-padded content area. */
export const groupClass = 'ui-group ui-form-flush !mx-0 !mb-2 !mt-0 bg-surface';
/** Borderless control filling its table / form cell; focus draws an inner outline. */
const cellBaseClass =
  'h-full min-h-[35px] border-0 bg-transparent px-2.5 text-[12.5px] text-text-primary outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)] disabled:text-text-muted';
export const cellInputClass = `${cellBaseClass} w-full`;
export const cellSelectClass = `${cellBaseClass} cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-7 hover:bg-surface-hover`;
export const titleCellClass =
  'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle px-4 text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50';

export function ConfigTitleBar(props: {
  tr: Tr;
  name: string;
  createLabel: string;
  canCreate: boolean;
  danger: boolean;
  onBack: () => void;
  onCreate: () => void;
  onRechooseMode?: () => void;
}) {
  const { tr } = props;
  return (
    <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
      <div className="flex min-w-0 items-stretch">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('back')}
        </button>
        <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
          <RawTableStatusBadge label={tr('config.pending')} tone="warning" />
          <span
            className="truncate text-[14px] font-semibold text-text-primary"
            title={props.name}
            data-testid="raw-source-config-name"
          >
            {props.name}
          </span>
        </div>
      </div>
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={!props.canCreate}
          onClick={props.onCreate}
          data-testid="raw-source-create"
          className={`${titleCellClass} ${props.danger ? 'text-error hover:bg-error/[0.08]' : 'text-accent'}`}
        >
          <Check className="h-3.5 w-3.5" />
          {props.createLabel}
        </button>
        <DataMoreMenu
          items={
            props.onRechooseMode
              ? [
                  {
                    key: 'mode',
                    label: tr('config.rechooseMode'),
                    icon: <Layers className="h-3.5 w-3.5" />,
                    onClick: props.onRechooseMode,
                  },
                ]
              : []
          }
        />
      </div>
    </div>
  );
}

export function ConfigTabBar({ tr }: { tr: Tr }) {
  const tabs: Array<[string, boolean]> = [
    [tr('config.tabConfig'), true],
    [tr('config.tabData'), false],
    [tr('config.tabAutomation'), false],
  ];
  return (
    <div className={`${bottomTabBarClass} justify-between`} data-testid="raw-source-config-tabs">
      <div className={bottomTabListClass} role="tablist">
        {tabs.map(([label, active]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!active}
            data-state={active ? 'active' : 'inactive'}
            className={`${bottomTabTriggerClass} inline-flex items-center disabled:cursor-not-allowed disabled:opacity-45`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center px-4 text-xs text-text-muted">
        {tr('config.afterCreate')}
      </div>
    </div>
  );
}

export function formatScanTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SourceGroup({
  tr,
  scan,
  scannedAt,
  onChange,
}: {
  tr: Tr;
  scan: DataRawSourceScan;
  scannedAt: number | null;
  onChange?: () => void;
}) {
  const isFolder = scan.kind === 'folder';
  return (
    <section className={groupClass} data-testid="raw-source-source-group">
      <div className="ui-group-title">{tr('config.sourceGroup')}</div>
      <div className="ui-form-row">
        <div className="ui-form-label items-center">
          {isFolder ? tr('config.folder') : tr('config.file')}
        </div>
        <div className="ui-form-value !flex-row items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
            {isFolder ? (
              <Folder className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
            )}
            <span
              className="truncate font-mono text-[12px] text-text-primary"
              title={scan.sourcePath}
            >
              {scan.sourcePath}
            </span>
          </div>
          {onChange && (
            <button
              type="button"
              onClick={onChange}
              className="ui-accent-cell w-[112px] flex-shrink-0 border-l border-border-subtle"
              data-testid="raw-source-change-file"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isFolder ? tr('config.changeFolder') : tr('config.changeFile')}
            </button>
          )}
        </div>
      </div>
      <div className="ui-form-row">
        <div className="ui-form-label items-center">{tr('config.scanResult')}</div>
        <div className="ui-form-value">
          <div className="flex flex-1 items-center gap-1.5 px-2.5 text-[12.5px] text-text-primary">
            {isFolder
              ? tr('config.files', { count: scan.files.length })
              : scan.kind === 'excel'
                ? tr('config.sheets', { count: scan.sheets.length })
                : scan.name}
            {scannedAt !== null && (
              <span className="text-[12px] text-text-muted">
                {tr('config.scannedAt', { time: formatScanTime(scannedAt) })}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function InfoTip({ label }: { label: string }) {
  return (
    <span className="group relative inline-flex" data-testid="raw-source-merge-reason">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted hover:text-accent focus:outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border-muted bg-surface px-2.5 py-1.5 text-[12px] text-text-primary shadow-elevated group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  );
}

/** Single-line form label with an info icon whose tooltip portals out of `.ui-group`. */
export function OptionLabelWithTip({
  label,
  tip,
  testId,
}: {
  label: string;
  tip: string;
  testId?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  const close = () => setPos(null);
  return (
    <div className="ui-form-label items-center gap-1 whitespace-nowrap">
      <span>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={tip}
        data-testid={testId}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-accent focus:text-accent focus:outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              style={{ top: pos.top, left: pos.left }}
              className="pointer-events-none fixed z-[9999] max-w-[260px] -translate-y-1/2 rounded-md border border-border-muted bg-surface px-2.5 py-1.5 text-[12px] font-normal leading-5 text-text-secondary shadow-elevated"
            >
              {tip}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function SourceSummary({
  scan,
  tr,
  onChange,
}: {
  scan: DataRawSourceScan;
  tr: Tr;
  onChange?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle px-4 py-3">
      {scan.kind === 'folder' ? (
        <Folder className="h-4 w-4 text-accent" />
      ) : (
        <FileSpreadsheet className="h-4 w-4 text-accent" />
      )}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-text-primary">{scan.name}</div>
        <div className="truncate text-[11.5px] text-text-muted">{scan.sourcePath}</div>
      </div>
      <span className="ml-auto text-[12px] text-success">
        {scan.kind === 'folder'
          ? tr('mode.scanDoneFiles', { count: scan.files.length })
          : tr('mode.scanDoneSheets', { count: scan.sheets.length })}
      </span>
      {onChange && (
        <button type="button" className="text-[12.5px] text-accent" onClick={onChange}>
          {tr('mode.change')}
        </button>
      )}
    </div>
  );
}

export function NameField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <label className="mt-3 flex items-center gap-3 text-[12.5px] text-text-secondary">
      <span className="w-20 flex-shrink-0">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="h-8 flex-1 rounded-md border border-border-subtle bg-surface px-2.5 text-[13px] text-text-primary"
      />
    </label>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
  testId,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-text-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <Switch
        size="sm"
        checked={on}
        onCheckedChange={onChange}
        disabled={disabled}
        data-testid={testId}
        aria-label={label}
      />
      <span>{label}</span>
    </label>
  );
}
