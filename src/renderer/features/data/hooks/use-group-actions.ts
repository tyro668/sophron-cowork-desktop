import { formatDataErrorMessage } from '../model/errors';
import { useCallback } from 'react';
import type { DataGroupScope } from '../../../../shared/contracts';
import type { AssignGroupTarget, DataListGroup } from '../../../components/data-view/group-ui';
import { dataClient } from '../api/data-client';
import type { DataActionsDeps } from './data-action-deps';

export function useGroupActions({
  ui,
  dashboard,
  rawTables,
  t,
  confirmDelete,
}: Pick<DataActionsDeps, 'ui' | 'dashboard' | 'rawTables' | 't' | 'confirmDelete'>) {
  const { loadDashboard } = dashboard;
  const { loadRawTables } = rawTables;
  const reloadScope = useCallback(
    async (scope: DataGroupScope) => {
      if (scope === 'raw') {
        await loadRawTables({ preserveError: true });
      } else {
        await loadDashboard({
          preserveError: true,
          tab: scope === 'pipeline' ? 'pipelines' : 'result_tables',
        });
      }
    },
    [loadDashboard, loadRawTables]
  );

  const handleAssignToGroup = useCallback(
    async (scope: DataGroupScope, ids: string[], target: AssignGroupTarget) => {
      if (ids.length === 0 || !dataClient.has('assignGroup')) return;
      ui.setActionId('assign-group');
      ui.setError(null);
      try {
        let groupId = target.groupId;
        if (target.newGroupName) {
          const group = await dataClient.createGroup({ scope, name: target.newGroupName });
          groupId = group.id;
        }
        await dataClient.assignGroup({ scope, ids, groupId });
        await reloadScope(scope);
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [reloadScope, ui, t]
  );

  const handleRenameGroup = useCallback(
    async (scope: DataGroupScope, group: DataListGroup, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === group.name || !dataClient.has('renameGroup')) return;
      ui.setActionId(`rename-group-${group.id}`);
      ui.setError(null);
      try {
        await dataClient.renameGroup({ id: group.id, name: trimmed });
        await reloadScope(scope);
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [reloadScope, ui, t]
  );

  const handleDeleteGroup = useCallback(
    async (scope: DataGroupScope, group: DataListGroup) => {
      if (!dataClient.has('deleteGroup')) return;
      const confirmed = await confirmDelete({
        message: t('data.groups.deleteConfirm', { name: group.name }),
        name: group.name,
      });
      if (!confirmed) return;
      ui.setActionId(`delete-group-${group.id}`);
      ui.setError(null);
      try {
        await dataClient.deleteGroup(group.id);
        await reloadScope(scope);
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, reloadScope, t, ui]
  );

  return { handleAssignToGroup, handleRenameGroup, handleDeleteGroup };
}
