import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, PencilLine, Play, Plus, Save } from 'lucide-react';
import type { Automation, Project } from '../../../types';
import { GlassDateTimePicker } from '../../GlassDateTimePicker';
import { GlassSelect } from '../../GlassSelect';
import { GlassSwitch } from '../../GlassSwitch';
import { Button } from '../../ui/button';
import {
  type AutomationDraft,
  type ScheduledAutomationTrigger,
  type TriggerMode,
  getProjectOptionLabel,
} from './types';
import { normalizeDraftTrigger } from './model';
import { FormRow, SegmentedControl } from './editor-controls';
import { MonthlyDayPicker, TimesEditor, WeekdayPicker } from './schedule-time-pickers';

const DEFAULT_INTERVAL_END_OFFSET_MS = 24 * 60 * 60 * 1000;

export function EditorHeader({
  selectedAutomation,
  draft,
  isSaving,
  isDirty,
  onDraftChange,
  onEnabledChange,
  onSave,
  onRun,
  onBack,
  tr,
}: {
  selectedAutomation: Automation | null;
  draft: AutomationDraft;
  isSaving: boolean;
  isDirty: boolean;
  onDraftChange: (draft: AutomationDraft) => void;
  onEnabledChange: (enabled: boolean) => void;
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
    <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
      <div className="flex min-w-0 items-stretch">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 border-r border-border-subtle px-3.5 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('schedule.backToList', '返回列表')}
        </button>
        <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
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
            <h1 className="truncate text-[15px] font-medium text-text-secondary">{draft.name}</h1>
          )}
          {!isEditingTitle && (
            <button
              onClick={() => setIsEditingTitle(true)}
              disabled={isSaving}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={tr('common.edit', '编辑')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('common.edit', '编辑')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-stretch">
        <div className="flex items-center border-l border-border-subtle px-3">
          <HeaderStatusToggle
            enabled={draft.enabled}
            disabled={isSaving}
            onEnabledChange={onEnabledChange}
            tr={tr}
          />
        </div>
        {selectedAutomation && (
          <Button
            variant="primary"
            onClick={onRun}
            className="h-full rounded-none px-4 text-xs shadow-none"
          >
            <Play className="h-3.5 w-3.5" />
            {tr('schedule.runNowDetail', '立即运行')}
          </Button>
        )}
        <Button
          variant={isDirty ? 'primary' : 'secondary'}
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className="h-full rounded-none border-0 border-l border-border-subtle px-4 text-xs shadow-none"
        >
          <Save className="h-3.5 w-3.5" />
          {tr('schedule.save', '保存')}
        </Button>
      </div>
    </div>
  );
}

function HeaderStatusToggle({
  enabled,
  disabled,
  onEnabledChange,
  tr,
}: {
  enabled: boolean;
  disabled?: boolean;
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
    <div className="flex items-center gap-2">
      <GlassSwitch
        checked={localEnabled}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
        ariaLabel={tr('schedule.taskStatus', '任务状态')}
      />
      <span className="text-[12px] font-medium text-text-secondary">
        {localEnabled ? tr('schedule.enabled', '启用') : tr('schedule.disabled', '停用')}
      </span>
    </div>
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
    <section className="ui-group bg-surface">
      <h2 className="ui-group-title">{tr('schedule.projectPanelTitle', '执行项目')}</h2>
      <FormRow label={tr('schedule.project', '项目')}>
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
          triggerClassName="h-8 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </FormRow>
    </section>
  );
}

export function TriggerConditionPanel({
  draft,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const trigger = normalizeDraftTrigger(draft.triggerMode, draft.trigger);
  // Triggering on data changes lives on the tables themselves (关联自动化 →
  // 触发策略); the automation only offers manual and scheduled triggers.
  const triggerMethod = draft.triggerMode === 'manual' ? 'manual' : 'scheduled';
  const setMode = (mode: TriggerMode) => {
    onDraftChange({
      ...draft,
      triggerMode: mode,
      trigger: normalizeDraftTrigger(mode, draft.trigger),
    });
  };

  return (
    <section className="ui-group bg-surface">
      <h2 className="ui-group-title">{tr('schedule.triggerTitle', '触发条件')}</h2>
      <FormRow label={tr('schedule.triggerMethod', '触发方式')}>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<'manual' | 'scheduled'>
            value={triggerMethod}
            options={[
              { value: 'manual', label: tr('schedule.triggerManual', '手动触发') },
              { value: 'scheduled', label: tr('schedule.triggerScheduled', '定时触发') },
            ]}
            onChange={(value) => {
              setMode(value === 'manual' ? 'manual' : 'daily');
            }}
          />
          <span className="text-[11.5px] text-text-muted">
            {tr('schedule.triggerKindsNote', '仅支持手动 / 定时')}
          </span>
        </div>
      </FormRow>

      <div className="min-h-0 flex-1">
        {trigger.kind === 'manual' ? null : (
          <ScheduledConfigCard
            trigger={
              // Legacy file_change drafts open as a daily schedule on next save.
              trigger.kind === 'file_change'
                ? (normalizeDraftTrigger('daily', trigger) as ScheduledAutomationTrigger)
                : trigger
            }
            mode={draft.triggerMode === 'file_change' ? 'daily' : draft.triggerMode}
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
    <div>
      <div>
        <FormRow label={tr('schedule.frequency', '执行频率')}>
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
        </FormRow>
        {(mode === 'daily' || mode === 'weekly' || mode === 'monthly') && (
          <FormRow label={tr('schedule.repeat', '重复')}>
            <GlassSelect
              value={mode}
              options={[
                { value: 'daily', label: tr('schedule.modeDaily', '每天') },
                { value: 'weekly', label: tr('schedule.modeWeekly', '每周') },
                { value: 'monthly', label: tr('schedule.modeMonthly', '每月') },
              ]}
              onValueChange={(value: string) => onModeChange(value as TriggerMode)}
              triggerClassName="h-8 w-full justify-between"
            />
          </FormRow>
        )}
        {trigger.kind === 'once' && (
          <FormRow label={tr('schedule.executionTime', '执行时间')}>
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
          </FormRow>
        )}
        {trigger.kind === 'daily' && (
          <FormRow label={tr('schedule.executionTime', '执行时间')}>
            <TimesEditor
              times={trigger.times}
              onChange={(times) => onChange({ ...trigger, times })}
              tr={tr}
            />
          </FormRow>
        )}
        {trigger.kind === 'weekly' && (
          <>
            <FormRow label={tr('schedule.weekday', '执行星期')}>
              <WeekdayPicker
                value={trigger.weekdays}
                onChange={(weekdays) => onChange({ ...trigger, weekdays })}
                tr={tr}
              />
            </FormRow>
            <FormRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </FormRow>
          </>
        )}
        {trigger.kind === 'monthly' && (
          <>
            <FormRow label={tr('schedule.monthDay', '执行日期')}>
              <MonthlyDayPicker
                daysOfMonth={trigger.daysOfMonth}
                includeLastDay={trigger.includeLastDay}
                onChange={(next) => onChange({ ...trigger, ...next })}
                tr={tr}
              />
            </FormRow>
            <FormRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </FormRow>
          </>
        )}
        {trigger.kind === 'interval' && (
          <>
            <FormRow label={tr('schedule.every', '每')}>
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
                  triggerClassName="h-8 w-full justify-between"
                />
              </div>
            </FormRow>
            <FormRow label={tr('schedule.startAt', '开始')}>
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
            </FormRow>
            <FormRow label={tr('schedule.endAtLabel', '结束')}>
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
            </FormRow>
          </>
        )}
      </div>
    </div>
  );
}

export { ActionChainSection } from './action-config-editors';
