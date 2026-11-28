import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Database, FileSpreadsheet, FileText, Folder, type LucideIcon } from 'lucide-react';
import { Cell, FormGrid, FormScroll, LabelCell } from '../../../workflow-forms/shared/FormGrid';
import { INPUT_GRID_COLUMNS } from '../../../workflow-forms/shared/gridColumns';
import type {
  DataGroup,
  DataRawSource,
  DataRawTable,
  DataRawTableSourceKind,
  DataWorkflowNode,
} from '../../../../types';
import { isRawTableUnavailable } from '../../../../../shared/contracts';
import type { GlassSelectOption } from '../../../GlassSelect';
import { RawTableTreeSelect } from '../../raw-table-tree-select';
import { dataClient } from '../../../../features/data/api/data-client';
import { stringValue } from './workflow-summary';

const SOURCE_KIND_ICONS: Record<DataRawTableSourceKind, LucideIcon> = {
  cloud: Cloud,
  excel: FileSpreadsheet,
  csv: FileText,
  folder: Folder,
};

const MERGE_MODES = new Set(['folder_merge', 'excel_merge_sheets']);

/** Picker options grouped by data source (design 4.4): multi-table and merged sources get a
 *  header; search matches the source name too; tables missing from their source are muted. */
export function rawTableOptionsBySource(
  rawTables: DataRawTable[],
  sources: DataRawSource[],
  t: (key: string, options?: Record<string, unknown>) => string
): GlassSelectOption[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const grouped = new Map<string, DataRawTable[]>();
  const flat: DataRawTable[] = [];
  for (const table of rawTables) {
    const source = table.sourceId ? byId.get(table.sourceId) : undefined;
    if (source && (source.memberIds.length > 1 || MERGE_MODES.has(source.buildMode))) {
      grouped.set(source.id, [...(grouped.get(source.id) ?? []), table]);
    } else {
      flat.push(table);
    }
  }
  const option = (table: DataRawTable, source?: DataRawSource): GlassSelectOption => {
    const unavailable = isRawTableUnavailable(table);
    return {
      value: table.id,
      label: table.name,
      hint: unavailable
        ? String(t('data.rawTables.status.unavailable'))
        : String(t('data.rawSources.done.rowsValue', { rows: table.rowCount.toLocaleString() })),
      disabled: unavailable,
      muted: unavailable,
      ...(source
        ? {
            group: source.id,
            groupLabel: source.name,
            groupMeta: MERGE_MODES.has(source.buildMode)
              ? String(t('data.rawSources.list.mergeBadge'))
              : String(source.memberIds.length),
            searchText: source.name,
          }
        : {}),
    };
  };
  const out: GlassSelectOption[] = [];
  for (const [sourceId, tables] of grouped) {
    const source = byId.get(sourceId)!;
    for (const table of tables) out.push(option(table, source));
  }
  for (const table of flat) out.push(option(table));
  return out;
}

