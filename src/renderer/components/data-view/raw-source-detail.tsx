/**
 * Source detail page (design 方案 A): the same form grid as the new-source config page.
 * 数据来源 group — path (show in folder), build mode (changing it rebuilds via the wizard after
 * an explicit delete confirmation), auto-include toggle (persisted), last scan summary.
 * 原始表 group — member tables with short names, size, pipelines, status and hover actions.
 * Bottom tabs: 配置 / 数据 (preview of the selected member table).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react';
import type {
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceCreateResult,
  DataRawTable,
  DataRawTablePreview,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { useRawSourceRefresh } from './raw-source-refresh-dialog';
import { useInlineModeChange } from './raw-source-mode-change';
import {
  SELECT_CHEVRON,
  Toggle,
  cellSelectClass,
  groupClass,
  stemOf,
  titleCellClass,
} from './raw-source-wizard';
import {
  DataMoreMenu,
  RAW_TABLE_PREVIEW_PAGE_SIZE,
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
  formatDateTime,
} from './shared';

export function modesForSource(source: DataRawSource): DataRawSourceBuildMode[] {
  if (source.sourceKind === 'cloud') return ['cloud_table'];
  if (source.sourceKind === 'folder') return ['folder_merge', 'folder_per_file'];
  if (source.sourceKind === 'excel')
    return ['excel_single', 'excel_per_sheet', 'excel_merge_sheets'];
  return ['single'];
}

const MULTI_TABLE_MODES: ReadonlySet<DataRawSourceBuildMode> = new Set([
  'excel_per_sheet',
  'folder_per_file',
]);

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** Member name without the "源名 / " prefix (children are named after the file or source stem). */
export function memberShortName(table: DataRawTable, source: DataRawSource): string {
  for (const stem of [stemOf(source.name), stemOf(baseName(source.sourcePath))]) {
    if (stem && table.name.startsWith(`${stem} / `)) return table.name.slice(stem.length + 3);
  }
  return table.name;
}

/** Files / sheets merged into one table, for merge build modes. */
export function mergedParts(table: DataRawTable): string[] {
  const config = table.inputConfig as {
    mergeSheets?: string[];
    mergeReport?: { includedFiles?: string[] };
  };
  if (config.mergeSheets?.length) return config.mergeSheets;
  return config.mergeReport?.includedFiles ?? [];
}

function SourceIcon({ source, className }: { source: DataRawSource; className: string }) {
  if (source.sourceKind === 'folder') return <Folder className={`${className} text-amber-500`} />;
  if (source.sourceKind === 'cloud') return <Cloud className={`${className} text-sky-500`} />;
  if (source.sourceKind === 'csv') return <FileText className={`${className} text-emerald-600`} />;
  return <FileSpreadsheet className={`${className} text-emerald-600`} />;
}

