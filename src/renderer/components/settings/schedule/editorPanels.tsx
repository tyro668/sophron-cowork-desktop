import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, Folder, PencilLine, Play, Plus, Save } from 'lucide-react';
import type { Automation, AutomationTrigger, Project } from '../../../types';
import { GlassDateTimePicker } from '../../GlassDateTimePicker';
import { GlassSelect } from '../../GlassSelect';
import { GlassSwitch } from '../../GlassSwitch';
import { Button } from '../../ui/button';
import {
  type AutomationDraft,
  type EditableAutomationTrigger,
  type ScheduledAutomationTrigger,
  type TriggerMode,
  getProjectOptionLabel,
} from './types';
import { normalizeDraftTrigger } from './model';
import { ConfigRow, SegmentedControl, splitCsv } from './editor-controls';
import { MonthlyDayPicker, TimesEditor, WeekdayPicker } from './schedule-time-pickers';

const DEFAULT_INTERVAL_END_OFFSET_MS = 24 * 60 * 60 * 1000;

export function EditorHeader({
  selectedAutomation,
  draft,
  isSaving,
  onDraftChange,
  onSave,
  onRun,
  onBack,
  tr,
}: {
  selectedAutomation: Automation | null;
  draft: AutomationDraft;
  isSaving: boolean;
  onDraftChange: (draft: AutomationDraft) => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(draft.name);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditingTitle) {
      setLocalTitle(draft.name);
    }
  }, [draft.name, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const commitTitle = () => {
    const nextTitle = localTitle.trim();
    if (nextTitle) {
      onDraftChange({ ...draft, name: nextTitle });
    } else {
      setLocalTitle(draft.name);
    }
    setIsEditingTitle(false);
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 lg:h-10 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <button
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('schedule.backToList', '返回列表')}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {isEditingTitle ? (
            <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-surface px-2.5 shadow-soft ring-2 ring-accent/15">
              <input
                ref={titleInputRef}
                value={localTitle}
                maxLength={80}
                onChange={(event) => setLocalTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setLocalTitle(draft.name);
                    setIsEditingTitle(false);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
              />
            </span>
          ) : (
            <h1 className="truncate text-[16px] font-semibold text-text-secondary">{draft.name}</h1>
          )}
          {!isEditingTitle && (
            <button
              onClick={() => setIsEditingTitle(true)}
              disabled={isSaving}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={tr('common.edit', '编辑')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('common.edit', '编辑')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={onSave}
          disabled={isSaving}
          className="h-9 px-3 text-xs shadow-soft"
        >
          <Save className="h-3.5 w-3.5" />
          {tr('schedule.save', '保存')}
        </Button>
        {selectedAutomation && (
          <Button variant="primary" onClick={onRun} className="h-9 px-3 text-xs shadow-soft">
            <Play className="h-3.5 w-3.5" />
            {tr('schedule.runNowDetail', '立即运行')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function TaskStatusSection({
  enabled,
  onEnabledChange,
  tr,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled);

  useEffect(() => {
    setLocalEnabled(enabled);
  }, [enabled]);

  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      setLocalEnabled(checked);
      onEnabledChange(checked);
    },
    [onEnabledChange]
  );

  return (
    <section className="glass-card grid flex-shrink-0 gap-4 rounded-xl border border-border-muted bg-surface p-4 lg:grid-cols-[360px] lg:items-center">
      <div className="flex min-h-10 items-center gap-4">
        <span className="text-[13px] font-medium text-text-secondary">
          {tr('schedule.taskStatus', '任务状态')}
        </span>
        <GlassSwitch
          checked={localEnabled}
          onCheckedChange={handleCheckedChange}
          ariaLabel={tr('schedule.taskStatus', '任务状态')}
        />
        <span className="text-[13px] font-medium text-text-secondary">
          {localEnabled ? tr('schedule.enabled', '启用') : tr('schedule.disabled', '停用')}
        </span>
      </div>
    </section>
  );
}

export function ExecutionProjectPanel({
  draft,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const updateProject = (projectId: string) => {
    onDraftChange({
      ...draft,
      projectId,
      trigger:
        draft.trigger.kind === 'file_change'
          ? { ...draft.trigger, projectId: projectId || null }
          : draft.trigger,
    });
  };

  return (
    <section className="glass-card flex flex-shrink-0 flex-col rounded-xl border border-border-muted bg-surface p-4">
      <div className="flex h-9 flex-shrink-0 items-center border-b border-border-muted">
        <h2 className="text-[16px] font-semibold text-text-secondary">
          {tr('schedule.projectPanelTitle', '执行项目')}
        </h2>
      </div>
      <div className="pt-4">
        <GlassSelect
          value={draft.projectId}
          options={[
            { value: '', label: tr('schedule.projectPlaceholder', '不指定项目') },
            ...projects.map((project) => ({
              value: project.id,
              label: getProjectOptionLabel(project, tr),
            })),
          ]}
          onValueChange={updateProject}
          placeholder={tr('schedule.projectPlaceholder', '不指定项目')}
          triggerClassName="h-9 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </div>
    </section>
  );
}

export function TriggerConditionPanel({
  draft,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const trigger = normalizeDraftTrigger(draft.triggerMode, draft.trigger);
  const triggerMethod = draft.triggerMode === 'file_change' ? 'file_change' : 'scheduled';
  const setMode = (mode: TriggerMode) => {
    onDraftChange({
      ...draft,
      triggerMode: mode,
      trigger: normalizeDraftTrigger(mode, draft.trigger),
    });
  };

  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface p-4">
      <div className="flex h-9 flex-shrink-0 items-center border-b border-border-muted">
        <h2 className="text-[16px] font-semibold text-text-secondary">
          {tr('schedule.triggerTitle', '触发条件')}
        </h2>
      </div>
      <div className="pt-4">
        <ConfigRow label={tr('schedule.triggerMethod', '触发方式')}>
          <GlassSelect
            value={triggerMethod}
            options={[
              { value: 'scheduled', label: tr('schedule.triggerScheduled', '定时触发') },
              { value: 'file_change', label: tr('schedule.triggerFileChange', '文件变更时触发') },
            ]}
            onValueChange={(value) => {
              setMode(value === 'file_change' ? 'file_change' : 'daily');
            }}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {trigger.kind === 'file_change' ? (
          <FileChangeConfigCard
            draft={draft}
            trigger={trigger}
            projects={projects}
            onDraftChange={onDraftChange}
            tr={tr}
          />
        ) : (
          <ScheduledConfigCard
            trigger={trigger}
            mode={draft.triggerMode}
            onModeChange={setMode}
            onChange={(next) => onDraftChange({ ...draft, triggerMode: next.kind, trigger: next })}
            tr={tr}
          />
        )}
      </div>
    </section>
  );
}

// Display order Monday→Sunday; encoding stays 0=Sunday … 6=Saturday.

function ScheduledConfigCard({
  trigger,
  mode,
  onModeChange,
  onChange,
  tr,
}: {
  trigger: ScheduledAutomationTrigger;
  mode: TriggerMode;
  onModeChange: (mode: TriggerMode) => void;
  onChange: (trigger: ScheduledAutomationTrigger) => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <Clock className="h-4 w-4" />
        {tr('schedule.scheduledConfig', '定时配置')}
      </div>
      <div className="space-y-3.5">
        <ConfigRow label={tr('schedule.frequency', '执行频率')}>
          <SegmentedControl<'recurring' | 'interval' | 'once'>
            value={mode === 'interval' ? 'interval' : mode === 'once' ? 'once' : 'recurring'}
            options={[
              { value: 'recurring', label: tr('schedule.familyRecurring', '周期') },
              { value: 'interval', label: tr('schedule.familyInterval', '按间隔') },
              { value: 'once', label: tr('schedule.modeOnce', '单次') },
            ]}
            fill
            onChange={(family) =>
              onModeChange(
                family === 'interval' ? 'interval' : family === 'once' ? 'once' : 'daily'
              )
            }
          />
        </ConfigRow>
        {(mode === 'daily' || mode === 'weekly' || mode === 'monthly') && (
          <ConfigRow label={tr('schedule.repeat', '重复')}>
            <GlassSelect
              value={mode}
              options={[
                { value: 'daily', label: tr('schedule.modeDaily', '每天') },
                { value: 'weekly', label: tr('schedule.modeWeekly', '每周') },
                { value: 'monthly', label: tr('schedule.modeMonthly', '每月') },
              ]}
              onValueChange={(value: string) => onModeChange(value as TriggerMode)}
              triggerClassName="h-9 w-full justify-between"
            />
          </ConfigRow>
        )}
        {trigger.kind === 'once' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <div className="space-y-1.5">
              <GlassDateTimePicker
                value={trigger.runAt}
                onChange={(runAt) => onChange({ ...trigger, runAt })}
              />
              {trigger.runAt < Date.now() && (
                <p className="text-[11px] font-medium text-warning">
                  {tr(
                    'schedule.pastTimeWarning',
                    '所选时间已过去，保存后不会触发，请选择未来的时间。'
                  )}
                </p>
              )}
            </div>
          </ConfigRow>
        )}
        {trigger.kind === 'daily' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <TimesEditor
              times={trigger.times}
              onChange={(times) => onChange({ ...trigger, times })}
              tr={tr}
            />
          </ConfigRow>
        )}
        {trigger.kind === 'weekly' && (
          <>
            <ConfigRow label={tr('schedule.weekday', '执行星期')}>
              <WeekdayPicker
                value={trigger.weekdays}
                onChange={(weekdays) => onChange({ ...trigger, weekdays })}
                tr={tr}
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </ConfigRow>
          </>
        )}
        {trigger.kind === 'monthly' && (
          <>
            <ConfigRow label={tr('schedule.monthDay', '执行日期')}>
              <MonthlyDayPicker
                daysOfMonth={trigger.daysOfMonth}
                includeLastDay={trigger.includeLastDay}
                onChange={(next) => onChange({ ...trigger, ...next })}
                tr={tr}
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </ConfigRow>
          </>
        )}
        {trigger.kind === 'interval' && (
          <>
            <ConfigRow label={tr('schedule.every', '每')}>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_108px] gap-2">
                  <input
                    type="number"
                    min={1}
                    value={trigger.every}
                    onChange={(event) =>
                      onChange({ ...trigger, every: Number(event.target.value) || 1 })
                    }
                    className="input h-9 w-full text-xs"
                  />
                  <GlassSelect
                    value={trigger.unit}
                    options={[
                      { value: 'minute', label: tr('schedule.repeatUnitMinute', '分钟') },
                      { value: 'hour', label: tr('schedule.repeatUnitHour', '小时') },
                      { value: 'day', label: tr('schedule.repeatUnitDay', '天') },
                    ]}
                    onValueChange={(value: string) =>
                      onChange({ ...trigger, unit: value as 'minute' | 'hour' | 'day' })
                    }
                    triggerClassName="h-9 w-full justify-between"
                  />
                </div>
                <p className="text-[11px] text-text-muted">
                  {tr('schedule.intervalHint', '从开始时间起，每隔固定时长重复一次。')}
                </p>
              </div>
            </ConfigRow>
            <ConfigRow label={tr('schedule.startAt', '开始')}>
              <GlassDateTimePicker
                value={trigger.startAt}
                onChange={(startAt) =>
                  onChange({
                    ...trigger,
                    startAt,
                    endAt:
                      trigger.endAt != null && trigger.endAt <= startAt
                        ? startAt + DEFAULT_INTERVAL_END_OFFSET_MS
                        : trigger.endAt,
                  })
                }
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.endAtLabel', '结束')}>
              {trigger.endAt == null ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...trigger,
                      endAt: trigger.startAt + DEFAULT_INTERVAL_END_OFFSET_MS,
                    })
                  }
                  className="inline-flex h-9 items-center gap-1 self-start rounded-lg border border-dashed border-border-muted px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('schedule.setEndAt', '设置结束时间')}
                </button>
              ) : (
                <GlassDateTimePicker
                  value={trigger.endAt}
                  minValue={trigger.startAt + 1}
                  triggerClassName="w-full"
                  onChange={(endAt) => onChange({ ...trigger, endAt })}
                />
              )}
            </ConfigRow>
          </>
        )}
      </div>
    </div>
  );
}

