import type {
  AutomationCreateInput,
  AutomationListQuery,
  AutomationRunQuery,
  AutomationUpdateInput,
} from '../../../shared/automation/types';
import { handleIpc } from '../../ipc-handle';
import { requireAutomationService, rescheduleAutomations } from './service';

export function registerAutomationIpc(): void {
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
}
