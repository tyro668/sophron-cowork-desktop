/**
 * Source detail page: path, build mode (changing it rebuilds via the wizard after an explicit
 * delete confirmation), auto-include, last scan, and the member tables with refresh.
 */
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw, Table2 } from 'lucide-react';
import type { DataRawSource, DataRawSourceBuildMode, DataRawTable } from '../../types';
import { useRawSourceRefresh } from './raw-source-refresh-dialog';
import { formatDateTime } from './shared';

export function modesForSource(source: DataRawSource): DataRawSourceBuildMode[] {
  if (source.sourceKind === 'cloud') return ['cloud_table'];
  if (source.sourceKind === 'folder') return ['folder_merge', 'folder_per_file'];
  if (source.sourceKind === 'excel')
    return ['excel_single', 'excel_per_sheet', 'excel_merge_sheets'];
  return ['single'];
}

export function RawSourceDetail({
  source,
  rawTables,
  onBack,
  onOpenTable,
  onChangeMode,
  onChanged,
}: {
  source: DataRawSource;
  rawTables: DataRawTable[];
  onBack: () => void;
  onOpenTable: (table: DataRawTable) => void;
  onChangeMode: (source: DataRawSource, mode: DataRawSourceBuildMode) => void;
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
  const row = 'flex min-h-9 items-center gap-4 border-b border-dashed border-border-muted py-1.5';
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="raw-source-detail">
      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-[13px]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('back')}
        </button>
        <span className="text-[14px] font-medium text-text-primary">{source.name}</span>
        <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[11.5px] text-accent">
          {tr('list.tablesBadge', { count: source.memberIds.length })}
        </span>
        {!isCloud && (
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refresh(source.id)}
            data-testid="raw-source-refresh"
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {tr('list.refreshSource')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5 text-[13px]">
        <div className="mb-2 text-[12px] font-medium text-text-muted">{tr('detail.section')}</div>
        <div className={row}>
          <span className="w-36 text-text-muted">{tr('detail.path')}</span>
          <span className="truncate text-text-primary">{source.sourcePath}</span>
        </div>
        <div className={row}>
          <span className="w-36 text-text-muted">{tr('detail.buildMode')}</span>
          <select
            value={source.buildMode}
            onChange={(event) => {
              const next = event.target.value as DataRawSourceBuildMode;
              if (next !== source.buildMode) onChangeMode(source, next);
            }}
            disabled={isCloud}
            data-testid="raw-source-build-mode"
            className="h-7 rounded-md border border-border-subtle bg-surface px-2"
          >
            {modesForSource(source).map((mode) => (
              <option key={mode} value={mode}>
                {tr(`modes.${mode}`)}
              </option>
            ))}
          </select>
          <span className="text-[12px] text-text-muted">{tr('detail.buildModeHint')}</span>
        </div>
        <div className={row}>
          <span className="w-36 text-text-muted">{tr('detail.autoInclude')}</span>
          <span>{source.config.autoInclude ? tr('detail.on') : tr('detail.off')}</span>
        </div>
        <div className={row}>
          <span className="w-36 text-text-muted">{tr('detail.lastScan')}</span>
          <span>{formatDateTime(source.config.lastScannedAt ?? source.updatedAt)}</span>
        </div>
        <div className="mb-2 mt-6 text-[12px] font-medium text-text-muted">
          {tr('detail.members')}
        </div>
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="h-8 border-b border-border-subtle text-text-muted">
              <th className="px-2 font-medium">{tr('detail.colTable')}</th>
              <th className="px-2 font-medium">{tr('detail.colMember')}</th>
              <th className="w-20 px-2 text-right font-medium">{tr('detail.colRows')}</th>
              <th className="w-16 px-2 text-right font-medium">{tr('detail.colCols')}</th>
              <th className="px-2 font-medium">{tr('detail.colPipelines')}</th>
              <th className="px-2 font-medium">{tr('detail.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((table) => (
              <tr
                key={table.id}
                className="h-9 cursor-pointer border-b border-dashed border-border-muted hover:bg-surface-hover"
                onDoubleClick={() => onOpenTable(table)}
              >
                <td className="px-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-text-primary hover:text-accent"
                    onClick={() => onOpenTable(table)}
                  >
                    <Table2 className="h-3.5 w-3.5 text-accent" />
                    {table.name}
                  </button>
                </td>
                <td className="px-2 text-text-secondary">{table.memberKey ?? '—'}</td>
                <td className="px-2 text-right tabular-nums">{table.rowCount}</td>
                <td className="px-2 text-right tabular-nums">{table.columnCount}</td>
                <td className="px-2 text-text-secondary">
                  {table.relatedPipelineNames.join('、') || '—'}
                </td>
                <td
                  className={`px-2 ${table.memberStatus === 'missing' ? 'text-warning' : 'text-success'}`}
                >
                  {table.memberStatus === 'missing' ? tr('list.memberMissing') : tr('statusOk')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
