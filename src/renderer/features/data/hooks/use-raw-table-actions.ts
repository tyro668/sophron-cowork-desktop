import { rawTableDeleteImpact } from '../utils/delete-impact';
import { formatDataErrorMessage } from '../model/errors';
import { useCallback } from 'react';
import type {
  DataRawTable,
  DataRawTableConfig,
  DataRawTableSourceKind,
} from '../../../../shared/contracts';
import { DATA_DELETE_BATCH_SIZE, isMatchingSearchText } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import { showToast } from '../../../utils/toast';
import { formatRawSourceRefreshSummary } from '../../../components/data-view/raw-source-refresh-dialog';
import type { RawTableDraft } from '../model/types';
import type { DataActionsDeps } from './data-action-deps';

export function useRawTableActions({
  ui,
  dashboard,
  rawTables,
  drafts,
  editors,
  t,
  confirmDelete,
}: Pick<
  DataActionsDeps,
  'ui' | 'dashboard' | 'rawTables' | 'drafts' | 'editors' | 't' | 'confirmDelete'
>) {
  const { loadDashboard } = dashboard;
  const { loadRawTables } = rawTables;
  const handleRefreshCloudRawTable = useCallback(
    async (rawTable: DataRawTable) => {
      if (!dataClient.has('refreshCloudRawTable')) return;
      ui.setActionId(`cloud-sync:${rawTable.id}`);
      ui.setError(null);
      try {
        const result = await dataClient.refreshCloudRawTable({ rawTableId: rawTable.id });
        await Promise.all([
          loadRawTables({ preserveError: true }),
          loadDashboard({ preserveError: true }),
        ]);
        return result.rawTable;
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await loadDashboard({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [loadDashboard, loadRawTables, ui, t]
  );

  /** Re-reads a local file / folder table from its source (refresh checks may mark it 数据异常). */
  const handleRefreshRawTable = useCallback(
    async (rawTable: DataRawTable) => {
      if (!rawTable.sourceId || !dataClient.has('refreshRawSource')) return undefined;
      ui.setActionId(`refresh:${rawTable.id}`);
      try {
        const result = await dataClient.refreshRawSource(rawTable.sourceId);
        const failed = result.failed.find((entry) => entry.id === rawTable.id) ?? result.failed[0];
        if (failed) showToast('error', formatDataErrorMessage(failed.error, t));
        else showToast('success', t('data.rawTables.editor.refreshDone'));
        await loadRawTables({ preserveError: true });
        return (await dataClient.getRawTable(rawTable.id)) ?? undefined;
      } catch (err) {
        showToast('error', formatDataErrorMessage(err, t));
        return undefined;
      } finally {
        ui.setActionId(null);
      }
    },
    [loadRawTables, ui, t]
  );

  const handleCreateRawTableDraft = useCallback(() => {
    const draft = drafts.createDraft(
      `${t('data.rawTables.defaultName')} ${rawTables.totalRawTables + drafts.drafts.length + 1}`
    );
    ui.setActiveTab('raw_tables');
    ui.setSearchQuery('');
    editors.setEditingRawTableId(null);
    editors.setEditingRawTableDraftId(draft.id);
  }, [drafts, editors, rawTables.totalRawTables, t, ui]);

  const handleRenameRawTableDraft = useCallback(
    (id: string, name: string) => {
      drafts.renameDraft(id, name);
    },
    [drafts]
  );

  const handleDeleteRawTableDraft = useCallback(
    (id: string) => {
      drafts.removeDraft(id);
      editors.setEditingRawTableDraftId((current) => (current === id ? null : current));
    },
    [drafts, editors]
  );

  const handleImportRawTableSource = useCallback(
    async (
      draft: RawTableDraft,
      sourceKind: DataRawTableSourceKind,
      config: DataRawTableConfig,
      name?: string
    ): Promise<string | null> => {
      if (!dataClient.isAvailable()) return null;
      ui.setActionId(draft.id);
      ui.setError(null);
      try {
        const sourcePath =
          sourceKind === 'cloud' ? undefined : await dataClient.pickRawTableSourcePath(sourceKind);
        if (sourceKind !== 'cloud' && !sourcePath) return null;
        ui.setActiveTab('raw_tables');
        const imported =
          config.sourceKind === 'cloud'
            ? (
                await dataClient.importCloudRawTable({
                  ...config.cloudMirror,
                  name: name?.trim() || draft.name,
                })
              ).rawTable
            : await dataClient.importRawTable({
                filePath: sourcePath!,
                name: name?.trim() || draft.name,
                sourceKind,
                config,
              });
        drafts.removeDraft(draft.id);
        rawTables.upsertRawTable(imported, true);
        editors.setEditingRawTableDraftId(null);
        editors.setEditingRawTableId(imported.id);
        rawTables.setRawTablePage(1);
        await loadRawTables({ preserveError: true, page: 1 });
        return null;
      } catch (err) {
        // Shown inline under the source row by the editor (no toast).
        const message = formatDataErrorMessage(err, t);
        await loadRawTables({ preserveError: true });
        return message;
      } finally {
        ui.setActionId(null);
      }
    },
    [drafts, editors, rawTables, loadRawTables, ui, t]
  );

  const handleEditRawTable = useCallback(
    (id: string) => {
      ui.setActiveTab('raw_tables');
      editors.setEditingRawTableDraftId(null);
      editors.setEditingRawTableId(id);
    },
    [editors, ui]
  );

  const handleRenameRawTable = useCallback(
    async (rawTable: DataRawTable, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName === rawTable.name || !dataClient.has('updateRawTable')) {
        return;
      }
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateRawTable({
          id: rawTable.id,
          name: trimmedName,
        });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui, t]
  );

  const handleUpdateRawTableSource = useCallback(
    async (
      rawTable: DataRawTable,
      sourceKind: DataRawTableSourceKind,
      config: DataRawTableConfig,
      name?: string
    ): Promise<string | null> => {
      if (!dataClient.has('updateRawTable')) return null;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const sourcePath =
          sourceKind === 'cloud' ? undefined : await dataClient.pickRawTableSourcePath(sourceKind);
        if (sourceKind !== 'cloud' && !sourcePath) return null;
        if (
          rawTable.sourceId &&
          sourceKind !== 'cloud' &&
          sourceKind === rawTable.sourceKind &&
          dataClient.has('changeRawSourcePath')
        ) {
          const result = await dataClient.changeRawSourcePath({
            sourceId: rawTable.sourceId,
            sourcePath: sourcePath!,
          });
          await loadRawTables({ preserveError: true });
          const summary = formatRawSourceRefreshSummary(result, t);
          if (result.failed.length) {
            const message = formatDataErrorMessage(result.failed[0].error, t);
            showToast('error', `${summary}\n${message}`);
            return message;
          }
          showToast('success', summary);
          return null;
        }
        const updated =
          config.sourceKind === 'cloud'
            ? (
                await dataClient.importCloudRawTable({
                  ...config.cloudMirror,
                  rawTableId: rawTable.id,
                  name: name?.trim() || rawTable.name,
                })
              ).rawTable
            : await dataClient.updateRawTable({
                id: rawTable.id,
                filePath: sourcePath!,
                name: name?.trim() || rawTable.name,
                sourceKind,
                config,
              });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
        return null;
      } catch (err) {
        const message = formatDataErrorMessage(err, t);
        await loadRawTables({ preserveError: true });
        return message;
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui, t]
  );

  const handleUpdateRawTableConfig = useCallback(
    async (rawTable: DataRawTable, config: DataRawTableConfig, name?: string) => {
      if (!dataClient.has('updateRawTable')) return;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateRawTable({
          id: rawTable.id,
          name: name?.trim() || rawTable.name,
          sourceKind: config.sourceKind,
          config,
        });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
        return true;
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await loadRawTables({ preserveError: true });
        return false;
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui, t]
  );

  const handleDeleteRawTable = useCallback(
    async (rawTable: DataRawTable) => {
      if (!dataClient.has('deleteRawTable')) return;
      // A 自定义 normalizer only this table uses: offer to delete it too (no orphans).
      const normalizer = await ownNormalizer(rawTable);
      let deleteNormalizer = true;
      const confirmed = await confirmDelete({
        message: t('data.rawTables.deleteConfirm', { name: rawTable.name }),
        title: t('data.deleteImpact.rawTableTitle'),
        name: rawTable.name,
        impact: rawTableDeleteImpact(rawTable.id, dashboard.dashboard?.pipelines ?? [], t),
        ...(normalizer
          ? {
              option: {
                label: t('data.rawTables.deleteNormalizerToo'),
                defaultChecked: true,
                onChange: (checked: boolean) => {
                  deleteNormalizer = checked;
                },
              },
            }
          : {}),
      });
      if (!confirmed) return;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteRawTable(rawTable.id);
        if (!result.success) {
          throw new Error(t('data.rawTables.deleteNotFound'));
        }
        if (normalizer && deleteNormalizer) await dataClient.deleteRawTableNormalizer(normalizer);
        rawTables.removeRawTable(rawTable.id);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, dashboard.dashboard?.pipelines, rawTables, loadRawTables, t, ui]
  );

  const handleDeleteAllRawTables = useCallback(async () => {
    if (!dataClient.has('deleteRawTable')) return;
    const draftIds = drafts.drafts
      .filter((draft) => isMatchingSearchText(draft.name, ui.searchQuery))
      .map((draft) => draft.id);
    const count = rawTables.totalRawTables + draftIds.length;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.rawTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-raw-tables');
    ui.setError(null);
    try {
      if (draftIds.length > 0) {
        drafts.removeDrafts(draftIds);
        editors.setEditingRawTableDraftId((current) =>
          current && draftIds.includes(current) ? null : current
        );
      }
      let hasMoreRawTables = true;
      while (hasMoreRawTables) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: false,
          pipelineLimit: 0,
          rawTableOffset: 0,
          rawTableLimit: DATA_DELETE_BATCH_SIZE,
          rawTableSourceKind: 'all',
          outputLimit: 0,
        });
        hasMoreRawTables = page.rawTables.length > 0;
        if (!hasMoreRawTables) break;
        for (const rawTable of page.rawTables) {
          await dataClient.deleteRawTable(rawTable.id);
        }
      }
      editors.setEditingRawTableId(null);
      rawTables.setRawTablePage(1);
      await loadRawTables({ preserveError: true, page: 1 });
    } catch (err) {
      ui.setError(formatDataErrorMessage(err, t));
      await loadRawTables({ preserveError: true });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, drafts, editors, rawTables, loadRawTables, t, ui]);
  return {
    handleRefreshCloudRawTable,
    handleRefreshRawTable,
    handleCreateRawTableDraft,
    handleRenameRawTableDraft,
    handleDeleteRawTableDraft,
    handleImportRawTableSource,
    handleEditRawTable,
    handleRenameRawTable,
    handleUpdateRawTableSource,
    handleUpdateRawTableConfig,
    handleDeleteRawTable,
    handleDeleteAllRawTables,
  };
}
/** The table's 自定义 normalizer when no other raw table uses it. */
async function ownNormalizer(rawTable: DataRawTable): Promise<string | null> {
  const processing = rawTable.inputConfig?.dataProcessing;
  const artifactId =
    processing && processing.strategy === 'customize' ? processing.artifactId : undefined;
  if (!artifactId || !dataClient.has('listRawTableNormalizers')) return null;
  try {
    const usage = (await dataClient.listRawTableNormalizers()).find(
      (item) => item.artifact.id === artifactId
    );
    if (!usage) return null;
    return usage.usedBy.every((table) => table.id === rawTable.id) ? artifactId : null;
  } catch {
    return null;
  }
}
