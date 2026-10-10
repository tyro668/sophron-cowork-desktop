import { buildScheduledTaskTitle } from '../../../shared/schedule/task-title';
import { ensureProjectIdForLegacyCwd } from '../../app/projects';
import { getWorkspacePathUnsupportedReason } from '../../app/workdir';
import { handleIpc } from '../../ipc-handle';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from '../../schedule/scheduled-task-manager';
import { logError } from '../../utils/logger';
import { requireAutomationService, rescheduleAutomations } from '../automation/service';
import {
  scheduleInputToTrigger,
  scheduleInputToActionGraph,
  scheduleDeliveryToAutomationDelivery,
  automationToScheduledTask,
  resolveScheduledTaskTitle,
} from './service';

export function registerScheduleIpc(): void {
  handleIpc('schedule.list', () => {
    try {
      return requireAutomationService().list().automations.map(automationToScheduledTask);
    } catch (error) {
      logError('[Schedule] Error listing pipelines:', error);
      return [];
    }
  });

  handleIpc('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
    const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const projectId = ensureProjectIdForLegacyCwd(payload.cwd);
    const normalizedPrompt = payload.prompt.trim();
    const title = payload.title
      ? buildScheduledTaskTitle(payload.title)
      : await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd);
    const created = requireAutomationService().create({
      name: title,
      projectId,
      enabled: payload.enabled,
      trigger: scheduleInputToTrigger(payload),
      actionGraph: scheduleInputToActionGraph({ ...payload, prompt: normalizedPrompt, projectId }),
      delivery: scheduleDeliveryToAutomationDelivery(payload.automationConfig?.delivery),
    });
    rescheduleAutomations();
    return automationToScheduledTask(created);
  });

  handleIpc('schedule.update', async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
    const existingAutomation = requireAutomationService().get(id);
    if (!existingAutomation) return null;
    const existing = automationToScheduledTask(existingAutomation);
    const nextCwd = updates.cwd ?? existing.cwd;
    const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt = updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
    const legacyProjectId =
      updates.cwd !== undefined
        ? ensureProjectIdForLegacyCwd(nextCwd)
        : (existingAutomation.projectId ?? ensureProjectIdForLegacyCwd(existing.cwd));
    const normalizedUpdates: ScheduledTaskUpdateInput = {
      ...updates,
      prompt: normalizedPrompt,
    };

    if (updates.title !== undefined) {
      normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
    } else if (updates.prompt !== undefined) {
      normalizedUpdates.title = await resolveScheduledTaskTitle(
        normalizedPrompt,
        updates.cwd ?? existing.cwd,
        existing.title
      );
    }
    const merged: ScheduledTask = { ...existing, ...normalizedUpdates } as ScheduledTask;
    const updated = requireAutomationService().update(id, {
      name: normalizedUpdates.title,
      projectId:
        updates.cwd !== undefined || (!existingAutomation.projectId && legacyProjectId)
          ? legacyProjectId
          : undefined,
      enabled: normalizedUpdates.enabled,
      trigger:
        updates.runAt !== undefined ||
        updates.scheduleConfig !== undefined ||
        updates.repeatEvery !== undefined ||
        updates.repeatUnit !== undefined
          ? scheduleInputToTrigger({
              runAt: merged.runAt,
              scheduleConfig: merged.scheduleConfig,
              repeatEvery: merged.repeatEvery,
              repeatUnit: merged.repeatUnit,
            })
          : undefined,
      actionGraph:
        updates.prompt !== undefined ||
        updates.cwd !== undefined ||
        updates.automationConfig !== undefined
          ? scheduleInputToActionGraph({
              prompt: merged.prompt,
              cwd: merged.cwd,
              projectId: legacyProjectId,
              automationConfig: merged.automationConfig,
            })
          : undefined,
      delivery:
        updates.automationConfig !== undefined
          ? scheduleDeliveryToAutomationDelivery(merged.automationConfig?.delivery)
          : undefined,
    });
    rescheduleAutomations();
    return updated ? automationToScheduledTask(updated) : null;
  });

  handleIpc('schedule.delete', (_event, id: string) => {
    const result = requireAutomationService().delete(id);
    rescheduleAutomations();
    return result;
  });

  handleIpc('schedule.toggle', (_event, id: string, enabled: boolean) => {
    const updated = requireAutomationService().setEnabled(id, enabled);
    rescheduleAutomations();
    return updated ? automationToScheduledTask(updated) : null;
  });

  handleIpc('schedule.runNow', async (_event, id: string) => {
    await requireAutomationService().runNow(id);
    const updated = requireAutomationService().get(id);
    return updated ? automationToScheduledTask(updated) : null;
  });
}
