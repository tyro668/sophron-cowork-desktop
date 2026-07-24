import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cloud,
  Database,
  Folder,
  Loader2,
  MessagesSquare,
  PencilLine,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  UploadCloud,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationActionNode,
  AutomationTrigger,
  AppConfig,
  DataCleaningTask,
  DataAnalyzeTaskRequirementResult,
  DataDashboard,
  DataGenerateTaskFromRequirementInput,
  DesktopAuthStatus,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  Project,
} from '../../../types';
import { useAppStore } from '../../../store';
import { GlassDateTimePicker } from '../../GlassDateTimePicker';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import { GlassSelect } from '../../GlassSelect';
import { GlassSwitch } from '../../GlassSwitch';
import { GlassTimePicker } from '../../GlassTimePicker';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import {
  ACTION_MENU_TYPES,
  CLOUD_TABLE_PROCESS_ACTION_TYPE,
  CLOUD_TARGET_TABLE_PAGE_SIZE,
  DATA_ACTION_TYPES,
  DATA_PREVIEW_ACTION_TYPES,
  DATA_PROCESS_AI_CONFIG_KEY,
  DATA_PROCESS_TASK_CONFIG_KEY,
  DEFAULT_TIME,
  type AutomationDraft,
  type CloudAutomationSourceTable,
  type CloudAutomationWriteMode,
  type CloudConnectionPayload,
  type CloudTableAutomationConfig,
  type DataProcessLocation,
  type EditableAutomationTrigger,
  type ScheduledAutomationTrigger,
  type TriggerMode,
  getOutputLocation,
  getProjectOptionLabel,
  getSourceLocation,
  isElectron,
} from './types';
import {
  buildCloudAutomationPrompt,
  createCloudTableProcessNode,
  createGeneratedCloudTableProcessNode,
  defaultConfigForAction,
  normalizeDraftTrigger,
  parseCloudAutomationConfig,
  relinkLinearGraph,
} from './model';

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
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('schedule.backToList', '返回列表')}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {isEditingTitle ? (
            <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-background/48 px-2.5 shadow-soft ring-2 ring-accent/15">
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={tr('common.edit', '编辑')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('common.edit', '编辑')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Save className="h-3.5 w-3.5" />
          {tr('schedule.save', '保存')}
        </button>
        {selectedAutomation && (
          <button
            onClick={onRun}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {tr('schedule.runNowDetail', '立即运行')}
          </button>
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
    <section className="glass-card grid flex-shrink-0 gap-4 rounded-xl border border-border-muted bg-surface/70 p-4 lg:grid-cols-[360px] lg:items-center">
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
    <section className="glass-card flex flex-shrink-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
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

function AutomationPromptPermissionFields({
  value,
  onChange,
  selectedSkillNames,
  onSelectedSkillNamesChange,
  onSkillSelectionCommit,
  appConfig,
  selectedModelConfigSetId,
  onModelSelect,
  placeholder,
  label,
  tr,
}: {
  value: string;
  onChange: (value: string) => void;
  selectedSkillNames: string[];
  onSelectedSkillNamesChange: (names: string[]) => void;
  onSkillSelectionCommit: (selection: { value: string; selectedSkillNames: string[] }) => void;
  appConfig: AppConfig | null;
  selectedModelConfigSetId?: string;
  onModelSelect: (selection: { configSetId: string; model: string }) => void;
  placeholder: string;
  label?: string;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <>
      <ConfigRow label={label ?? tr('schedule.conversationPrompt', '指令内容')}>
        <LlmPromptComposer
          value={value}
          onChange={onChange}
          selectedSkillNames={selectedSkillNames}
          onSelectedSkillNamesChange={onSelectedSkillNamesChange}
          onSkillSelectionCommit={onSkillSelectionCommit}
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          modelDisabled={!appConfig?.model?.trim()}
          modelFallbackLabel={tr('chat.noModel', '未配置模型')}
          placeholder={placeholder}
          onModelSelect={onModelSelect}
        />
      </ConfigRow>
    </>
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
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
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

      <div className="mt-6 min-h-0 flex-1">
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
const WEEKDAY_ORDER: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT_FALLBACK: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function WeekdayPicker({
  value,
  onChange,
  tr,
}: {
  value: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  onChange: (value: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const selected = new Set(value ?? []);
  const toggle = (day: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    const next = new Set(selected);
    if (next.has(day)) {
      // Keep at least one weekday selected — an empty list never computes a next run.
      if (next.size <= 1) return;
      next.delete(day);
    } else {
      next.add(day);
    }
    onChange(WEEKDAY_ORDER.filter((day) => next.has(day)));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_ORDER.map((day) => {
        const active = selected.has(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(day)}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-[12px] font-medium transition-colors ${
              active
                ? 'border-success bg-success text-white shadow-soft'
                : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/25 hover:bg-accent/10 hover:text-accent'
            }`}
          >
            {tr(`schedule.weekdayShort${day}`, WEEKDAY_SHORT_FALLBACK[day])}
          </button>
        );
      })}
    </div>
  );
}

function MonthlyDayPicker({
  daysOfMonth,
  includeLastDay = false,
  onChange,
  tr,
}: {
  daysOfMonth: number[];
  includeLastDay?: boolean;
  onChange: (next: { daysOfMonth: number[]; includeLastDay: boolean }) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(daysOfMonth ?? []);
  const emit = (nextDays: Set<number>, nextIncludeLastDay: boolean) => {
    onChange({
      daysOfMonth: MONTH_DAYS.filter((day) => nextDays.has(day)),
      includeLastDay: nextIncludeLastDay,
    });
  };
  const toggleDay = (day: number) => {
    const next = new Set(selected);
    if (next.has(day)) {
      next.delete(day);
      if (next.size === 0 && !includeLastDay) return;
    } else {
      next.add(day);
    }
    emit(next, includeLastDay);
  };
  const toggleLastDay = () => {
    if (includeLastDay && selected.size === 0) return;
    emit(selected, !includeLastDay);
  };
  const selectedTags = [
    ...MONTH_DAYS.filter((day) => selected.has(day)).map((day) => ({
      key: `day-${day}`,
      label: tr('schedule.monthDayNumber', '{{day}}').replace('{{day}}', String(day)),
      onRemove: () => toggleDay(day),
    })),
    ...(includeLastDay
      ? [
          {
            key: 'last-day',
            label: tr('schedule.monthLastDayShort', '最后一天'),
            onRemove: toggleLastDay,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2">
      <GlassDropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        contentClassName="w-[var(--radix-dropdown-menu-trigger-width)] !overflow-visible p-2.5"
        trigger={
          <button
            type="button"
            className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-background/42 px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:border-accent/25 hover:bg-surface-hover focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {selectedTags.length > 0 ? (
                selectedTags.slice(0, 4).map((tag) => (
                  <span
                    key={tag.key}
                    className="inline-flex h-5 max-w-[5.25rem] items-center gap-1 rounded-md bg-success/10 px-1.5 text-[11px] font-semibold text-success"
                  >
                    <span className="truncate">{tag.label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={tr('schedule.removeMonthDay', '移除执行日期')}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        tag.onRemove();
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        tag.onRemove();
                      }}
                      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-success/70 transition-colors hover:bg-success/10 hover:text-success"
                    >
                      <X className="h-2.5 w-2.5" />
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-text-muted">
                  {tr('schedule.monthDayPlaceholder', '请选择执行日期')}
                </span>
              )}
              {selectedTags.length > 4 && (
                <span className="inline-flex h-5 items-center rounded-md bg-background/62 px-1.5 text-[11px] text-text-muted">
                  +{selectedTags.length - 4}
                </span>
              )}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          </button>
        }
      >
        <div className="grid grid-cols-7 gap-1">
          {MONTH_DAYS.map((day) => {
            const active = selected.has(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                onClick={() => toggleDay(day)}
                className={`inline-flex h-8 min-w-0 items-center justify-center rounded-md border text-[12px] font-semibold transition-colors ${
                  active
                    ? 'border-success bg-success/12 text-success shadow-soft'
                    : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/25 hover:bg-accent/10 hover:text-accent'
                }`}
              >
                {tr('schedule.monthDayNumber', '{{day}}').replace('{{day}}', String(day))}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={includeLastDay}
            onClick={toggleLastDay}
            className={`col-span-7 mt-1 inline-flex h-8 items-center justify-center rounded-md border px-2 text-[12px] font-semibold transition-colors ${
              includeLastDay
                ? 'border-success bg-success/12 text-success shadow-soft'
                : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/25 hover:bg-accent/10 hover:text-accent'
            }`}
          >
            {tr('schedule.monthLastDay', '每月最后一天')}
          </button>
        </div>
      </GlassDropdownMenu>
    </div>
  );
}

function TimesEditor({
  times,
  onChange,
  tr,
}: {
  times: string[];
  onChange: (times: string[]) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const safeTimes = times && times.length > 0 ? times : [DEFAULT_TIME];
  const updateAt = (index: number, time: string) => {
    onChange(safeTimes.map((existing, position) => (position === index ? time : existing)));
  };
  const removeAt = (index: number) => {
    onChange(safeTimes.filter((_, position) => position !== index));
  };
  return (
    <div className="space-y-1.5">
      {safeTimes.map((time, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <GlassTimePicker value={time} onChange={(next) => updateAt(index, next)} />
          {safeTimes.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(index)}
              title={tr('schedule.removeTime', '删除')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-muted text-text-muted transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('schedule.removeTime', '删除')}</span>
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...safeTimes, DEFAULT_TIME])}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-border-muted px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        {tr('schedule.addTime', '添加时间')}
      </button>
    </div>
  );
}

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
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
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
                  className="inline-flex h-9 items-center gap-1 self-start rounded-lg border border-dashed border-border-muted px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
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
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
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

function CloudTableProcessActionEditor({
  node,
  config,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  config: CloudTableAutomationConfig;
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onChange: (node: AutomationActionNode) => void;
  onGeneratedTaskSuccess: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  const sourceLocation = getSourceLocation(config);
  const outputLocation = getOutputLocation(config);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const cloudConnection = useMemo(
    () => getCloudConnectionPayload(appConfig, desktopAuthStatus),
    [appConfig, desktopAuthStatus]
  );
  const conversationSelectedSkillNames = Array.isArray(node.config.selectedSkillNames)
    ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
    : [];
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const [isGeneratingTask, setIsGeneratingTask] = useState(false);
  const [isAnalyzingTask, setIsAnalyzingTask] = useState(false);
  const [requirementAnalysis, setRequirementAnalysis] =
    useState<DataAnalyzeTaskRequirementResult | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const updateConfig = (
    next: CloudTableAutomationConfig,
    nodeConfigUpdates: Record<string, unknown> = {}
  ) => {
    onChange({
      ...node,
      label: '',
      config: {
        ...node.config,
        prompt: buildCloudAutomationPrompt(next),
        cloudAutomation: next,
        ...nodeConfigUpdates,
      },
    });
  };
  const updateSource = (source: CloudAutomationSourceTable) => {
    setRequirementAnalysis(null);
    const previousDefaultName = `${config.source.tableName || 'cloud_table'}_processed`;
    const nextDefaultName = `${source.tableName || 'cloud_table'}_processed`;
    updateConfig({
      ...config,
      source,
      output: {
        ...config.output,
        spaceId: config.output.spaceId || source.spaceId,
        projectId: config.output.projectId || source.projectId,
        datasourceId: config.output.datasourceId || source.datasourceId,
        folderId: config.output.folderId || source.folderId,
        tableName:
          !config.output.tableName || config.output.tableName === previousDefaultName
            ? nextDefaultName
            : config.output.tableName,
        targetTableId:
          config.output.writeMode === 'replace' &&
          config.output.targetTableId === config.source.tableId
            ? source.tableId
            : config.output.targetTableId,
      },
    });
  };
  const updateSourceLocation = (location: DataProcessLocation) => {
    if (location === sourceLocation) return;
    updateSource({ location, tableId: '', tableName: '', columns: [], rowCount: null });
  };
  const updateLocalSource = (datasetId: string) => {
    const dataset = inputTables.find((table) => table.id === datasetId);
    updateSource({
      location: 'local',
      tableId: datasetId,
      tableName: dataset?.name ?? datasetId,
      columns: [],
      rowCount: dataset?.rowCount ?? null,
    });
  };
  const updateOutputLocation = (location: DataProcessLocation) => {
    if (location === outputLocation) return;
    // Target tables differ between cloud and local, so clear the target on switch.
    updateConfig({ ...config, output: { ...config.output, location, targetTableId: '' } });
  };
  const buildGenerationInput = (
    processRequirement = config.processRequirement
  ): DataGenerateTaskFromRequirementInput => {
    const reusableTaskConfig = getStashedDataProcessConfig(
      node.config,
      DATA_PROCESS_TASK_CONFIG_KEY
    );
    const reusableTaskSource =
      reusableTaskConfig?.source &&
      typeof reusableTaskConfig.source === 'object' &&
      !Array.isArray(reusableTaskConfig.source)
        ? (reusableTaskConfig.source as Record<string, unknown>)
        : null;
    const canReuseGeneratedTask =
      reusableTaskSource?.location === sourceLocation &&
      reusableTaskSource.tableId === config.source.tableId;
    const reusableTaskOutput =
      reusableTaskConfig?.output &&
      typeof reusableTaskConfig.output === 'object' &&
      !Array.isArray(reusableTaskConfig.output)
        ? (reusableTaskConfig.output as Record<string, unknown>)
        : null;
    const canReuseGeneratedOutputTable =
      canReuseGeneratedTask &&
      reusableTaskOutput?.tableName === config.output.tableName &&
      typeof reusableTaskOutput.localOutputTableId === 'string';
    return {
      source: {
        location: sourceLocation,
        tableId: config.source.tableId,
        tableName: config.source.tableName,
        spaceId: config.source.spaceId,
        spaceName: config.source.spaceName,
        projectId: config.source.projectId,
        projectName: config.source.projectName,
        datasourceId: config.source.datasourceId,
        folderId: config.source.folderId,
        columnsSnapshot: normalizeAutomationColumns(config.source.columns),
        updatedAt: config.source.updatedAt,
        contentHash: config.source.contentHash,
      },
      processRequirement,
      output: {
        location: outputLocation,
        writeMode: config.output.writeMode,
        targetTableId: config.output.targetTableId || undefined,
        tableName: config.output.tableName,
        spaceId: config.output.spaceId || config.source.spaceId,
        projectId: config.output.projectId || config.source.projectId,
        datasourceId: config.output.datasourceId || config.source.datasourceId,
        folderId: config.output.folderId || config.source.folderId,
        localOutputTableId: canReuseGeneratedOutputTable
          ? String(reusableTaskOutput.localOutputTableId)
          : undefined,
      },
      modelConfigSetId: selectedModelConfigSetId,
      model: typeof node.config.model === 'string' ? node.config.model : undefined,
      reuseTaskId:
        canReuseGeneratedTask && typeof reusableTaskConfig?.taskId === 'string'
          ? reusableTaskConfig.taskId
          : undefined,
      currentVersion:
        canReuseGeneratedTask && typeof reusableTaskConfig?.generatedVersion === 'number'
          ? reusableTaskConfig.generatedVersion
          : undefined,
    };
  };
  const analyzeTask = async () => {
    if (!window.electronAPI?.data?.analyzeTaskRequirement) return;
    setIsAnalyzingTask(true);
    setRequirementAnalysis(null);
    setGenerationError(null);
    try {
      setRequirementAnalysis(
        await window.electronAPI.data.analyzeTaskRequirement(buildGenerationInput())
      );
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : tr('schedule.analyzeTaskFailed', '解析处理要求失败')
      );
    } finally {
      setIsAnalyzingTask(false);
    }
  };
  const generateTask = async (processRequirement = config.processRequirement) => {
    if (!window.electronAPI?.data?.generateTaskFromRequirement) return;
    setIsGeneratingTask(true);
    setGenerationError(null);
    try {
      const result = await window.electronAPI.data.generateTaskFromRequirement(
        buildGenerationInput(processRequirement)
      );
      onChange(createGeneratedCloudTableProcessNode(node, config, result));
      onGeneratedTaskSuccess();
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : tr('schedule.generateTaskFailed', '生成数据任务失败')
      );
    } finally {
      setIsGeneratingTask(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
            {sourceLocation === 'local' ? (
              <Database className="h-4 w-4" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            {sourceLocation === 'local'
              ? tr('schedule.localInputSection', '输入数据表')
              : tr('schedule.cloudInputTable', '输入云表')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={sourceLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataSourceCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataSourceLocal', '本地表') },
            ]}
            onChange={updateSourceLocation}
          />
        </div>
        {sourceLocation === 'local' ? (
          <ConfigRow label={tr('schedule.localInputTable', '数据表')}>
            <LocalTableSelect
              value={config.source.tableId}
              tables={inputTables}
              placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
              searchPlaceholder={tr('schedule.localInputSearchPlaceholder', '搜索数据表')}
              onChange={updateLocalSource}
            />
          </ConfigRow>
        ) : (
          <CloudSourceTableSelector
            source={config.source}
            connection={cloudConnection}
            onSourceChange={updateSource}
            tr={tr}
          />
        )}
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
          <Wand2 className="h-4 w-4" />
          {tr('schedule.cloudProcessSection', '处理逻辑')}
        </div>
        <div className="space-y-4">
          <AutomationPromptPermissionFields
            value={config.processRequirement}
            onChange={(processRequirement) => {
              setRequirementAnalysis(null);
              updateConfig({
                ...config,
                processRequirement,
              });
            }}
            selectedSkillNames={conversationSelectedSkillNames}
            onSelectedSkillNamesChange={(selectedSkillNames) =>
              updateConfig(config, { selectedSkillNames })
            }
            onSkillSelectionCommit={({ value, selectedSkillNames }) => {
              setRequirementAnalysis(null);
              updateConfig(
                {
                  ...config,
                  processRequirement: value,
                },
                { selectedSkillNames }
              );
            }}
            appConfig={appConfig}
            selectedModelConfigSetId={selectedModelConfigSetId}
            onModelSelect={({ configSetId, model }) =>
              updateConfig(config, {
                modelConfigSetId: configSetId,
                model,
              })
            }
            label={tr('schedule.cloudProcessRequirement', '处理要求')}
            placeholder={
              sourceLocation === 'local'
                ? tr(
                    'schedule.dataProcessRequirementPlaceholder',
                    '描述你希望对这张表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
                : tr(
                    'schedule.cloudProcessRequirementPlaceholder',
                    '描述你希望对云表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
            }
            tr={tr}
          />
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {requirementAnalysis && (
              <div className="w-full rounded-lg border border-border-muted bg-background/45 p-3">
                <div className="mb-2 text-[12px] font-semibold text-text-secondary">
                  {tr('schedule.requirementAnalysisResult', '需求解析结果')}
                </div>
                <div className="space-y-2">
                  {requirementAnalysis.items.map((item, index) => (
                    <div
                      key={`${item.requirement}-${index}`}
                      className="flex items-start gap-2 rounded-md bg-bg-secondary/50 px-2.5 py-2"
                    >
                      {item.status === 'supported' ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <AlertCircle
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            item.status === 'ambiguous' ? 'text-warning' : 'text-danger'
                          }`}
                        />
                      )}
                      <div className="min-w-0 text-[12px] leading-5">
                        <div className="text-text-secondary">{item.requirement}</div>
                        {item.reason && <div className="text-text-muted">{item.reason}</div>}
                      </div>
                      <span
                        className={`ml-auto shrink-0 text-[11px] font-medium ${
                          item.status === 'supported'
                            ? 'text-success'
                            : item.status === 'ambiguous'
                              ? 'text-warning'
                              : 'text-danger'
                        }`}
                      >
                        {item.status === 'supported'
                          ? tr('schedule.requirementSupported', '可生成')
                          : item.status === 'ambiguous'
                            ? tr('schedule.requirementAmbiguous', '需确认')
                            : tr('schedule.requirementUnsupported', '暂不支持')}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRequirementAnalysis(null)}
                    className="h-8 rounded-lg border border-border-muted px-3 text-[12px] font-medium text-text-secondary hover:bg-bg-secondary"
                  >
                    {tr('schedule.modifyRequirement', '返回修改')}
                  </button>
                  {requirementAnalysis.items.some((item) => item.status === 'supported') && (
                    <button
                      type="button"
                      disabled={isGeneratingTask}
                      onClick={() =>
                        void generateTask(
                          requirementAnalysis.items
                            .filter((item) => item.status === 'supported')
                            .map((item) => item.suggestedRequirement || item.requirement)
                            .join('\n')
                        )
                      }
                      className="h-8 rounded-lg border border-success bg-success/5 px-3 text-[12px] font-semibold text-success hover:bg-success/10 disabled:opacity-50"
                    >
                      {requirementAnalysis.status === 'supported'
                        ? tr('schedule.confirmGenerateTask', '确认生成')
                        : tr('schedule.generateSupportedOnly', '仅生成可支持部分')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {isAnalyzingTask && (
              <div
                className="flex w-full items-center gap-2 rounded-md border border-success/20 bg-success/5 px-2.5 py-2 text-[12px] leading-5 text-text-secondary"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-success" />
                {tr('schedule.analyzingTaskRequirement', '正在拆解要求并匹配支持能力…')}
              </div>
            )}
            {isGeneratingTask && (
              <div
                className="flex w-full items-center gap-2 rounded-md border border-success/20 bg-success/5 px-2.5 py-2 text-[12px] leading-5 text-text-secondary"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-success" />
                {tr(
                  'schedule.parsingAndValidatingTask',
                  '正在拆解处理要求，并校验字段、参数和任务逻辑…'
                )}
              </div>
            )}
            <button
              type="button"
              disabled={
                isAnalyzingTask ||
                isGeneratingTask ||
                Boolean(requirementAnalysis) ||
                !config.source.tableId.trim() ||
                !config.processRequirement.trim() ||
                (config.output.writeMode === 'replace' && !config.output.targetTableId.trim())
              }
              onClick={() => void analyzeTask()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-success bg-success/5 px-3 text-xs font-semibold text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isAnalyzingTask || isGeneratingTask ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {isAnalyzingTask
                ? tr('schedule.analyzingTask', '正在解析')
                : isGeneratingTask
                  ? tr('schedule.parsingAndGeneratingTask', '正在解析并生成')
                  : tr('schedule.parseAndGenerateDataTask', '解析并生成')}
            </button>
            {generationError && (
              <div className="w-full rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-[12px] leading-5 text-warning">
                {generationError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
            {outputLocation === 'local' ? (
              <Save className="h-4 w-4" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {outputLocation === 'local'
              ? tr('schedule.localOutputSection', '输出到本地')
              : tr('schedule.cloudOutputSection', '输出到云分析')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={outputLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataOutputCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataOutputLocal', '本地表') },
            ]}
            onChange={updateOutputLocation}
          />
        </div>
        <div className="space-y-3.5">
          <ConfigRow label={tr('schedule.cloudWriteMode', '写入方式')}>
            <GlassSelect
              value={config.output.writeMode}
              options={[
                { value: 'create', label: tr('schedule.cloudWriteCreate', '新建结果表') },
                { value: 'replace', label: tr('schedule.cloudWriteReplace', '覆盖指定表') },
              ]}
              onValueChange={(value) =>
                updateConfig({
                  ...config,
                  output: {
                    ...config.output,
                    writeMode: value as CloudAutomationWriteMode,
                    targetTableId:
                      value === 'replace'
                        ? config.output.targetTableId ||
                          (outputLocation === 'cloud' ? config.source.tableId : '')
                        : config.output.targetTableId,
                  },
                })
              }
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
          {config.output.writeMode === 'replace' ? (
            outputLocation === 'local' ? (
              <ConfigRow label={tr('schedule.localTargetOutputTable', '目标输出表')}>
                <LocalTableSelect
                  value={config.output.targetTableId}
                  tables={outputTables}
                  placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
                  searchPlaceholder={tr('schedule.localOutputSearchPlaceholder', '搜索输出表')}
                  onChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                />
              </ConfigRow>
            ) : (
              <ConfigRow label={tr('schedule.cloudTargetTable', '目标表')}>
                <CloudReplaceTargetSelector
                  config={config}
                  connection={cloudConnection}
                  onTargetChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                  tr={tr}
                />
              </ConfigRow>
            )
          ) : (
            <ConfigRow label={tr('schedule.cloudOutputTableName', '结果表名')}>
              <input
                value={config.output.tableName}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    output: { ...config.output, tableName: event.target.value },
                  })
                }
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
          )}
        </div>
      </div>
    </div>
  );
}

function CloudSourceTableSelector({
  source,
  connection,
  onSourceChange,
  tr,
}: {
  source: CloudAutomationSourceTable;
  connection: CloudConnectionPayload;
  onSourceChange: (source: CloudAutomationSourceTable) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const spacesRequestSeq = useRef(0);
  const projectsRequestSeq = useRef(0);
  const tablesRequestSeq = useRef(0);
  const canBrowseCloud = Boolean(connection.apiOrigin && isElectron && window.electronAPI?.data);
  const error = tablesError ?? projectsError ?? spacesError;

  useEffect(() => {
    if (!canBrowseCloud) {
      setSpaces([]);
      setLoadingSpaces(false);
      spacesRequestSeq.current += 1;
      return;
    }
    const requestId = ++spacesRequestSeq.current;
    setLoadingSpaces(true);
    setSpacesError(null);
    void window.electronAPI.data
      .listCloudSpaces(connection)
      .then((result) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces(result.spaces);
      })
      .catch((loadError) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces([]);
        setSpacesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudCatalogLoadFailed', '加载云分析空间失败')
        );
      })
      .finally(() => {
        if (requestId === spacesRequestSeq.current) {
          setLoadingSpaces(false);
        }
      });
  }, [canBrowseCloud, connection, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId) {
      setProjects([]);
      setLoadingProjects(false);
      setProjectsError(null);
      projectsRequestSeq.current += 1;
      return;
    }
    const requestId = ++projectsRequestSeq.current;
    setLoadingProjects(true);
    setProjectsError(null);
    void window.electronAPI.data
      .listCloudProjects({ ...connection, spaceId: source.spaceId })
      .then((result) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects(result.projects);
      })
      .catch((loadError) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects([]);
        setProjectsError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudProjectsLoadFailed', '加载云分析项目失败')
        );
      })
      .finally(() => {
        if (requestId === projectsRequestSeq.current) {
          setLoadingProjects(false);
        }
      });
  }, [canBrowseCloud, connection, source.spaceId, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoadingTables(false);
      setTablesError(null);
      tablesRequestSeq.current += 1;
      return;
    }
    const requestId = ++tablesRequestSeq.current;
    setLoadingTables(true);
    setTablesError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables([]);
        setTablesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTablesLoadFailed', '加载云分析表格失败')
        );
      })
      .finally(() => {
        if (requestId === tablesRequestSeq.current) {
          setLoadingTables(false);
        }
      });
  }, [canBrowseCloud, connection, keyword, source.projectId, source.spaceId, tr]);

  const spaceOptions = [
    { value: '', label: tr('schedule.cloudSpacePlaceholder', '选择空间') },
    ...spaces.map((space) => ({ value: space.spaceId, label: space.spaceName || space.spaceId })),
  ];
  const projectOptions = [
    { value: '', label: tr('schedule.cloudProjectPlaceholder', '选择项目') },
    ...projects.map((project) => ({
      value: project.projectId,
      label: project.projectName || project.projectId,
    })),
  ];
  const tableOptions = [
    { value: '', label: tr('schedule.cloudTablePlaceholder', '选择云表') },
    ...tables.map((table) => ({
      value: table.tableId,
      label: `${table.tableName} (${table.tableId})`,
    })),
  ];
  if (source.tableId && !tableOptions.some((option) => option.value === source.tableId)) {
    tableOptions.push({
      value: source.tableId,
      label: `${source.tableName || source.tableId} (${source.tableId})`,
    });
  }

  const selectedTable =
    tables.find((table) => table.tableId === source.tableId) ??
    (source.tableId
      ? ({
          tableId: source.tableId,
          tableName: source.tableName || source.tableId,
          spaceId: source.spaceId,
          projectId: source.projectId || '',
          datasourceId: source.datasourceId,
          folderId: source.folderId,
          columns: source.columns
            ?.map((column) => (typeof column === 'string' ? column : column.name))
            .filter((column): column is string => Boolean(column)),
          rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
        } satisfies PersonalAnalysisTable)
      : null);

  return (
    <div className="space-y-3.5">
      <ConfigRow label={tr('schedule.cloudSpace', '空间')}>
        <div className="relative">
          <GlassSelect
            value={source.spaceId || ''}
            options={spaceOptions}
            onValueChange={(spaceId) => {
              const nextSpace = spaces.find((space) => space.spaceId === spaceId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: spaceId || undefined,
                spaceName: nextSpace?.spaceName,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingSpaces && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudProject', '项目')}>
        <div className="relative">
          <GlassSelect
            value={source.projectId || ''}
            options={projectOptions}
            onValueChange={(projectId) => {
              const nextProject = projects.find((project) => project.projectId === projectId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: source.spaceId,
                spaceName: source.spaceName,
                projectId: projectId || undefined,
                projectName: nextProject?.projectName,
                folderId: nextProject?.folderId,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud || !source.spaceId}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingProjects && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudTable', '云表')}>
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
            <GlassSelect
              value={source.tableId || ''}
              options={tableOptions}
              onValueChange={(tableId) => {
                const nextTable = tables.find((table) => table.tableId === tableId);
                onSourceChange({
                  tableId,
                  tableName: nextTable?.tableName || '',
                  spaceId: nextTable?.spaceId || source.spaceId,
                  spaceName: source.spaceName,
                  projectId: nextTable?.projectId || source.projectId,
                  projectName: source.projectName,
                  datasourceId: nextTable?.datasourceId,
                  folderId: nextTable?.folderId || source.folderId,
                  rowCount: nextTable?.rowCount ?? null,
                  columns: nextTable?.columns ?? [],
                });
              }}
              disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
                placeholder={tr('schedule.cloudSourceSearchPlaceholder', '搜索云表')}
                className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              />
              {loadingTables && (
                <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
              )}
            </div>
          </div>
          {selectedTable && (
            <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
              <div className="grid gap-2 sm:grid-cols-2">
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableName', '表名')}
                  value={selectedTable.tableName}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableId', '表 ID')}
                  value={selectedTable.tableId}
                  mono
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableLocation', '位置')}
                  value={formatCloudTargetLocation(selectedTable, source)}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableRows', '行数')}
                  value={formatCloudTargetRows(selectedTable)}
                />
              </div>
            </div>
          )}
        </div>
      </ConfigRow>

      {!canBrowseCloud && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr('schedule.cloudConnectRequired', '请先连接云分析空间后再选择云端表。')}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}
    </div>
  );
}

function CloudReplaceTargetSelector({
  config,
  connection,
  onTargetChange,
  tr,
}: {
  config: CloudTableAutomationConfig;
  connection: CloudConnectionPayload;
  onTargetChange: (tableId: string) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [keyword, setKeyword] = useState('');
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const source = config.source;
  const sourceTable = useMemo<PersonalAnalysisTable>(
    () => ({
      tableId: source.tableId,
      tableName: source.tableName,
      spaceId: source.spaceId,
      projectId: source.projectId || '',
      datasourceId: source.datasourceId,
      folderId: source.folderId,
      columns: source.columns
        ?.map((column) => (typeof column === 'string' ? column : column.name))
        .filter((column): column is string => Boolean(column)),
      rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
    }),
    [source]
  );
  const canBrowseProjectTables = Boolean(
    connection.apiOrigin &&
    source.spaceId &&
    source.projectId &&
    isElectron &&
    window.electronAPI?.data
  );
  const selectedTargetId = config.output.targetTableId || source.tableId;

  useEffect(() => {
    if (!canBrowseProjectTables || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoading(false);
      setError(null);
      requestSeq.current += 1;
      return;
    }

    const requestId = ++requestSeq.current;
    setLoading(true);
    setError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== requestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== requestSeq.current) return;
        setTables([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTargetLoadFailed', '加载同项目云表失败')
        );
      })
      .finally(() => {
        if (requestId === requestSeq.current) {
          setLoading(false);
        }
      });
  }, [canBrowseProjectTables, connection, keyword, source.projectId, source.spaceId, tr]);

  const targetTables = useMemo(() => {
    const byId = new Map<string, PersonalAnalysisTable>();
    byId.set(sourceTable.tableId, sourceTable);
    for (const table of tables) {
      byId.set(table.tableId, table);
    }
    return Array.from(byId.values());
  }, [sourceTable, tables]);
  const selectedTable =
    targetTables.find((table) => table.tableId === selectedTargetId) ??
    (selectedTargetId === source.tableId ? sourceTable : null);
  const isReplacingSource = selectedTargetId === source.tableId;
  const options = [
    {
      value: source.tableId,
      label: tr('schedule.cloudReplaceSourceOption', '覆盖源表：{{name}}').replace(
        '{{name}}',
        source.tableName
      ),
    },
    ...targetTables
      .filter((table) => table.tableId !== source.tableId)
      .map((table) => ({
        value: table.tableId,
        label: `${table.tableName} (${table.tableId})`,
      })),
  ];
  if (selectedTargetId && !options.some((option) => option.value === selectedTargetId)) {
    options.push({
      value: selectedTargetId,
      label: tr('schedule.cloudSelectedTargetFallback', '已选目标表：{{id}}').replace(
        '{{id}}',
        selectedTargetId
      ),
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
        <GlassSelect
          value={selectedTargetId}
          options={options}
          onValueChange={onTargetChange}
          triggerClassName="h-9 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            disabled={!canBrowseProjectTables}
            placeholder={tr('schedule.cloudTargetSearchPlaceholder', '搜索同项目云表')}
            className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </div>

      {!canBrowseProjectTables && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr(
            'schedule.cloudTargetBrowseUnavailable',
            '当前连接或源表项目信息不足，暂时只能默认覆盖源表。'
          )}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}

      {selectedTable && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
          <div
            className={`mb-2 flex items-center gap-2 font-semibold ${
              isReplacingSource ? 'text-error' : 'text-warning'
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {isReplacingSource
              ? tr('schedule.cloudReplaceSourceWarningTitle', '将覆盖原始输入云表')
              : tr('schedule.cloudReplaceTargetWarningTitle', '将覆盖所选云表')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableName', '表名')}
              value={selectedTable.tableName}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableLocation', '位置')}
              value={formatCloudTargetLocation(selectedTable, source)}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableId', '表 ID')}
              value={selectedTable.tableId}
              mono
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableRows', '行数')}
              value={formatCloudTargetRows(selectedTable)}
            />
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            {isReplacingSource
              ? tr(
                  'schedule.cloudReplaceSourceWarningDesc',
                  '运行后会用处理结果覆盖这张源表的数据，请确认这是预期操作。'
                )
              : tr(
                  'schedule.cloudReplaceTargetWarningDesc',
                  '运行后会用处理结果覆盖目标表数据，请确认目标表选择正确。'
                )}
          </div>
        </div>
      )}
    </div>
  );
}

function CloudTargetInfoItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-text-primary ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '-'}
      </div>
    </div>
  );
}

function getCloudConnectionPayload(
  appConfig: AppConfig | null,
  desktopAuthStatus: DesktopAuthStatus
): CloudConnectionPayload {
  const storedConnection = appConfig?.personalAnalysis;
  if (desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin) {
    return { apiOrigin: desktopAuthStatus.apiOrigin };
  }
  if (storedConnection?.apiOrigin && storedConnection.apiKey) {
    return { apiOrigin: storedConnection.apiOrigin, apiKey: storedConnection.apiKey };
  }
  return { apiOrigin: storedConnection?.apiOrigin || '' };
}

function formatCloudTargetLocation(
  table: PersonalAnalysisTable,
  source: CloudAutomationSourceTable
): string {
  const space =
    table.spaceId === source.spaceId ? source.spaceName || table.spaceId : table.spaceId;
  const project =
    table.projectId === source.projectId ? source.projectName || table.projectId : table.projectId;
  return [space, project].filter(Boolean).join(' / ') || '-';
}

function formatCloudTargetRows(table: PersonalAnalysisTable): string {
  return typeof table.rowCount === 'number' ? String(table.rowCount) : '-';
}

function normalizeAutomationColumns(
  columns: CloudAutomationSourceTable['columns']
): Array<{ name: string; type?: string }> {
  return (columns ?? [])
    .map((column) =>
      typeof column === 'string' ? { name: column } : { name: column.name ?? '', type: column.type }
    )
    .filter((column): column is { name: string; type?: string } => Boolean(column.name.trim()));
}

export function ActionChainSection({
  draft,
  actionDefinitions,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onDraftChange,
  onGeneratedTaskSuccess,
  tr,
}: {
  draft: AutomationDraft;
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onDraftChange: (draft: AutomationDraft) => void;
  onGeneratedTaskSuccess: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  const nodes = draft.actionGraph.nodes;
  const updateNodes = (nextNodes: AutomationActionNode[]) =>
    onDraftChange({
      ...draft,
      actionGraph: relinkLinearGraph({ version: 1, nodes: nextNodes, edges: [] }),
    });
  const availableActionTypes = new Set(actionDefinitions.map((definition) => definition.type));
  const menuActionTypes = [
    ...ACTION_MENU_TYPES.filter((type) => availableActionTypes.has(type)),
    ...(availableActionTypes.has(CLOUD_TABLE_PROCESS_ACTION_TYPE) ||
    availableActionTypes.has('conversation.run')
      ? [CLOUD_TABLE_PROCESS_ACTION_TYPE]
      : []),
  ];
  const addNode = (type: string) => {
    if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
      updateNodes([...nodes, createCloudTableProcessNode()]);
      return;
    }
    updateNodes([
      ...nodes,
      {
        id: crypto.randomUUID(),
        type,
        label: '',
        enabled: true,
        config: defaultConfigForAction(type),
      },
    ]);
  };
  const addActionButton = (
    <GlassDropdownMenu
      trigger={
        <button className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-success bg-success/5 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/10">
          <Plus size={13} />
          {tr('schedule.addAction', '添加动作')}
        </button>
      }
    >
      {menuActionTypes.map((type) => (
        <GlassMenuItem
          key={type}
          onSelect={() => addNode(type)}
          description={getActionMenuDescription(type, tr)}
        >
          {getActionTitle(type, type, tr)}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border-muted">
        <h2 className="min-w-0 text-[16px] font-semibold text-text-secondary">
          {tr('schedule.actionsTitle', '执行动作')}
        </h2>
        {addActionButton}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pt-4 pr-1">
        {nodes.map((node, index) => (
          <ActionStepCard
            key={node.id}
            node={node}
            index={index}
            dataTasks={dataTasks}
            inputTables={inputTables}
            outputTables={outputTables}
            appConfig={appConfig}
            onGeneratedTaskSuccess={onGeneratedTaskSuccess}
            onRemove={() => updateNodes(nodes.filter((item) => item.id !== node.id))}
            onChange={(next) =>
              updateNodes(nodes.map((item) => (item.id === next.id ? next : item)))
            }
            tr={tr}
          />
        ))}
      </div>
    </section>
  );
}

function ActionStepCard({
  node,
  index,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  onRemove,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  index: number;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onGeneratedTaskSuccess: () => void;
  onRemove: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const Icon = getActionIcon(node.type, node);
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/20 p-4">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-success/12 text-[13px] font-semibold text-success">
          {index + 1}
        </span>
        <Icon className="h-5 w-5 flex-shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-secondary">
          {getNodeLabel(node, tr)}
        </div>
        <MiniIcon
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </MiniIcon>
      </div>
      <ActionConfigEditor
        node={node}
        dataTasks={dataTasks}
        inputTables={inputTables}
        outputTables={outputTables}
        appConfig={appConfig}
        onGeneratedTaskSuccess={onGeneratedTaskSuccess}
        onChange={onChange}
        tr={tr}
      />
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  fill = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  fill?: boolean;
}) {
  return (
    <div
      className={`h-9 items-center gap-0.5 rounded-lg border border-border-muted bg-bg-secondary/30 p-0.5 ${
        fill ? 'flex w-full' : 'inline-flex'
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-md px-3 text-[12px] font-medium transition-colors ${
              fill ? 'min-w-0 flex-1' : ''
            } ${
              active ? 'bg-success/15 text-success' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type DataProcessMode = 'ai' | 'task';

// Unified "数据处理" action editor. AI is a configuration-time generator; runtime execution
// should settle on a generated/reused data task action.
function getStashedDataProcessConfig(
  config: Record<string, unknown>,
  key: typeof DATA_PROCESS_AI_CONFIG_KEY | typeof DATA_PROCESS_TASK_CONFIG_KEY
): Record<string, unknown> | null {
  const value = config[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function DataProcessActionEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onGeneratedTaskSuccess: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
  const mode: DataProcessMode =
    node.type === 'data.task.run' || node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE ? 'task' : 'ai';
  const setConfig = (config: Record<string, unknown>) => onChange({ ...node, config });
  const selectedTaskId = String(node.config.taskId ?? '');
  const generatedTaskName =
    typeof node.config.taskName === 'string' && node.config.taskName.trim()
      ? node.config.taskName
      : selectedTaskId;
  const taskOptions =
    selectedTaskId && !dataTasks.some((task) => task.id === selectedTaskId)
      ? [{ id: selectedTaskId, name: generatedTaskName }, ...dataTasks]
      : dataTasks;
  const switchMode = (next: DataProcessMode) => {
    if (next === mode) return;
    if (next === 'task') {
      const stashedTaskConfig =
        getStashedDataProcessConfig(node.config, DATA_PROCESS_TASK_CONFIG_KEY) ??
        defaultConfigForAction('data.task.run');
      onChange({
        ...node,
        type:
          node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE
            ? CLOUD_TABLE_PROCESS_ACTION_TYPE
            : 'data.task.run',
        label: '',
        config: {
          ...stashedTaskConfig,
          [DATA_PROCESS_AI_CONFIG_KEY]: node.config,
        },
      });
      return;
    }
    const cloudNode = createCloudTableProcessNode();
    const stashedAiConfig =
      getStashedDataProcessConfig(node.config, DATA_PROCESS_AI_CONFIG_KEY) ?? cloudNode.config;
    onChange({
      ...node,
      type: 'conversation.run',
      label: '',
      config: {
        ...stashedAiConfig,
        [DATA_PROCESS_TASK_CONFIG_KEY]: node.config,
      },
    });
  };
  return (
    <div className="space-y-4">
      <ConfigRow label={tr('schedule.dataProcessModeLabel', '处理方式')}>
        <SegmentedControl<DataProcessMode>
          value={mode}
          options={[
            { value: 'ai', label: tr('schedule.dataProcessModeAi', 'AI 生成任务') },
            { value: 'task', label: tr('schedule.dataProcessModeTask', '复用数据任务') },
          ]}
          onChange={switchMode}
        />
      </ConfigRow>
      {mode === 'ai' && cloudAutomation && (
        <CloudTableProcessActionEditor
          node={node}
          config={cloudAutomation}
          inputTables={inputTables}
          outputTables={outputTables}
          appConfig={appConfig}
          onChange={onChange}
          onGeneratedTaskSuccess={onGeneratedTaskSuccess}
          tr={tr}
        />
      )}
      {mode === 'task' && (
        <>
          <ConfigRow label={tr('schedule.dataTaskLabel', '数据任务')}>
            <LocalTableSelect
              value={selectedTaskId}
              tables={taskOptions}
              placeholder={tr('schedule.dataTaskPlaceholder', '选择数据任务')}
              searchPlaceholder={tr('schedule.dataTaskSearchPlaceholder', '搜索数据任务')}
              onChange={(value) =>
                setConfig({ ...node.config, taskId: value, outputMode: 'persisted' })
              }
            />
          </ConfigRow>
          <ConfigRow label={tr('schedule.executionMode', '执行方式')}>
            <GlassSelect
              value={String(node.config.outputMode ?? 'persisted')}
              options={[
                { value: 'persisted', label: tr('schedule.executionFormal', '正式执行') },
                { value: 'temporary', label: tr('schedule.executionTemporary', '临时执行') },
              ]}
              onValueChange={(value) => setConfig({ ...node.config, outputMode: value })}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
          {node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE && (
            <GeneratedTaskReviewCard node={node} tr={tr} />
          )}
        </>
      )}
    </div>
  );
}

function GeneratedTaskReviewCard({
  node,
  tr,
}: {
  node: AutomationActionNode;
  tr: (key: string, fallback: string) => string;
}) {
  const workflowDsl = String(node.config.workflowDsl ?? '');
  const requiredColumns = Array.isArray(node.config.requiredColumns)
    ? node.config.requiredColumns
        .map((column) =>
          column && typeof column === 'object' && 'name' in column
            ? String((column as { name?: unknown }).name ?? '')
            : ''
        )
        .filter(Boolean)
    : [];
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-3">
      <div className="mb-2 text-[12px] font-semibold text-text-secondary">
        <span>{tr('schedule.generatedTaskReview', '生成结果')}</span>
      </div>
      {requiredColumns.length > 0 && (
        <div className="mb-2 text-[12px] leading-5 text-text-muted">
          {tr('schedule.requiredColumnsValue', '所需字段：{{columns}}').replace(
            '{{columns}}',
            requiredColumns.join(', ')
          )}
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer text-[12px] font-medium text-success">
          {tr('schedule.workflowDslPreview', '查看任务逻辑')}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border-muted bg-background/60 p-2 text-[11px] leading-5 text-text-secondary">
          {workflowDsl || '-'}
        </pre>
      </details>
    </div>
  );
}

function ActionConfigEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onGeneratedTaskSuccess: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const configRef = useRef(node.config);
  useEffect(() => {
    configRef.current = node.config;
  }, [node.config]);
  const setConfig = (config: Record<string, unknown>) => {
    configRef.current = config;
    onChange({ ...node, config });
  };
  const conversationPrompt = String(node.config.prompt ?? '');
  const conversationSelectedSkillNames = useMemo(
    () =>
      Array.isArray(node.config.selectedSkillNames)
        ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
        : [],
    [node.config.selectedSkillNames]
  );
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
  return (
    <div className="space-y-4">
      {isDataProcessNode(node) && (
        <DataProcessActionEditor
          node={node}
          dataTasks={dataTasks}
          inputTables={inputTables}
          outputTables={outputTables}
          appConfig={appConfig}
          onGeneratedTaskSuccess={onGeneratedTaskSuccess}
          onChange={onChange}
          tr={tr}
        />
      )}
      {node.type === 'data.input.preview' && (
        <ConfigRow label={tr('schedule.inputDataLabel', '输入数据')}>
          <SelectLine
            value={String(node.config.inputTableId ?? '')}
            options={inputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
            onChange={(value) => setConfig({ ...node.config, inputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'data.output.preview' && (
        <ConfigRow label={tr('schedule.outputDataLabel', '输出表')}>
          <SelectLine
            value={String(node.config.outputTableId ?? '')}
            options={outputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
            onChange={(value) => setConfig({ ...node.config, outputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'conversation.run' && !cloudAutomation && (
        <AutomationPromptPermissionFields
          value={conversationPrompt}
          onChange={(prompt) => setConfig({ ...node.config, prompt })}
          selectedSkillNames={conversationSelectedSkillNames}
          onSelectedSkillNamesChange={(selectedSkillNames) =>
            setConfig({ ...node.config, selectedSkillNames })
          }
          onSkillSelectionCommit={({ value, selectedSkillNames }) =>
            setConfig({ ...node.config, prompt: value, selectedSkillNames })
          }
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          onModelSelect={({ configSetId, model }) =>
            setConfig({
              ...node.config,
              modelConfigSetId: configSetId,
              model,
            })
          }
          placeholder={tr('schedule.promptPlaceholder', '输入任务对话要执行的内容')}
          tr={tr}
        />
      )}
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-[12px] font-medium text-text-secondary sm:grid-cols-[112px_1fr] sm:items-start">
      <span className="pt-2">{label}</span>
      {children}
    </label>
  );
}

function SelectLine({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <GlassSelect
      value={value}
      options={[{ value: '', label: placeholder }, ...options]}
      onValueChange={onChange}
      placeholder={placeholder}
      triggerClassName="h-9 w-full justify-between"
      contentClassName="w-[var(--radix-select-trigger-width)]"
    />
  );
}

// A dropdown paired with a client-side name filter, mirroring the cloud table picker layout.
// Use for local input/output tables, where the full list can be large.
function LocalTableSelect({
  value,
  tables,
  placeholder,
  searchPlaceholder,
  onChange,
}: {
  value: string;
  tables: Array<{ id: string; name: string }>;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const normalized = keyword.trim().toLowerCase();
  const filtered = normalized
    ? tables.filter((table) => table.name.toLowerCase().includes(normalized))
    : tables;
  const selected = tables.find((table) => table.id === value);
  // Keep the selected table in the option list even when filtered out, so its label still shows.
  const visible =
    selected && !filtered.some((table) => table.id === value) ? [selected, ...filtered] : filtered;
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(11rem,0.5fr)]">
      <GlassSelect
        value={value}
        options={[
          { value: '', label: placeholder },
          ...visible.map((table) => ({ value: table.id, label: table.name })),
        ]}
        onValueChange={onChange}
        placeholder={placeholder}
        triggerClassName="h-9 w-full justify-between"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={searchPlaceholder}
          className="input h-9 w-full pr-3 pl-8 text-xs"
        />
      </div>
    </div>
  );
}

function MiniIcon({
  onClick,
  children,
}: {
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-tertiary"
    >
      {children}
    </span>
  );
}

function getActionTitle(
  type: string,
  fallback: string,
  tr: (key: string, fallback: string) => string
): string {
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (type === 'conversation.run') {
    return tr('schedule.actionTypes.conversationRun.title', fallback);
  }
  if (type === 'data.task.run') {
    return tr('schedule.actionTypes.dataTaskRun.title', fallback);
  }
  if (isDataActionType(type)) {
    return tr('schedule.actionTypes.data.title', fallback);
  }
  return fallback;
}

function getActionMenuDescription(
  type: string,
  tr: (key: string, fallback: string) => string
): string | undefined {
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
    return tr(
      'schedule.dataProcessActionDescription',
      '对指定数据表做结构化加工（AI 生成或复用已有数据任务）'
    );
  }
  if (type === 'conversation.run') {
    return tr(
      'schedule.actionTypes.conversationRun.description',
      '用自然语言下达开放式指令，由 AI 自主完成'
    );
  }
  return undefined;
}

function getActionIcon(type: string, node?: AutomationActionNode): LucideIcon {
  if (node && isDataProcessNode(node)) return Database;
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return Database;
  if (type === 'conversation.run') return MessagesSquare;
  if (isDataActionType(type)) return Database;
  return CalendarClock;
}

// A node belongs to the unified "数据处理" action when it either runs a saved data task
// (复用数据任务) or is a cloud-table conversation carrying a cloudAutomation config (AI 描述).
function isDataProcessNode(node: AutomationActionNode): boolean {
  if (node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return true;
  if (node.type === 'data.task.run') return true;
  return (
    node.type === 'conversation.run' &&
    Boolean(parseCloudAutomationConfig(node.config.cloudAutomation))
  );
}

function getNodeLabel(
  node: AutomationActionNode,
  tr: (key: string, fallback: string) => string
): string {
  if (isDataProcessNode(node)) {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  const fallback = getActionTitle(node.type, node.type, tr);
  if (!node.label || node.label === node.type) return fallback;
  if (node.type === 'conversation.run' && node.label === 'Conversation') return fallback;
  if (node.type === 'data.task.run' && node.label === 'Data task') return fallback;
  return node.label;
}

function isDataActionType(type: string): boolean {
  return DATA_ACTION_TYPES.includes(type) || DATA_PREVIEW_ACTION_TYPES.includes(type);
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
