import { app, Notification } from 'electron';
import type { Automation, AutomationRun } from '../../shared/automation/types';
import { APP_INTERNAL_NAME, APP_NAME_EN } from '../../shared/branding';
import type { Session, DataPipeline } from '../../shared/contracts';
import { logWarn } from '../utils/logger';
import { appContext } from './context';

export interface SystemNotificationInput {
  title: string;
  body?: string;
}

export function getRuntimeAppName(): string {
  const runtimeName = app.getName();
  return runtimeName && runtimeName !== APP_INTERNAL_NAME ? runtimeName : APP_NAME_EN;
}

export function sendSystemNotification(input: SystemNotificationInput): void {
  try {
    if (!Notification.isSupported()) {
      logWarn('[Notification] System notifications are not supported on this platform');
      return;
    }
    const notification = new Notification({
      title: truncateNotificationText(input.title, 90),
      body: input.body ? truncateNotificationText(input.body, 220) : undefined,
    });
    notification.on('click', () => {
      if (!appContext.mainWindow || appContext.mainWindow.isDestroyed()) return;
      if (appContext.mainWindow.isMinimized()) appContext.mainWindow.restore();
      appContext.mainWindow.show();
      appContext.mainWindow.focus();
    });
    notification.show();
  } catch (error) {
    logWarn('[Notification] Failed to show system notification:', error);
  }
}

export function notifyConversationCompleted(session: Session): void {
  sendSystemNotification({
    title: '对话任务完成',
    body: session.title || getRuntimeAppName(),
  });
}

export function notifyAutomationRunFinished(automation: Automation, run: AutomationRun): void {
  if (automation.trigger.kind === 'file_change') return;
  const succeeded = run.status === 'succeeded';
  const isManualTrigger = automation.trigger.kind === 'manual';
  sendSystemNotification({
    title: succeeded
      ? isManualTrigger
        ? '任务执行完成'
        : '定时任务执行完成'
      : isManualTrigger
        ? '任务执行失败'
        : '定时任务执行失败',
    body: succeeded ? automation.name : `${automation.name}${run.error ? `：${run.error}` : ''}`,
  });
}

export function notifyDataPipelineCompleted(task: DataPipeline): void {
  const shape =
    task.rowCount === null
      ? ''
      : `，${task.rowCount} 行${task.columnCount === null ? '' : `，${task.columnCount} 列`}`;
  sendSystemNotification({
    title: '数据加工执行完成',
    body: `${task.name}${shape}`,
  });
}

export function truncateNotificationText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
