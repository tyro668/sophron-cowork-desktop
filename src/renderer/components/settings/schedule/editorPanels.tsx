import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, PencilLine, Play, Plus } from 'lucide-react';
import type { Automation, Project } from '../../../types';
import { GlassDateTimePicker } from '../../GlassDateTimePicker';
import { GlassSelect } from '../../GlassSelect';
import { GlassSwitch } from '../../GlassSwitch';
import {
  type AutomationDraft,
  type ScheduledAutomationTrigger,
  type TriggerMode,
  getProjectOptionLabel,
} from './types';
import { normalizeDraftTrigger } from './model';
import { FormRow } from './editor-controls';
import {
  MonthlyDayPicker,
  TimesEditor,
  WeekdayPicker,
  flushPickerTriggerClass,
} from './schedule-time-pickers';

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
          data-testid="automation-editor-back"
          className="inline-flex w-[104px] flex-shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('schedule.backToListShort', '返回列表')}
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
                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-text-primary outline-none"
              />
            </span>
          ) : (
            <h1 className="truncate text-[14px] font-semibold text-text-primary">{draft.name}</h1>
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
      <div className="flex items-stretch" data-testid="automation-editor-actions">
        <div className="flex w-[108px] items-center justify-center whitespace-nowrap border-l border-border-subtle px-2">
          <HeaderStatusToggle
            enabled={draft.enabled}
            disabled={isSaving}
            onEnabledChange={onEnabledChange}
            tr={tr}
          />
        </div>
        {selectedAutomation && (
          <button
            type="button"
            onClick={onRun}
            data-testid="automation-run-now"
            className="ui-accent-cell w-[104px] border-l border-border-subtle"
          >
            <Play className="h-3.5 w-3.5" />
            {tr('schedule.runNowDetail', '立即运行')}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          data-testid="automation-save"
          className={`inline-flex w-20 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isDirty
              ? 'text-accent-text hover:bg-accent-muted/60'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
          {tr('schedule.save', '保存')}
        </button>
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
        {localEnabled
          ? tr('schedule.headerEnabled', '已启用')
          : tr('schedule.headerDisabled', '已停用')}
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
    <section className="ui-group ui-form-flush bg-surface">
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
          triggerClassName="w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </FormRow>
    </section>
  );
}

export function TriggerConditionPanel({
  draft,
  onDraftChange,
  nextRunAt,
  triggerDirty = false,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  /** Saved next run time of the automation (null when manual / none scheduled). */
  nextRunAt?: number | null;
  /** The trigger differs from the saved one, so the saved next run is stale. */
  triggerDirty?: boolean;
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
    <section className="ui-group ui-form-flush bg-surface" data-testid="automation-trigger-group">
      <h2 className="ui-group-title">{tr('schedule.triggerTitle', '触发条件')}</h2>
      <FormRow label={tr('schedule.triggerMethod', '触发方式')}>
        <GlassSelect
          value={triggerMethod}
          ariaLabel={tr('schedule.triggerMethod', '触发方式')}
          options={[
            { value: 'manual', label: tr('schedule.triggerManual', '手动触发') },
            { value: 'scheduled', label: tr('schedule.triggerScheduled', '定时触发') },
          ]}
          onValueChange={(value: string) => {
            if (value === triggerMethod) return;
            setMode(value === 'manual' ? 'manual' : 'daily');
          }}
          triggerClassName="w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </FormRow>
      {trigger.kind === 'manual' ? (
        <FormRow label={tr('schedule.noteLabel', '说明')}>
          <span className="ui-flush-text">
            {tr('schedule.manualTriggerHint', '仅在点击「立即运行」或由其他入口手动触发时执行')}
          </span>
        </FormRow>
      ) : (
        <>
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
          <FormRow label={tr('schedule.nextRunLabel', '下次执行')}>
            <span className="ui-flush-text" data-testid="automation-next-run">
              {triggerDirty
                ? tr('schedule.nextRunAfterSave', '保存后更新')
                : nextRunAt
                  ? formatNextRun(nextRunAt)
                  : '—'}
            </span>
          </FormRow>
        </>
      )}
    </section>
  );
}

/** 「10-26 周一 09:00」 — month-day, short weekday, time. */
export function formatNextRun(timestamp: number, locale?: string): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const weekday = date.toLocaleDateString(
    locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'),
    { weekday: 'short' }
  );
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekday} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    <>
      <>
        <FormRow label={tr('schedule.frequency', '执行频率')}>
          <GlassSelect
            value={mode === 'interval' ? 'interval' : mode === 'once' ? 'once' : 'recurring'}
            ariaLabel={tr('schedule.frequency', '执行频率')}
            options={[
              { value: 'recurring', label: tr('schedule.familyRecurring', '周期') },
              { value: 'interval', label: tr('schedule.familyInterval', '按间隔') },
              { value: 'once', label: tr('schedule.modeOnce', '单次') },
            ]}
            onValueChange={(family: string) => {
              const current =
                mode === 'interval' ? 'interval' : mode === 'once' ? 'once' : 'recurring';
              if (family === current) return;
              onModeChange(
                family === 'interval' ? 'interval' : family === 'once' ? 'once' : 'daily'
              );
            }}
            triggerClassName="w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
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
              triggerClassName="w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </FormRow>
        )}
        {trigger.kind === 'once' && (
          <FormRow label={tr('schedule.executionTime', '执行时间')}>
            <div className="flex flex-1 flex-col">
              <GlassDateTimePicker
                value={trigger.runAt}
                triggerClassName={flushPickerTriggerClass}
                onChange={(runAt) => onChange({ ...trigger, runAt })}
              />
              {trigger.runAt < Date.now() && (
                <p className="border-t border-border-subtle px-[10px] py-1.5 text-[11px] font-medium text-warning">
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
              flush
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
                flush
                value={trigger.weekdays}
                onChange={(weekdays) => onChange({ ...trigger, weekdays })}
                tr={tr}
              />
            </FormRow>
            <FormRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                flush
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
                flush
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </FormRow>
          </>
        )}
        {trigger.kind === 'interval' && (
          <>
            <FormRow label={tr('schedule.intervalLabel', '间隔')}>
              <div className="grid min-h-[35px] flex-1 grid-cols-[minmax(0,4fr)_minmax(0,3fr)]">
                <input
                  type="number"
                  min={1}
                  value={trigger.every}
                  onChange={(event) =>
                    onChange({ ...trigger, every: Number(event.target.value) || 1 })
                  }
                  aria-label={tr('schedule.every', '每')}
                  className="h-full w-full border-0 border-r border-border-subtle bg-transparent px-[10px] text-[12.5px] tabular-nums outline-none hover:bg-surface-hover focus:bg-surface-hover"
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
                  triggerClassName={`justify-between ${flushPickerTriggerClass}`}
                  contentClassName="w-[var(--radix-select-trigger-width)]"
                />
              </div>
            </FormRow>
            <FormRow label={tr('schedule.startAtLabel', '开始时间')}>
              <GlassDateTimePicker
                value={trigger.startAt}
                triggerClassName={flushPickerTriggerClass}
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
            <FormRow label={tr('schedule.endAtLabelLong', '结束时间')}>
              {trigger.endAt == null ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...trigger,
                      endAt: trigger.startAt + DEFAULT_INTERVAL_END_OFFSET_MS,
                    })
                  }
                  className="ui-accent-cell ui-flush-control !justify-start"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('schedule.setEndAt', '设置结束时间')}
                </button>
              ) : (
                <GlassDateTimePicker
                  value={trigger.endAt}
                  minValue={trigger.startAt + 1}
                  triggerClassName={flushPickerTriggerClass}
                  onChange={(endAt) => onChange({ ...trigger, endAt })}
                />
              )}
            </FormRow>
          </>
        )}
      </>
    </>
  );
}

export { ActionChainSection } from './action-config-editors';
