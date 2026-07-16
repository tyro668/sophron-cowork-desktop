import type { Automation, AutomationRun, AutomationTrigger, Project } from '../../../types';
import { getWorkingDirDisplayName } from '../../../utils/working-dir-label';
import type { PermissionPolicyId } from '../../../../shared/permission-policies';

export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
export const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const DEFAULT_TIME = '09:00';
export const AUTOMATION_TABLE_PAGE_SIZE = 10;
export const CLOUD_TARGET_TABLE_PAGE_SIZE = 50;
// Top-level "添加动作" menu only exposes two intents: a free-form task (conversation.run)
// and the unified data-processing action (CLOUD_TABLE_PROCESS_ACTION_TYPE). "复用数据任务"
// (data.task.run) is no longer a separate entry — it is a mode inside 数据处理.
export const ACTION_MENU_TYPES = ['conversation.run'];
export const CLOUD_TABLE_PROCESS_ACTION_TYPE = 'cloud.table.process';
export const DATA_ACTION_TYPES = ['data.task.run'];
export const DATA_PREVIEW_ACTION_TYPES = ['data.input.preview', 'data.output.preview'];
export const DATA_PROCESS_AI_CONFIG_KEY = '__dataProcessAiConfig';
export const DATA_PROCESS_TASK_CONFIG_KEY = '__dataProcessTaskConfig';

export type CloudAutomationWriteMode = 'create' | 'replace';
// Where an AI-described data-processing action reads from / writes to. For 'local',
// `tableId`/`tableName` carry the local dataset (source) or output-table (target) id+name,
// and cloud-only fields stay empty. Defaults to 'cloud' so existing saved configs are unchanged.
export type DataProcessLocation = 'cloud' | 'local';

export interface CloudAutomationSourceTable {
  location?: DataProcessLocation;
  tableId: string;
  tableName: string;
  spaceId?: string;
  spaceName?: string;
  projectId?: string;
  projectName?: string;
  datasourceId?: string;
  folderId?: string;
  rowCount?: number | null;
  columns?: Array<string | { name?: string; type?: string }>;
  updatedAt?: string;
  contentHash?: string;
}

export interface PendingCloudAutomationTemplate {
  createdAt: number;
  source: CloudAutomationSourceTable;
  accessModeLabel?: string;
  connectionLabel?: string;
}

export interface CloudTableAutomationConfig {
  kind: 'cloud_table_auto_process';
  source: CloudAutomationSourceTable;
  processRequirement: string;
  output: {
    location?: DataProcessLocation;
    writeMode: CloudAutomationWriteMode;
    targetTableId: string;
    tableName: string;
    spaceId?: string;
    projectId?: string;
    datasourceId?: string;
    folderId?: string;
  };
  accessModeLabel?: string;
  connectionLabel?: string;
}

export function normalizeDataProcessLocation(location: unknown): DataProcessLocation {
  return location === 'local' ? 'local' : 'cloud';
}

export function getSourceLocation(config: CloudTableAutomationConfig): DataProcessLocation {
  return normalizeDataProcessLocation(config.source.location);
}

export function getOutputLocation(config: CloudTableAutomationConfig): DataProcessLocation {
  return normalizeDataProcessLocation(config.output.location);
}

export interface CloudConnectionPayload {
  apiOrigin: string;
  apiKey?: string;
}

export function getProjectOptionLabel(
  project: Project,
  tr: (key: string, fallback: string) => string
): string {
  const name = project.name?.trim();
  if (name) return name;
  return getWorkingDirDisplayName(
    project.cwd,
    tr('welcome.defaultWorkingFolder', '默认工作目录'),
    tr('schedule.projectPlaceholder', '不指定项目')
  );
}

export type EditableAutomationTrigger = Exclude<AutomationTrigger, { kind: 'cron' | 'manual' }>;
export type ScheduledAutomationTrigger = Exclude<
  EditableAutomationTrigger,
  { kind: 'file_change' }
>;
export type TriggerMode = EditableAutomationTrigger['kind'];
export type ListTab = 'automations' | 'runs';
export type Banner = { tone: 'error' | 'success'; text: string };
export interface AutomationRunLogEntry {
  automation: Pick<Automation, 'id' | 'name'>;
  run: AutomationRun;
}

export interface AutomationDraft {
  name: string;
  description: string;
  projectId: string;
  enabled: boolean;
  permissionPolicy: PermissionPolicyId;
  triggerMode: TriggerMode;
  trigger: EditableAutomationTrigger;
  actionGraph: import('../../../types').AutomationActionGraph;
}