export function RawSourceDetail({
  source,
  rawTables,
  onBack,
  onOpenTable,
  onRebuilt,
  onChanged,
  initialTableId,
}: {
  /** Child table to show first (selected in the list before opening). */
  initialTableId?: string;
  source: DataRawSource;
  rawTables: DataRawTable[];
  onBack: () => void;
  onOpenTable: (table: DataRawTable) => void;
  /** After an inline 组织方式 change was saved (tables were rebuilt). */
  onRebuilt?: (result: DataRawSourceCreateResult) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    String(t(`data.rawSources.${key}`, options ?? {}));
  const members = source.memberIds
    .map((id) => rawTables.find((table) => table.id === id))
    .filter((table): table is DataRawTable => !!table);
  const { refresh, refreshingId, dialog } = useRawSourceRefresh(onChanged);
  const refreshing = refreshingId === source.id;
  const isCloud = source.sourceKind === 'cloud';
  const isFolder = source.sourceKind === 'folder';
  const isExcel = source.sourceKind === 'excel';
  const multi = MULTI_TABLE_MODES.has(source.buildMode);
  const merge = source.buildMode === 'folder_merge' || source.buildMode === 'excel_merge_sheets';

  const [tab, setTab] = useState<'config' | 'data'>('config');
  const modeChange = useInlineModeChange(source, (result) => {
    onChanged();
    onRebuilt?.(result);
  });
  const changingMode = modeChange.pending !== null;
  // Default: the child picked in the list, else the one last viewed this session, else first.
  const [selectedId, setSelectedIdState] = useState<string | null>(
    () =>
      [initialTableId, lastViewedTable.get(source.id)].find(
        (id) => id && members.some((m) => m.id === id)
      ) ??
      members[0]?.id ??
      null
  );
  const setSelectedId = (id: string) => {
    lastViewedTable.set(source.id, id);
    setSelectedIdState(id);
  };
  const selected = members.find((m) => m.id === selectedId) ?? members[0] ?? null;
  const switchable = multi && members.length > 1;

  const [autoInclude, setAutoInclude] = useState(!!source.config.autoInclude);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  useEffect(() => setAutoInclude(!!source.config.autoInclude), [source.config.autoInclude]);
  const toggleAutoInclude = async (on: boolean) => {
    setAutoInclude(on);
    setAutoBusy(true);
    setAutoError(null);
    try {
      await dataClient.setRawSourceAutoInclude(source.id, on);
      onChanged();
    } catch (err) {
      setAutoInclude(!on);
      setAutoError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoBusy(false);
    }
  };

  const lastScan = source.config.lastScannedAt ?? source.updatedAt;
  const missing = members.filter((m) => m.memberStatus === 'missing').length;
  const memberCount = source.config.knownMembers?.length ?? members.length;
  const scanCount = isExcel
    ? tr('detail.scanSheets', { count: memberCount })
    : isFolder
      ? tr('detail.scanFiles', { count: memberCount })
      : tr('detail.scanRows', { count: members[0]?.rowCount ?? 0 });
  const scanState = missing ? tr('detail.missingCount', { count: missing }) : tr('detail.noChange');
  const memberLabel = isExcel ? tr('detail.colSheet') : tr('detail.colFile');

  const openRow = (table: DataRawTable) => onOpenTable(table);
  const previewRow = (table: DataRawTable) => {
    setSelectedId(table.id);
    setTab('data');
  };

  const label = 'ui-form-label items-center';
  const cellText = 'flex min-w-0 flex-1 items-center gap-2 px-2.5 text-[12.5px] text-text-primary';
  const th =
    'h-8 border-b border-r border-border-subtle px-2.5 text-left text-[12px] font-medium text-text-muted';
  const td = 'h-[35px] border-b border-r border-border-subtle px-2.5';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="raw-source-detail">
      <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
        <div className="flex min-w-0 items-stretch">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {tr('back')}
          </button>
          <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
            <SourceIcon source={source} className="h-4 w-4 flex-shrink-0" />
            <span
              className="truncate text-[14px] font-semibold text-text-primary"
              title={source.name}
              data-testid="raw-source-detail-name"
            >
              {source.name}
            </span>
            {switchable && selected && (
              <TitleTableSwitcher
                tables={members}
                selectedId={selected.id}
                nameOf={(table) => memberShortName(table, source)}
                onSelect={setSelectedId}
                tr={tr}
              />
            )}
          </div>
        </div>
        <div className="flex items-stretch">
          {modeChange.actions}
          {!isCloud && !changingMode && (
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refresh(source.id)}
              data-testid="raw-source-refresh"
              className={`${titleCellClass} text-accent`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {tr('list.refreshSource')}
            </button>
          )}
          <DataMoreMenu
            items={
              isCloud
                ? []
                : [
                    {
                      key: 'reveal',
                      label: tr('detail.openLocation'),
                      icon: <FolderOpen className="h-3.5 w-3.5" />,
                      onClick: () => void dataClient.showItemInFolder(source.sourcePath),
                    },
                  ]
            }
          />
        </div>
      </div>

      {tab === 'config' ? (
        <div className="min-h-0 flex-1 overflow-auto p-2 text-[12.5px]">
          <section className={groupClass} data-testid="raw-source-detail-source">
            <div className="ui-group-title">{tr('config.sourceGroup')}</div>
            <div className="ui-form-row">
              <div className={label}>{isFolder ? tr('config.folder') : tr('config.file')}</div>
              <div className="ui-form-value !flex-row items-stretch">
                <div className={cellText}>
                  <SourceIcon source={source} className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate font-mono text-[12px]" title={source.sourcePath}>
                    {source.sourcePath}
                  </span>
                </div>
                {!isCloud && (
                  <button
                    type="button"
                    onClick={() => void dataClient.showItemInFolder(source.sourcePath)}
                    className="ui-accent-cell w-[128px] flex-shrink-0 whitespace-nowrap border-l border-border-subtle"
                    data-testid="raw-source-reveal"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {tr('detail.openLocation')}
                  </button>
                )}
              </div>
            </div>
            <div className="ui-form-row">
              <div className={label}>{tr('detail.buildMode')}</div>
              <div className="ui-form-value !flex-row items-stretch">
                <select
                  value={modeChange.value}
                  onChange={(event) =>
                    modeChange.choose(event.target.value as DataRawSourceBuildMode)
                  }
                  disabled={modesForSource(source).length < 2}
                  data-testid="raw-source-build-mode"
                  className={`${cellSelectClass} min-w-0 flex-1 disabled:cursor-default disabled:hover:bg-transparent`}
                  style={{
                    backgroundImage: modesForSource(source).length < 2 ? undefined : SELECT_CHEVRON,
                  }}
                >
                  {modesForSource(source).map((mode) => (
                    <option key={mode} value={mode}>
                      {tr(`modes.${mode}`)}
                    </option>
                  ))}
                </select>
                {modesForSource(source).length > 1 && (
                  <div className="flex w-[128px] flex-shrink-0 items-center justify-center whitespace-nowrap border-l border-border-subtle text-[12px] text-text-muted">
                    {tr('detail.rebuildHint')}
                  </div>
                )}
              </div>
            </div>
            {!isCloud && !changingMode && (
              <div className="ui-form-row">
                <div className={label}>{tr('detail.autoIncludeLabel')}</div>
                <div className="ui-form-value">
                  <div className={cellText}>
                    <Toggle
                      on={multi && autoInclude}
                      disabled={!multi || autoBusy}
                      onChange={(on) => void toggleAutoInclude(on)}
                      label={
                        isFolder ? tr('detail.autoIncludeFile') : tr('detail.autoIncludeSheet')
                      }
                      testId="raw-source-auto-include"
                    />
                    {!multi && (
                      <span className="text-[12px] text-text-muted">
                        · {tr('detail.autoIncludeNA')}
                      </span>
                    )}
                    {autoError && (
                      <span className="truncate text-[12px] text-error">
                        {tr('detail.autoIncludeFailed', { message: autoError })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="ui-form-row">
              <div className={label}>{tr('detail.lastScan')}</div>
              <div className="ui-form-value">
                <div className={cellText} data-testid="raw-source-last-scan">
                  <span className="tabular-nums">{formatDateTime(lastScan)}</span>
                  <span className={`text-[12px] ${missing ? 'text-warning' : 'text-text-muted'}`}>
                    · {tr('detail.scanSummary', { count: scanCount, state: scanState })}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {changingMode ? (
            modeChange.editor
          ) : (
            <section className={groupClass} data-testid="raw-source-detail-tables">
              <div className="ui-group-title">
                {tr('detail.tables')}
                <span className="ml-2 text-[12px] font-normal text-text-muted">
                  {tr('detail.tablesCount', { count: members.length })}
                </span>
              </div>
              <table className="w-full table-fixed border-collapse text-[12.5px]">
                <colgroup>
                  <col />
                  <col className="w-[24%]" />
                  <col className="w-[96px]" />
                  <col className="w-[20%]" />
                  <col className="w-[80px]" />
                  <col className="w-[68px]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={th}>{tr('detail.colTable')}</th>
                    <th className={th}>{merge ? tr('detail.mergedFrom') : memberLabel}</th>
                    <th className={`${th} text-right`}>{tr('detail.colSize')}</th>
                    <th className={th}>{tr('detail.colPipelines')}</th>
                    <th className={th}>{tr('detail.colStatus')}</th>
                    <th className={`${th} border-r-0`} />
                  </tr>
                </thead>
                <tbody>
                  {members.map((table) => {
                    const parts = merge ? mergedParts(table) : [];
                    const missingRow = table.memberStatus === 'missing';
                    const active = selected?.id === table.id;
                    return (
                      <Fragment key={table.id}>
                        <tr
                          data-testid="raw-source-member-row"
                          onClick={() => setSelectedId(table.id)}
                          onDoubleClick={() => openRow(table)}
                          className={`group cursor-default ${active ? 'bg-accent-muted/40' : 'hover:bg-surface-hover'}`}
                        >
                          <td className={td}>
                            <span className="flex min-w-0 items-center gap-1.5 text-text-primary">
                              <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                              <span className="truncate" title={table.name}>
                                {memberShortName(table, source)}
                              </span>
                            </span>
                          </td>
                          <td className={`${td} truncate text-text-secondary`}>
                            {merge
                              ? tr('detail.mergedFiles', { count: parts.length })
                              : (table.memberKey ?? baseName(table.sourcePath))}
                          </td>
                          <td className={`${td} text-right tabular-nums text-text-secondary`}>
                            {table.rowCount} × {table.columnCount}
                          </td>
                          <td className={`${td} truncate text-text-secondary`}>
                            {table.relatedPipelineNames.join('、') || '—'}
                          </td>
                          <td className={td}>
                            <span
                              className={`inline-flex items-center gap-1.5 ${missingRow ? 'text-warning' : 'text-text-primary'}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${missingRow ? 'bg-warning' : 'bg-success'}`}
                              />
                              {missingRow ? tr('list.memberMissing') : tr('statusOk')}
                            </span>
                          </td>
                          <td className={`${td} border-r-0`}>
                            <span
                              className={`flex items-center justify-center gap-2.5 ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                            >
                              <button
                                type="button"
                                title={tr('detail.preview')}
                                aria-label={tr('detail.preview')}
                                data-testid="raw-source-member-preview"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  previewRow(table);
                                }}
                                className="text-text-muted hover:text-accent"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title={tr('detail.open')}
                                aria-label={tr('detail.open')}
                                data-testid="raw-source-member-open"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openRow(table);
                                }}
                                className="text-text-muted hover:text-accent"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </td>
                        </tr>
                        {parts.map((part) => (
                          <tr key={`${table.id}:${part}`} data-testid="raw-source-merged-part">
                            <td className={`${td} pl-8 text-text-muted`} colSpan={2}>
                              <span className="flex min-w-0 items-center gap-1.5">
                                {isFolder ? (
                                  <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0" />
                                ) : (
                                  <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                                )}
                                <span className="truncate" title={part}>
                                  {part}
                                </span>
                              </span>
                            </td>
                            <td className={td} colSpan={4} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      ) : (
        <MemberDataTab table={selected} tr={tr} />
      )}

      <div className={`${bottomTabBarClass} justify-between`}>
        <div className={bottomTabListClass} role="tablist">
          {(['config', 'data'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-state={tab === key ? 'active' : 'inactive'}
              data-testid={`raw-source-detail-tab-${key}`}
              onClick={() => setTab(key)}
              disabled={changingMode && key === 'data'}
              className={`${bottomTabTriggerClass} inline-flex items-center disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {key === 'config' ? tr('config.tabConfig') : tr('config.tabData')}
            </button>
          ))}
        </div>
        <div className="flex items-center px-4 text-xs text-text-muted">
          {tr('detail.lastScanAt', { time: formatDateTime(lastScan) })}
        </div>
      </div>
      {dialog}
    </div>
  );
}

/** Session memory: sourceId → table last previewed in its 数据 tab. */
const lastViewedTable = new Map<string, string>();
const SWITCHER_SEARCH_MIN = 6;

/** Title-bar '/ 表名 ▾': the current table name is itself the switcher (multi-table sources). */
function TitleTableSwitcher({
  tables,
  selectedId,
  nameOf,
  onSelect,
  tr,
}: {
  tables: DataRawTable[];
  selectedId: string;
  nameOf: (table: DataRawTable) => string;
  onSelect: (id: string) => void;
  tr: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const current = tables.find((table) => table.id === selectedId) ?? tables[0];
  const missing = (table: DataRawTable) => table.memberStatus === 'missing';
  const q = query.trim().toLowerCase();
  const shown = q ? tables.filter((table) => nameOf(table).toLowerCase().includes(q)) : tables;
  const pick = (id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery('');
  };
  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={missing(current) ? tr('detail.lastImported') : current.name}
        data-testid="raw-source-detail-current"
        className={`inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[14px] transition-colors hover:bg-accent-muted ${
          missing(current) ? 'text-warning' : 'text-text-secondary hover:text-accent'
        }`}
      >
        <span className="flex-shrink-0 text-text-muted">/</span>
        <span className="truncate">{nameOf(current)}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-[300px] overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-elevated"
          data-testid="raw-source-switcher"
        >
          {tables.length >= SWITCHER_SEARCH_MIN && (
            <div className="flex h-9 items-center gap-2 border-b border-border-subtle px-3">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false);
                }}
                data-testid="raw-source-switcher-search"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[12.5px] outline-none"
              />
            </div>
          )}
          <div className="max-h-72 overflow-auto py-1" role="listbox">
            {shown.map((table) => {
              const active = table.id === current.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(table.id)}
                  data-testid="raw-source-switcher-option"
                  className={`flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] hover:bg-surface-hover ${
                    missing(table) ? 'text-warning' : 'text-text-primary'
                  }`}
                >
                  <Check
                    className={`h-3.5 w-3.5 flex-shrink-0 text-accent ${active ? '' : 'invisible'}`}
                  />
                  <span className="min-w-0 truncate">{nameOf(table)}</span>
                  {missing(table) && (
                    <span className="flex-shrink-0 text-[11.5px]">{tr('detail.lastImported')}</span>
                  )}
                  <span className="ml-auto flex-shrink-0 tabular-nums text-text-muted">
                    {table.rowCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberDataTab({
  table,
  tr,
}: {
  table: DataRawTable | null;
  tr: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<DataRawTablePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const tableId = table?.id ?? null;
  const load = useCallback(
    async (next: number) => {
      if (!tableId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await dataClient.previewRawTable({
          id: tableId,
          limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
          offset: (next - 1) * RAW_TABLE_PREVIEW_PAGE_SIZE,
        });
        setPreview(result);
        setPage(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [tableId]
  );
  useEffect(() => {
    setPreview(null);
    void load(1);
  }, [load]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="raw-source-detail-data">
      <GlassDataGridPreview
        preview={preview}
        isLoading={loading}
        error={error}
        currentPage={page}
        onPageChange={(next) => void load(next)}
        onRetry={() => void load(page)}
        labels={{
          loading: tr('detail.dataLoading'),
          empty: tr('detail.dataEmpty'),
          total: (count) => t('data.workflow.nodeDataTotal', { count }),
          errorTitle: t('data.preview.loadFailed'),
          retry: t('data.preview.retry'),
          pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
        }}
        edgeToEdge
        rowHeight={32}
        headerHeight={34}
      />
    </div>
  );
}