function FileChangeConfigCard({
  draft,
  trigger,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  trigger: Extract<EditableAutomationTrigger, { kind: 'file_change' }>;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const projectId = trigger.projectId ?? draft.projectId;
  const updateTrigger = (next: Extract<AutomationTrigger, { kind: 'file_change' }>) => {
    onDraftChange({ ...draft, projectId: next.projectId ?? draft.projectId, trigger: next });
  };
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-accent">
        <Folder className="h-4 w-4" />
        {tr('schedule.fileChangeConfig', '文件变更配置')}
      </div>
      <div className="space-y-3.5">
        <ConfigRow label={tr('schedule.watchProject', '监听项目')}>
          <GlassSelect
            value={projectId ?? ''}
            options={[
              { value: '', label: tr('schedule.projectPlaceholder', '不指定项目') },
              ...projects.map((project) => ({
                value: project.id,
                label: getProjectOptionLabel(project, tr),
              })),
            ]}
            onValueChange={(value) => updateTrigger({ ...trigger, projectId: value || null })}
            placeholder={tr('schedule.projectPlaceholder', '不指定项目')}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
        <ConfigRow label={tr('schedule.watchPatterns', '文件范围')}>
          <input
            value={trigger.patterns.join(', ')}
            onChange={(event) =>
              updateTrigger({ ...trigger, patterns: splitCsv(event.target.value) })
            }
            placeholder="**/*, **/*.csv"
            className="input h-9 w-full text-xs"
          />
        </ConfigRow>
        <ConfigRow label={tr('schedule.debounceSeconds', '防抖秒数')}>
          <input
            type="number"
            min={1}
            value={Math.round(trigger.debounceMs / 1000)}
            onChange={(event) =>
              updateTrigger({
                ...trigger,
                debounceMs: Math.max(1, Number(event.target.value) || 30) * 1000,
              })
            }
            className="input h-9 w-full text-xs"
          />
        </ConfigRow>
      </div>
    </div>
  );
}

export { CloudTableProcessActionEditor } from './cloud-action-editors';
export { ActionChainSection } from './action-config-editors';
