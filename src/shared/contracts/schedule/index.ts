/**
 * Cross-process schedule contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';

export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduleWeekday[];
  times: string[];
}

export interface MonthlyScheduleConfig {
  kind: 'monthly';
  daysOfMonth: number[];
  includeLastDay?: boolean;
  times: string[];
}

export type ScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig | MonthlyScheduleConfig;

export type ScheduleAutomationActionKind = 'conversation' | 'data_pipeline';

export type ScheduleAutomationArtifactPolicy = 'summary' | 'links' | 'files';

export type ScheduleAutomationDeliveryChannel = 'feishu' | 'slack' | 'webhook' | 'email';

export interface ScheduleAutomationRecipient {
  id: string;
  label: string;
  channel: ScheduleAutomationDeliveryChannel;
  target: string;
  enabled: boolean;
}

export interface ScheduleAutomationDeliveryConfig {
  enabled: boolean;
  artifactPolicy: ScheduleAutomationArtifactPolicy;
  recipients: ScheduleAutomationRecipient[];
}

export interface ScheduleAutomationConfig {
  actionKind: ScheduleAutomationActionKind;
  dataPipelineId?: string | null;
  dataPipelineName?: string | null;
  delivery: ScheduleAutomationDeliveryConfig;
}

export interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  automationConfig: ScheduleAutomationConfig | null;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  automationConfig?: ScheduleAutomationConfig | null;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  automationConfig?: ScheduleAutomationConfig | null;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}