export function WorkflowInputSourceConfig({
  node,
  rawTables,
  isLoading,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  rawTables: DataRawTable[];
  isLoading: boolean;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<DataRawSource[]>([]);
  const [groups, setGroups] = useState<DataGroup[]>([]);
  useEffect(() => {
    if (!dataClient.isAvailable()) return;
    let cancelled = false;
    if (dataClient.has('listRawSources')) {
      void dataClient
        .listRawSources()
        .then((next) => {
          if (!cancelled) setSources(next);
        })
        .catch(() => undefined);
    }
    if (dataClient.has('listGroups')) {
      void dataClient
        .listGroups('raw')
        .then((next) => {
          if (!cancelled) setGroups(next);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);
  const selectedRawTableId = stringValue(node.config.rawTableId);
  const selectedRawTableName =
    stringValue(node.config.rawTableName) || stringValue(node.config.name);
  const selectedRawTableById =
    rawTables.find((rawTable) => rawTable.id === selectedRawTableId) ?? null;
  // DSL-authored inputs bind by table name (`input rawTable "销售订单"`).
  const selectedRawTable =
    selectedRawTableById ??
    rawTables.find((rawTable) => rawTable.name === selectedRawTableId) ??
    null;
  const SelectedSourceIcon = selectedRawTable
    ? SOURCE_KIND_ICONS[selectedRawTable.sourceKind]
    : null;
  const hasAvailableRawTables = rawTables.some((rawTable) => !isRawTableUnavailable(rawTable));
  const handleRawTableChange = useCallback(
    (rawTableId: string) => {
      const selectedRawTable = rawTables.find((rawTable) => rawTable.id === rawTableId);
      if (selectedRawTable && isRawTableUnavailable(selectedRawTable)) return;
      onNodeChange((current) => {
        const nextConfig: Record<string, unknown> = { ...current.config };
        if (selectedRawTable) {
          nextConfig.source = 'rawTable';
          nextConfig.rawTableId = selectedRawTable.id;
          nextConfig.rawTableName = selectedRawTable.name;
          nextConfig.name = selectedRawTable.name;
        } else {
          delete nextConfig.source;
          delete nextConfig.rawTableId;
          delete nextConfig.rawTableName;
          delete nextConfig.name;
        }
        delete nextConfig.filePath;
        delete nextConfig.sheet;
        delete nextConfig.encoding;
        delete nextConfig.incrementalBy;
        return {
          ...current,
          config: nextConfig,
          updatedAt: Date.now(),
        };
      });
    },
    [rawTables, onNodeChange]
  );

  const alias = stringValue(node.config.alias);
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const formatUpdated = (ms: number) => {
    const d = new Date(ms);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  return (
    <FormScroll>
      <FormGrid columns={INPUT_GRID_COLUMNS} testId="input-form-grid">
        <LabelCell required>{t('data.workflow.rawTable')}</LabelCell>
        <Cell v={['ctl', !selectedRawTableId && !isLoading && 'err']}>
          <RawTableTreeSelect
            ariaLabel={t('data.workflow.rawTable')}
            value={selectedRawTable ? selectedRawTable.id : selectedRawTableId}
            rawTables={rawTables}
            sources={sources}
            groups={groups}
            loading={isLoading}
            loadingLabel={t('data.workflow.loadingRawTables')}
            disabled={isLoading || (!selectedRawTableId && !hasAvailableRawTables)}
            placeholder={
              hasAvailableRawTables
                ? t('data.workflow.selectRawTable')
                : t('data.workflow.noAvailableRawTables')
            }
            fallbackLabel={
              selectedRawTableId && !selectedRawTable
                ? selectedRawTableName ||
                  (isLoading ? selectedRawTableId : t('data.workflow.rawTableDeleted'))
                : undefined
            }
            fallbackMuted={Boolean(
              selectedRawTableId && !selectedRawTable && !selectedRawTableName && !isLoading
            )}
            triggerIcon={<Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
            onValueChange={handleRawTableChange}
          />
        </Cell>
        <Cell v={['muted']}>
          {selectedRawTable && SelectedSourceIcon ? (
            <span
              className="truncate"
              title={t(`data.rawTables.sources.${selectedRawTable.sourceKind}`)}
            >
              {t('data.workflow.inputTableInfo', {
                columns: selectedRawTable.columnCount.toLocaleString(),
                rows: selectedRawTable.rowCount.toLocaleString(),
                updated: formatUpdated(selectedRawTable.updatedAt),
              })}
            </span>
          ) : null}
        </Cell>

        {selectedRawTable?.memberStatus === 'missing' ? (
          <>
            <LabelCell>{t('data.rawSources.missing.label')}</LabelCell>
            <Cell v={['ctl', 'err']}>
              <span className="truncate text-error" data-testid="input-member-missing">
                {t('data.rawSources.missing.inline')}
              </span>
            </Cell>
            <Cell v={['muted']}>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={node.config.allowMissingSourceMember === true}
                  onChange={(event) =>
                    onNodeChange((current) => ({
                      ...current,
                      config: {
                        ...current.config,
                        allowMissingSourceMember: event.target.checked,
                      },
                      updatedAt: Date.now(),
                    }))
                  }
                  data-testid="input-allow-missing-member"
                />
                {t('data.rawSources.missing.useLastData')}
              </label>
            </Cell>
          </>
        ) : null}

        <LabelCell>{t('data.workflow.inputAlias')}</LabelCell>
        <Cell v={['mono']}>{alias || '—'}</Cell>
        <Cell v={['muted']}>
          <span className="truncate">
            {alias
              ? t('data.workflow.inputAliasHint', { alias })
              : t('data.workflow.inputAliasNone')}
          </span>
        </Cell>
      </FormGrid>
    </FormScroll>
  );
}
