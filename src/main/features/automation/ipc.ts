import type {
  AutomationAssignGroupInput,
  AutomationTableRef,
  AutomationTablePolicy,
  AutomationCreateGroupInput,
  AutomationCreateInput,
  AutomationListQuery,
  AutomationRenameGroupInput,
  AutomationRunQuery,
  AutomationUpdateInput,
} from '../../../shared/automation/types';
import { handleIpc } from '../../ipc-handle';
import { requireAutomationService, rescheduleAutomations } from './service';

export function registerAutomationIpc(): void {
  handleIpc(
    'automation.tableAssociation.replace',
    (_event, table: AutomationTableRef, previousId: string, nextId: string) => {
      requireAutomationService().replaceTableAssociation(table, previousId, nextId);
      rescheduleAutomations();
    }
  );
  handleIpc('automation.tablePolicy.get', (_event, table: AutomationTableRef) =>
    requireAutomationService().getTablePolicy(table)
  );
  handleIpc(
    'automation.tablePolicy.set',
    (_event, table: AutomationTableRef, patch: Partial<AutomationTablePolicy>) => {
      const policy = requireAutomationService().setTablePolicy(table, patch);
      rescheduleAutomations();
      return policy;
    }
  );
  handleIpc('automation.list', (_event, query?: AutomationListQuery) => {
    return requireAutomationService().list(query);
  });

  handleIpc('automation.get', (_event, id: string) => {
    return requireAutomationService().get(id);
  });

  handleIpc('automation.create', (_event, payload: AutomationCreateInput) => {
    const created = requireAutomationService().create(payload);
    rescheduleAutomations();
    return created;
  });

  handleIpc('automation.update', (_event, id: string, updates: AutomationUpdateInput) => {
    const updated = requireAutomationService().update(id, updates);
    rescheduleAutomations();
    return updated;
  });

  handleIpc('automation.delete', (_event, id: string) => {
    const result = requireAutomationService().delete(id);
    rescheduleAutomations();
    return result;
  });

  handleIpc('automation.setEnabled', (_event, id: string, enabled: boolean) => {
    const updated = requireAutomationService().setEnabled(id, enabled);
    rescheduleAutomations();
    return updated;
  });

  handleIpc('automation.pause', (_event, id: string) => {
    const updated = requireAutomationService().pause(id);
    rescheduleAutomations();
    return updated;
  });

  handleIpc('automation.resume', (_event, id: string) => {
    const updated = requireAutomationService().resume(id);
    rescheduleAutomations();
    return updated;
  });

  handleIpc('automation.runNow', async (_event, id: string) => {
    return requireAutomationService().runNow(id);
  });

  handleIpc('automation.runs.list', (_event, id: string, query?: AutomationRunQuery) => {
    return requireAutomationService().listRuns(id, query);
  });

  handleIpc('automation.artifacts.list', (_event, runId: string) => {
    return requireAutomationService().listArtifacts(runId);
  });

  handleIpc('automation.actions.listDefinitions', () => {
    return requireAutomationService().listActionDefinitions();
  });

  handleIpc('automation.groups.list', () => {
    return requireAutomationService().listGroups();
  });

  handleIpc('automation.groups.create', (_event, payload: AutomationCreateGroupInput) => {
    return requireAutomationService().createGroup(payload);
  });

  handleIpc('automation.groups.rename', (_event, payload: AutomationRenameGroupInput) => {
    return requireAutomationService().renameGroup(payload);
  });

  handleIpc('automation.groups.delete', (_event, id: string) => {
    return requireAutomationService().deleteGroup(id);
  });

  handleIpc('automation.groups.assign', (_event, payload: AutomationAssignGroupInput) => {
    return requireAutomationService().assignGroup(payload);
  });
}
