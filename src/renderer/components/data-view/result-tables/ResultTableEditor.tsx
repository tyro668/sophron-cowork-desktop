import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  PencilLine,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  getAutomationTableBindings,
  tableBindingKey,
} from '../../../../shared/automation/table-bindings';
import { dataClient } from '../../../features/data/api/data-client';
import { resultTableDeleteImpact } from '../../../features/data/utils/delete-impact';
import type {
  DataPipeline,
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
  DataTableExportFormat,
} from '../../../types';
import { formatIpcError } from '../../../utils/ipc-error';
import { GlassDataGridPreview } from '../../GlassDataGridPreview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import {
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
  configFlushBodyClass,
  DataMoreMenu,
  formatDateTime,
  RAW_TABLE_PREVIEW_PAGE_SIZE,
  RawTableSelect,
  RawTableStatusBadge,
} from '../shared';
import { ResultTableAutomations } from '../table-automations';
import {
  InlineInfoTooltip,
  LineageChip,
  StatCard,
  upstreamRawNames,
  useResultTableExport,
} from './ResultTablePrimitives';

export function ResultTableEditor({
  resultTable,
  rawTables,
  isRawTablesLoading,
  isBusy,
  pipelines,
  onBack,
  onSave,
  onRunPipeline,
  onDelete,
  onOpenPipeline,
}: {
  resultTable: DataResultTable;
  rawTables: DataRawTable[];
  isRawTablesLoading: boolean;
  isBusy: boolean;
  pipelines: DataPipeline[];
  onBack: () => void;
  onSave: (
    resultTable: DataResultTable,
    name: string,
    sourceRawTableId: string | null
  ) => void | Promise<void>;
  onRunPipeline: (pipeline: DataPipeline) => void | Promise<void>;
  onDelete?: (resultTable: DataResultTable) => void | Promise<void>;
  onOpenPipeline?: (pipeline: DataPipeline) => void;
}) {
  const { t } = useTranslation();
  const [readers, setReaders] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => dataClient.listAutomations())
      .then((result) => {
        if (!active) return;
        const ref = { kind: 'result' as const, tableId: resultTable.id };
        setReaders(
          (result?.automations ?? [])
            .filter((automation) =>
              getAutomationTableBindings(automation).some(
                (binding) => tableBindingKey(binding) === tableBindingKey(ref)
              )
            )
            .map((automation) => automation.name)
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resultTable.id]);
  const [localName, setLocalName] = useState(resultTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceRawTableId, setSourceRawTableId] = useState(resultTable.sourceRawTableId ?? '');
  const [activeTab, setActiveTab] = useState<'data' | 'config' | 'automation'>('config');
  const [preview, setPreview] = useState<DataRawTablePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [runBusy, setRunBusy] = useState(false);
  const { exportBusy, exportResultTable, canExport } = useResultTableExport();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const busy = isBusy;
  const trimmedName = localName.trim();
  const canSave = Boolean(
    trimmedName &&
    !busy &&
    (trimmedName !== resultTable.name ||
      (sourceRawTableId || null) !== resultTable.sourceRawTableId)
  );

  const rawTableOptions = useMemo(() => {
    const options = rawTables.map((rawTable) => ({
      value: rawTable.id,
      label: rawTable.name,
    }));
    if (sourceRawTableId && !options.some((option) => option.value === sourceRawTableId)) {
      options.unshift({ value: sourceRawTableId, label: sourceRawTableId });
    }
    const emptyLabel = isRawTablesLoading
      ? t('data.resultTables.editor.loadingRawTables')
      : t('data.resultTables.editor.noRawTable');
    return [{ value: '', label: emptyLabel }, ...options];
  }, [rawTables, isRawTablesLoading, sourceRawTableId, t]);

  // The pipeline that produced this table — matched by id (name fallback for
  // dashboards loaded before relatedPipelineIds existed).
  const listedPipeline = useMemo(() => {
    for (const id of resultTable.relatedPipelineIds ?? []) {
      const found = pipelines.find((pipeline) => pipeline.id === id);
      if (found) return found;
    }
    return (
      pipelines.find((pipeline) => resultTable.relatedPipelineNames.includes(pipeline.name)) ?? null
    );
  }, [pipelines, resultTable.relatedPipelineIds, resultTable.relatedPipelineNames]);
  // Opened from a chat link the dashboard may not have loaded pipelines yet: fetch it directly.
  const [fetchedPipeline, setFetchedPipeline] = useState<DataPipeline | null>(null);
  const firstRelatedPipelineId = resultTable.relatedPipelineIds?.[0] ?? null;
  useEffect(() => {
    setFetchedPipeline(null);
    if (listedPipeline || !firstRelatedPipelineId || !dataClient.has('getPipeline')) return;
    let active = true;
    void Promise.resolve()
      .then(() => dataClient.getPipeline(firstRelatedPipelineId))
      .then((pipeline) => {
        if (active && pipeline) setFetchedPipeline(pipeline);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [listedPipeline, firstRelatedPipelineId]);
  const relatedPipeline = listedPipeline ?? fetchedPipeline;

  const loadPreview = useCallback(
    async (page: number) => {
      if (!dataClient.has('previewRawTable')) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await dataClient.previewRawTable({
          id: resultTable.id,
          limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * RAW_TABLE_PREVIEW_PAGE_SIZE,
        });
        setPreview(result);
        setPreviewPage(page);
      } catch (err) {
        setPreviewError(formatIpcError(err, String(err)));
      } finally {
        setPreviewLoading(false);
      }
    },
    [resultTable.id]
  );

  const handleSave = async () => {
    if (!canSave) return;
    await onSave(resultTable, localName, sourceRawTableId || null);
    await loadPreview(previewPage);
  };

  // Header preview toggle: enter preview (data tab + reload) or exit back to
  // the config tab.
  const handlePreviewToggle = async () => {
    if (activeTab === 'data') {
      setActiveTab('config');
      return;
    }
    setActiveTab('data');
    await loadPreview(1);
  };

  useEffect(() => {
    setPreview(null);
    setPreviewPage(1);
    setActiveTab('config');
    void loadPreview(1);
  }, [loadPreview]);

  useEffect(() => {
    setLocalName(resultTable.name);
    setIsNameEditing(false);
    setSourceRawTableId(resultTable.sourceRawTableId ?? '');
  }, [resultTable.id, resultTable.name, resultTable.sourceRawTableId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  const handleRunRelatedPipeline = async () => {
    if (!relatedPipeline || runBusy) return;
    setRunBusy(true);
    try {
      await onRunPipeline(relatedPipeline);
      await loadPreview(previewPage);
    } finally {
      setRunBusy(false);
    }
  };

  const handleExport = (format: DataTableExportFormat) => exportResultTable(resultTable.id, format);

  const exportDisabled = busy || exportBusy !== null || !canExport;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={onBack}
            className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.resultTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
            <RawTableStatusBadge label={t('data.resultTables.status.available')} tone="success" />
            {isNameEditing ? (
              <input
                ref={nameInputRef}
                value={localName}
                onChange={(event) => setLocalName(event.target.value)}
                onBlur={() => setIsNameEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setLocalName(resultTable.name);
                    setIsNameEditing(false);
                  }
                }}
                disabled={busy}
                maxLength={50}
                aria-label={t('data.resultTables.editor.name')}
                className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[14px] font-semibold text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('data.resultTables.editor.title')}
              />
            ) : (
              <div
                className="flex h-8 min-w-0 max-w-[18rem] items-center truncate text-[14px] font-semibold text-text-primary"
                title={localName || t('data.resultTables.editor.title')}
              >
                {localName || t('data.resultTables.editor.title')}
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsNameEditing(true)}
              disabled={busy || isNameEditing}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('common.edit')}
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-stretch">
          {relatedPipeline && (
            <button
              type="button"
              onClick={() => void handleRunRelatedPipeline()}
              disabled={busy || runBusy}
              title={t('data.resultTables.editor.runPipelineTitle', { name: relatedPipeline.name })}
              className="inline-flex h-full w-[92px] items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {runBusy
                ? t('data.resultTables.editor.running')
                : t('data.resultTables.editor.runPipeline')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handlePreviewToggle()}
            disabled={busy && activeTab !== 'data'}
            aria-pressed={activeTab === 'data'}
            className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeTab === 'data'
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-accent-muted hover:text-accent'
            }`}
          >
            {activeTab === 'data' ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {activeTab === 'data'
              ? t('data.rawTables.actions.exitPreview')
              : t('data.rawTables.actions.preview')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            data-testid="result-editor-save"
            className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50 ${
              canSave ? 'text-accent' : 'text-text-secondary hover:text-accent'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <DataMoreMenu
            items={[
              {
                key: 'export',
                label: t('data.resultTables.editor.export'),
                icon: <Download className="h-3.5 w-3.5" />,
                disabled: exportDisabled,
                children: [
                  {
                    key: 'export-csv',
                    label: t('data.resultTables.editor.exportCsv'),
                    icon: <FileText className="h-3.5 w-3.5" />,
                    disabled: exportDisabled,
                    onClick: () => void handleExport('csv'),
                  },
                  {
                    key: 'export-xlsx',
                    label: t('data.resultTables.editor.exportExcel'),
                    icon: <Download className="h-3.5 w-3.5" />,
                    disabled: exportDisabled,
                    onClick: () => void handleExport('xlsx'),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'data' | 'config' | 'automation')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent
          value="config"
          className="ui-config-flush min-h-0 flex-1 overflow-y-auto bg-surface"
        >
          <div className="grid">
            <div className="ui-group grid gap-px bg-border-subtle sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t('data.resultTables.stats.rows')}
                value={resultTable.rowCount.toLocaleString('en-US')}
              />
              <StatCard
                label={t('data.resultTables.stats.columns')}
                value={String(resultTable.columnCount)}
              />
              <StatCard
                label={t('data.resultTables.stats.pipeline')}
                value={relatedPipeline?.name ?? '—'}
                link={Boolean(relatedPipeline)}
              />
              <StatCard
                label={t('data.resultTables.stats.updatedAt')}
                value={formatDateTime(resultTable.updatedAt)}
                plain
              />
            </div>
            <section className="ui-group ui-form-flush bg-surface">
              <div className="ui-group-title">{t('data.resultTables.sections.basic')}</div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.basic.nameLabel')}
                </div>
                <div className="ui-form-value">
                  <input
                    value={localName}
                    onChange={(event) => setLocalName(event.target.value)}
                    disabled={busy}
                    maxLength={50}
                    aria-label={t('data.resultTables.editor.name')}
                    data-testid="result-basic-name"
                    className="outline-none hover:bg-surface-hover focus:bg-surface-hover disabled:opacity-60"
                  />
                </div>
              </div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  <span className="inline-flex items-center gap-1.5">
                    {t('data.resultTables.editor.rawTable')}
                    <InlineInfoTooltip label={t('data.resultTables.editor.rawTableInfo')} />
                  </span>
                </div>
                <div className="ui-form-value">
                  <RawTableSelect
                    flush
                    value={sourceRawTableId}
                    options={rawTableOptions}
                    disabled={busy || isRawTablesLoading}
                    onChange={setSourceRawTableId}
                  />
                </div>
              </div>
            </section>
            <section className="ui-group ui-form-flush bg-surface">
              <div className="ui-group-title">{t('data.resultTables.lineage.title')}</div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.lineage.flowLabel')}
                </div>
                <div className="ui-form-value !flex-row">
                  <div className="flex min-h-[35px] min-w-0 flex-1 flex-wrap items-center gap-1.5 px-[10px] py-1 text-[12.5px]">
                    {upstreamRawNames(resultTable, relatedPipeline, rawTables).map((name) => (
                      <LineageChip
                        key={name}
                        kind={t('data.resultTables.lineage.raw')}
                        name={name}
                      />
                    ))}
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <LineageChip
                      kind={t('data.resultTables.lineage.pipeline')}
                      name={relatedPipeline?.name ?? '—'}
                    />
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <LineageChip
                      kind={t('data.resultTables.lineage.result')}
                      name={resultTable.name}
                      active
                    />
                  </div>
                  {relatedPipeline && onOpenPipeline ? (
                    <button
                      type="button"
                      onClick={() => onOpenPipeline(relatedPipeline)}
                      className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('data.resultTables.lineage.openPipeline')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.lineage.downstreamLabel')}
                </div>
                <div className="ui-form-value">
                  <span className="ui-flush-text">
                    {readers.length > 0
                      ? t('data.resultTables.lineage.downstreamText', {
                          count: readers.length,
                          names: readers.join('、'),
                        })
                      : t('data.resultTables.lineage.downstreamNone')}
                  </span>
                </div>
              </div>
            </section>
            {onDelete && (
              <section
                className="ui-group ui-form-flush bg-surface"
                data-testid="result-danger-zone"
              >
                <div className="ui-group-title">{t('data.resultTables.danger.title')}</div>
                <div className="ui-form-row">
                  <div className="ui-form-label items-center">
                    {t('data.resultTables.danger.deleteTitle')}
                  </div>
                  <div className="ui-form-value !flex-row">
                    <span className="flex min-w-0 flex-1 items-center px-[10px] py-2 text-[12.5px] text-text-muted">
                      {t('data.resultTables.danger.deleteHint')}{' '}
                      {resultTableDeleteImpact(resultTable, t)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onDelete(resultTable)}
                      className="inline-flex w-[140px] flex-shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('data.resultTables.danger.deleteAction')}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <GlassDataGridPreview
            preview={preview}
            isLoading={previewLoading}
            error={previewError}
            currentPage={previewPage}
            onPageChange={(page) => void loadPreview(page)}
            onRetry={() => void loadPreview(previewPage)}
            labels={{
              loading: t('data.resultTables.editor.dataLoading'),
              empty: t('data.resultTables.editor.dataEmpty'),
              total: (count) => t('data.workflow.nodeDataTotal', { count }),
              errorTitle: t('data.preview.loadFailed'),
              retry: t('data.preview.retry'),
              pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
            }}
            edgeToEdge
            rowHeight={32}
            headerHeight={34}
          />
        </TabsContent>
        <TabsContent value="automation" className={configFlushBodyClass}>
          <ResultTableAutomations key={resultTable.id} resultTable={resultTable} embedded grid />
        </TabsContent>
        <div className={`${bottomTabBarClass} justify-between`}>
          <TabsList className={bottomTabListClass}>
            <TabsTrigger value="config" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.config')}
            </TabsTrigger>
            <TabsTrigger value="data" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.data')}
            </TabsTrigger>
            <TabsTrigger value="automation" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.automation')}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 px-4 text-xs text-text-muted">
            {activeTab === 'data' && preview && (
              <span>
                {t('data.resultTables.editor.dataMeta', {
                  rows: preview.totalRows,
                  time: formatDateTime(resultTable.updatedAt),
                })}
              </span>
            )}
            {activeTab === 'data' && (
              <button
                type="button"
                onClick={() => void loadPreview(previewPage)}
                disabled={previewLoading}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={t('data.actions.refresh')}
                title={t('data.actions.refresh')}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </Tabs>
    </section>
  );
}
