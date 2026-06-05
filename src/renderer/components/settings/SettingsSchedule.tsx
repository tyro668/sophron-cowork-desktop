import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  ScheduleConfig,
  ScheduleTask,
  ScheduleRepeatUnit,
  ScheduleWeekday,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from '../../types';
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { useAppStore } from '../../store';
import { formatAppDateTime, joinAppList } from '../../utils/i18n-format';
import { renderLocalizedBannerMessage, getWeekdayOptions, getScheduleModeOptions } from './shared';
import type { LocalizedBanner, ScheduleFormMode } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const AUTOMATION_TABLE_PAGE_SIZE = 10;

const SCHEDULE_TIME_SUGGESTIONS = [
  '06:00',
  '07:30',
  '08:00',
  '09:00',
  '10:30',
  '12:00',
  '14:00',
  '15:30',
  '18:00',
  '19:30',
  '21:00',
  '22:30',
];

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const sessions = useAppStore((state) => state.sessions);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTaskSnapshot, setEditingTaskSnapshot] = useState<ScheduleTask | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [isEditingTaskTitle, setIsEditingTaskTitle] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [runAt, setRunAt] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>('once');
  const [selectedTimes, setSelectedTimes] = useState<string[]>(['08:00']);
  const [selectedWeekdays, setSelectedWeekdays] = useState<ScheduleWeekday[]>([1]);
  const [enabled, setEnabled] = useState(true);
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState<ScheduleRepeatUnit>('day');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const taskTitleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTaskTitleSaveRef = useRef(false);
  const weekdayOptions = getWeekdayOptions(t);
  const scheduleModeOptions = getScheduleModeOptions(t);
  const scheduleConfig = buildScheduleConfigFromForm(scheduleMode, selectedTimes, selectedWeekdays);
  const selectedWeekdayLabels = joinAppList(
    selectedWeekdays
      .map(
        (weekday) =>
          weekdayOptions.find((option) => option.value === weekday)?.label ??
          t('schedule.unknownWeekday')
      )
      .filter(Boolean)
  );
  const selectedTimeLabels = joinAppList(selectedTimes);
  const runningSessionIds = useMemo(
    () =>
      new Set(
        sessions.filter((session) => session.status === 'running').map((session) => session.id)
      ),
    [sessions]
  );
  const todayRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }, []);
  const filteredTasks = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return tasks;
    }
    return tasks.filter((task) =>
      [task.title, task.prompt, task.cwd]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [searchQuery, tasks]);
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / AUTOMATION_TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageTasks = useMemo(() => {
    const start = (safeCurrentPage - 1) * AUTOMATION_TABLE_PAGE_SIZE;
    return filteredTasks.slice(start, start + AUTOMATION_TABLE_PAGE_SIZE);
  }, [filteredTasks, safeCurrentPage]);
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? null;
  const summaryCards = useMemo(
    () => [
      {
        key: 'total',
        label: t('schedule.summary.total'),
        description: t('schedule.summary.totalDesc'),
        value: tasks.length,
        Icon: CalendarClock,
        iconClassName: 'bg-accent/10 text-accent',
      },
      {
        key: 'enabled',
        label: t('schedule.summary.enabled'),
        description: t('schedule.summary.enabledDesc'),
        value: tasks.filter((task) => task.enabled).length,
        Icon: CheckCircle2,
        iconClassName: 'bg-success/10 text-success',
      },
      {
        key: 'running',
        label: t('schedule.summary.running'),
        description: t('schedule.summary.runningDesc'),
        value: tasks.filter(
          (task) => task.lastRunSessionId && runningSessionIds.has(task.lastRunSessionId)
        ).length,
        Icon: Play,
        iconClassName: 'bg-[#E9F7F5] text-[#238C80]',
      },
      {
        key: 'today',
        label: t('schedule.summary.today'),
        description: t('schedule.summary.todayDesc'),
        value: tasks.filter(
          (task) =>
            task.nextRunAt !== null &&
            task.nextRunAt >= todayRange.start &&
            task.nextRunAt < todayRange.end
        ).length,
        Icon: Clock3,
        iconClassName: 'bg-warning/10 text-warning',
      },
    ],
    [runningSessionIds, t, tasks, todayRange.end, todayRange.start]
  );

  useEffect(() => {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setRunAt(toLocalDateTimeInput(defaultRunAt));
  }, []);

  useEffect(() => {
    if (!cwd) {
      setCwd(workingDir || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDir]);

  const loadTasks = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isElectron) return;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const rows = await window.electronAPI.schedule.list();
      setTasks(rows);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? { text: err.message } : { key: 'schedule.loadFailed' });
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadTasks();
  }, [isActive, loadTasks]);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    const interval = setInterval(() => {
      void loadTasks({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, loadTasks]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (safeCurrentPage !== currentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  useEffect(() => {
    if (selectedTaskId && !filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [filteredTasks, selectedTaskId]);

  useEffect(() => {
    if (!isEditingTaskTitle) return;
    taskTitleInputRef.current?.focus();
    taskTitleInputRef.current?.select();
  }, [isEditingTaskTitle]);

  async function saveTaskTitle() {
    if (skipTaskTitleSaveRef.current) {
      skipTaskTitleSaveRef.current = false;
      return;
    }
    if (!isElectron || !editingId || !editingTaskSnapshot || !isEditingTaskTitle) return;
    const nextTitle = taskTitle.trim();
    if (!nextTitle) {
      setError({ key: 'schedule.titleRequired' });
      setTaskTitle(stripAutomationTitlePrefix(editingTaskSnapshot.title));
      setIsEditingTaskTitle(false);
      return;
    }
    if (nextTitle === stripAutomationTitlePrefix(editingTaskSnapshot.title)) {
      setTaskTitle(nextTitle);
      setIsEditingTaskTitle(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await window.electronAPI.schedule.update(editingId, { title: nextTitle });
      if (!updated) {
        throw new Error(t('schedule.taskMissing'));
      }
      applyTaskUpdate(updated);
      setTaskTitle(stripAutomationTitlePrefix(updated.title));
      setIsEditingTaskTitle(false);
      setSuccess({ key: 'schedule.updated' });
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.saveFailed' });
    } finally {
      setIsLoading(false);
    }
  }

  function applyTaskUpdate(task: ScheduleTask) {
    setEditingTaskSnapshot(task);
    setPrompt(task.prompt);
    setCwd(task.cwd);
    setRunAt(toLocalDateTimeInput(task.nextRunAt ?? task.runAt));
    setEnabled(task.enabled);
    setScheduleMode(detectScheduleMode(task));
    setSelectedTimes(task.scheduleConfig?.times ?? ['08:00']);
    setSelectedWeekdays(
      task.scheduleConfig?.kind === 'weekly' ? task.scheduleConfig.weekdays : [1]
    );
    setRepeatEvery(task.repeatEvery ?? 1);
    setRepeatUnit(task.repeatUnit ?? 'day');
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    setSelectedTaskId(task.id);
  }

  async function startCreateTask() {
    if (!isElectron) return;
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await window.electronAPI.schedule.create({
        title: t('schedule.draftTitle'),
        prompt: '',
        cwd: workingDir || '',
        runAt: defaultRunAt,
        nextRunAt: defaultRunAt,
        scheduleConfig: null,
        repeatEvery: null,
        repeatUnit: null,
        enabled: false,
      });
      setTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
      setSearchQuery('');
      setCurrentPage(1);
      editTask(created);
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.saveFailed' });
      await loadTasks({ silent: true });
    } finally {
      setIsLoading(false);
    }
  }

  async function submitTask(
    options: { silentSuccess?: boolean } = {}
  ): Promise<ScheduleTask | null> {
    if (!isElectron) return null;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError({ key: 'schedule.promptRequired' });
      return null;
    }
    if (scheduleMode === 'daily' && (!scheduleConfig || scheduleConfig.times.length === 0)) {
      setError({ key: 'schedule.dailyTimesRequired' });
      return null;
    }
    if (scheduleMode === 'weekly') {
      if (
        !scheduleConfig ||
        scheduleConfig.kind !== 'weekly' ||
        scheduleConfig.times.length === 0
      ) {
        setError({ key: 'schedule.weeklyTimesRequired' });
        return null;
      }
      if (scheduleConfig.weekdays.length === 0) {
        setError({ key: 'schedule.weekdayRequired' });
        return null;
      }
    }
    const usesDateTimeInput = scheduleMode === 'once' || scheduleMode === 'legacy-interval';
    const runAtValue: number | null = usesDateTimeInput
      ? new Date(runAt).getTime()
      : computeNextScheduledRun(scheduleConfig, Date.now());
    if (runAtValue === null || !Number.isFinite(runAtValue)) {
      setError({
        key: usesDateTimeInput ? 'schedule.invalidTime' : 'schedule.nextRunCalculationFailed',
      });
      return null;
    }
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        const originalRunAtInput = editingTaskSnapshot
          ? toLocalDateTimeInput(editingTaskSnapshot.nextRunAt ?? editingTaskSnapshot.runAt)
          : null;
        const nextScheduleSignature = buildScheduleSignatureFromForm(
          scheduleMode,
          runAt,
          selectedTimes,
          selectedWeekdays,
          repeatEvery,
          repeatUnit
        );
        const originalScheduleSignature = editingTaskSnapshot
          ? buildScheduleSignatureFromTask(editingTaskSnapshot)
          : null;
        const shouldUpdatePrompt =
          !editingTaskSnapshot || trimmedPrompt !== editingTaskSnapshot.prompt.trim();
        const shouldResetScheduleTime =
          !editingTaskSnapshot ||
          nextScheduleSignature !== originalScheduleSignature ||
          runAt !== originalRunAtInput ||
          (enabled && editingTaskSnapshot.nextRunAt === null);
        if (shouldResetScheduleTime && runAtValue <= Date.now()) {
          setError({ key: 'schedule.futureTimeRequired' });
          return null;
        }
        const payload: ScheduleUpdateInput = {
          title:
            taskTitle.trim() ||
            stripAutomationTitlePrefix(editingTaskSnapshot?.title ?? t('schedule.draftTitle')),
          cwd: cwd.trim() || workingDir || '',
          enabled,
          scheduleConfig,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        if (shouldUpdatePrompt) {
          payload.prompt = trimmedPrompt;
        }
        if (shouldResetScheduleTime) {
          payload.runAt = runAtValue;
          payload.nextRunAt = runAtValue;
        }
        const updated = await window.electronAPI.schedule.update(editingId, payload);
        if (!updated) {
          throw new Error(t('schedule.taskMissing'));
        }
        applyTaskUpdate(updated);
        setTaskTitle(stripAutomationTitlePrefix(updated.title));
        if (!options.silentSuccess) {
          setSuccess({ key: 'schedule.updated' });
        }
        await loadTasks({ silent: true });
        return updated;
      } else {
        if (runAtValue <= Date.now()) {
          setError({ key: 'schedule.futureTimeRequired' });
          return null;
        }
        const payload: ScheduleCreateInput = {
          title: taskTitle.trim() || t('schedule.draftTitle'),
          prompt: trimmedPrompt,
          cwd: cwd.trim() || workingDir || '',
          runAt: runAtValue,
          nextRunAt: runAtValue,
          scheduleConfig,
          enabled,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        const created = await window.electronAPI.schedule.create(payload);
        if (!options.silentSuccess) {
          setSuccess({ key: 'schedule.created' });
        }
        clearForm();
        await loadTasks({ silent: true });
        return created;
      }
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.saveFailed' });
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function runNow(task: ScheduleTask) {
    if (!isElectron) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await window.electronAPI.schedule.runNow(task.id);
      if (!updated) {
        throw new Error(t('schedule.taskMissing'));
      }
      setSuccess({ key: 'schedule.runNowSuccess' });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.runNowFailed' });
    } finally {
      setIsLoading(false);
    }
  }

  async function runEditingTask() {
    const saved = await submitTask({ silentSuccess: true });
    if (!saved) return;
    await runNow(saved);
  }

  async function deleteTask(task: ScheduleTask) {
    if (!isElectron) return;
    if (!window.confirm(t('schedule.deleteConfirm', { title: task.title }))) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await window.electronAPI.schedule.delete(task.id);
      if (editingId === task.id) {
        clearForm();
      }
      if (selectedTaskId === task.id) {
        setSelectedTaskId(null);
      }
      setSuccess({ key: 'schedule.deleted' });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.deleteFailed' });
      setIsLoading(false);
    }
  }

  function editTask(task: ScheduleTask) {
    setSelectedTaskId(task.id);
    setEditingId(task.id);
    setEditingTaskSnapshot(task);
    setTaskTitle(stripAutomationTitlePrefix(task.title));
    setIsEditingTaskTitle(false);
    setPrompt(task.prompt);
    setCwd(task.cwd);
    setRunAt(toLocalDateTimeInput(task.nextRunAt ?? task.runAt));
    setEnabled(task.enabled);
    setScheduleMode(detectScheduleMode(task));
    setSelectedTimes(task.scheduleConfig?.times ?? ['08:00']);
    setSelectedWeekdays(
      task.scheduleConfig?.kind === 'weekly' ? task.scheduleConfig.weekdays : [1]
    );
    setRepeatEvery(task.repeatEvery ?? 1);
    setRepeatUnit(task.repeatUnit ?? 'day');
    setError(null);
    setSuccess(null);
  }

  function clearForm() {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setEditingId(null);
    setEditingTaskSnapshot(null);
    setTaskTitle('');
    setIsEditingTaskTitle(false);
    setPrompt('');
    setCwd(workingDir || '');
    setRunAt(toLocalDateTimeInput(defaultRunAt));
    setScheduleMode('once');
    setSelectedTimes(['08:00']);
    setSelectedWeekdays([1]);
    setEnabled(true);
    setRepeatEvery(1);
    setRepeatUnit('day');
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="flex-shrink-0 space-y-3">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{renderLocalizedBannerMessage(error, t)}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3.5 py-2.5 text-[13px] text-success">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span>{renderLocalizedBannerMessage(success, t)}</span>
          </div>
        )}

        {!editingId && (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ key, label, description, value, Icon, iconClassName }) => (
              <AutomationStatCard
                key={key}
                label={label}
                description={description}
                value={value}
                Icon={Icon}
                iconClassName={iconClassName}
              />
            ))}
          </section>
        )}
      </div>

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        {editingId ? (
          <>
            <div className="mb-3 flex flex-shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <button
                  type="button"
                  onClick={clearForm}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('schedule.backToList')}
                </button>
                <div className="flex min-w-0 items-center gap-2">
                  {isEditingTaskTitle ? (
                    <span className="flex h-8 min-w-0 max-w-[24rem] items-center rounded-lg border border-accent/40 bg-background/48 px-2.5 shadow-soft ring-2 ring-accent/15">
                      <input
                        ref={taskTitleInputRef}
                        value={taskTitle}
                        maxLength={80}
                        onChange={(event) => setTaskTitle(event.target.value)}
                        onBlur={() => void saveTaskTitle()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                          if (event.key === 'Escape') {
                            skipTaskTitleSaveRef.current = true;
                            setTaskTitle(
                              stripAutomationTitlePrefix(editingTaskSnapshot?.title ?? '')
                            );
                            setIsEditingTaskTitle(false);
                          }
                        }}
                        className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
                      />
                    </span>
                  ) : (
                    <h3 className="truncate text-[15px] font-medium text-text-secondary">
                      {taskTitle || t('schedule.configTitle')}
                    </h3>
                  )}
                  {!isEditingTaskTitle && (
                    <button
                      type="button"
                      onClick={() => setIsEditingTaskTitle(true)}
                      disabled={isLoading}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                      title={t('common.edit')}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      <span className="sr-only">{t('common.edit')}</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submitTask()}
                  disabled={isLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Save className="h-3.5 w-3.5" />
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => void runEditingTask()}
                  disabled={isLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('schedule.runNow')}
                </button>
              </div>
            </div>

            <div className="glass-card flex min-h-0 flex-1 flex-col rounded-xl p-3">
              <div className="mb-3 flex items-center justify-end">
                <label className="inline-flex h-8 flex-shrink-0 items-center gap-2 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {t('schedule.enabled')}
                </label>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-text-muted">
                      {t('schedule.promptLabel')}
                    </div>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={t('schedule.promptPlaceholder')}
                      rows={4}
                      className="min-h-[110px] w-full rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-text-muted">
                      {t('schedule.cwdLabel')}
                    </div>
                    <input
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder={t('schedule.cwdPlaceholder')}
                      className="h-9 w-full rounded-lg border border-border-muted bg-background/42 px-3 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    />
                  </div>
                </div>

                <div className="space-y-2.5 rounded-lg bg-background/42 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-medium text-text-primary">
                      {t('schedule.executionTime')}
                    </div>
                  </div>
                  <div
                    className={`grid gap-2 ${
                      scheduleMode === 'weekly' ? 'md:grid-cols-3' : 'md:grid-cols-2'
                    }`}
                  >
                    <ScheduleSelectMenu
                      label={t('schedule.mode')}
                      options={scheduleModeOptions}
                      value={scheduleMode}
                      onChange={(value) => setScheduleMode(value as ScheduleFormMode)}
                    />
                    {scheduleMode === 'weekly' && (
                      <ScheduleSelectMenu
                        label={t('schedule.weekday')}
                        options={weekdayOptions}
                        values={selectedWeekdays}
                        placeholder={t('schedule.weekdayPlaceholder')}
                        summary={selectedWeekdayLabels}
                        onToggle={(value) => {
                          setSelectedWeekdays((current) =>
                            toggleWeekdayValue(current, value as ScheduleWeekday)
                          );
                        }}
                      />
                    )}
                    {(scheduleMode === 'daily' || scheduleMode === 'weekly') && (
                      <TimeMultiSelectMenu
                        label={t('schedule.times')}
                        values={selectedTimes}
                        placeholder={t('schedule.timePlaceholder')}
                        summary={selectedTimeLabels}
                        onAdd={(value) =>
                          setSelectedTimes((current) => toggleTimeValue(current, value))
                        }
                        onRemove={(value) =>
                          setSelectedTimes((current) => toggleTimeValue(current, value))
                        }
                      />
                    )}
                  </div>
                  {(scheduleMode === 'once' || scheduleMode === 'legacy-interval') && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-text-muted">
                        {scheduleMode === 'once'
                          ? t('schedule.onceTimeLabel')
                          : t('schedule.legacyStartTimeLabel')}
                      </div>
                      <input
                        type="datetime-local"
                        value={runAt}
                        onChange={(event) => setRunAt(event.target.value)}
                        className="h-9 w-full rounded-lg border border-border-muted bg-surface px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </div>
                  )}
                  {scheduleMode === 'legacy-interval' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={1}
                        value={repeatEvery}
                        onChange={(event) =>
                          setRepeatEvery(Math.max(1, Number(event.target.value) || 1))
                        }
                        className="h-9 w-full rounded-lg border border-border-muted bg-surface px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                      <GlassSelect
                        value={repeatUnit}
                        onValueChange={(value) => setRepeatUnit(value as ScheduleRepeatUnit)}
                        options={[
                          { value: 'minute', label: t('schedule.repeatUnitMinute') },
                          { value: 'hour', label: t('schedule.repeatUnitHour') },
                          { value: 'day', label: t('schedule.repeatUnitDay') },
                        ]}
                        triggerClassName="h-9 w-full justify-between rounded-lg bg-surface px-3 text-[13px]"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startCreateTask()}
                  disabled={isLoading}
                  className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('schedule.newAutomation')}
                </button>
                <AutomationTableSearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={t('schedule.searchPlaceholder')}
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AutomationToolbarButton
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label={t('schedule.refresh')}
                  disabled={isLoading}
                  onClick={() => void loadTasks()}
                />
                <AutomationToolbarButton
                  icon={<Play className="h-3.5 w-3.5" />}
                  label={t('schedule.runNow')}
                  disabled={!selectedTask || isLoading}
                  onClick={() => {
                    if (selectedTask) {
                      void runNow(selectedTask);
                    }
                  }}
                />
                <AutomationToolbarButton
                  icon={<PencilLine className="h-3.5 w-3.5" />}
                  label={t('schedule.edit')}
                  disabled={!selectedTask || isLoading}
                  onClick={() => {
                    if (selectedTask) {
                      editTask(selectedTask);
                    }
                  }}
                />
                <AutomationToolbarButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label={t('schedule.delete')}
                  disabled={!selectedTask || isLoading}
                  danger
                  onClick={() => {
                    if (selectedTask) {
                      void deleteTask(selectedTask);
                    }
                  }}
                />
              </div>
            </div>

            <div className="glass-table flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                <AutomationTasksTable
                  tasks={pageTasks}
                  isLoading={isLoading}
                  selectedTaskId={selectedTaskId}
                  runningSessionIds={runningSessionIds}
                  weekdayOptions={weekdayOptions}
                  onSelectTask={setSelectedTaskId}
                  onEdit={editTask}
                />
              </div>
              <AutomationPaginationFooter
                count={filteredTasks.length}
                currentPage={safeCurrentPage}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ==================== Automation Page UI ====================

function AutomationStatCard({
  label,
  description,
  value,
  Icon,
  iconClassName,
}: {
  label: string;
  description: string;
  value: number;
  Icon: LucideIcon;
  iconClassName: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-none text-text-primary">{value}</div>
          <div className="mt-1 text-[13px] font-medium text-text-primary">{label}</div>
          <div className="mt-1 text-xs text-text-muted">{description}</div>
        </div>
      </div>
    </div>
  );
}

function AutomationTableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full min-w-[220px] max-w-sm flex-1 sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-normal text-text-primary placeholder:text-text-muted shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
      />
    </div>
  );
}

function AutomationToolbarButton({
  icon,
  label,
  disabled,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'border-error/20 bg-error/5 text-error hover:bg-error/10'
          : 'border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function AutomationTasksTable({
  tasks,
  isLoading,
  selectedTaskId,
  runningSessionIds,
  weekdayOptions,
  onSelectTask,
  onEdit,
}: {
  tasks: ScheduleTask[];
  isLoading: boolean;
  selectedTaskId: string | null;
  runningSessionIds: Set<string>;
  weekdayOptions: Array<{ value: ScheduleWeekday; label: string }>;
  onSelectTask: (taskId: string) => void;
  onEdit: (task: ScheduleTask) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return <AutomationLoadingState label={t('schedule.loadingTasks')} />;
  }

  if (tasks.length === 0) {
    return <AutomationEmptyState label={t('schedule.empty')} />;
  }

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <table className="w-full min-w-0 table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
            <th className="w-[4%] px-4">
              <span className="sr-only">{t('schedule.selection')}</span>
            </th>
            <th className="w-[34%] whitespace-nowrap px-2">{t('schedule.columns.name')}</th>
            <th className="w-[13%] whitespace-nowrap px-2">{t('schedule.columns.status')}</th>
            <th className="w-[19%] whitespace-nowrap px-2">{t('schedule.columns.nextRun')}</th>
            <th className="w-[18%] whitespace-nowrap px-2">{t('schedule.columns.strategy')}</th>
            <th className="w-[12%] whitespace-nowrap px-2">{t('schedule.columns.updatedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const selected = task.id === selectedTaskId;
            const statusMeta = getAutomationStatusMeta(task, runningSessionIds, t);
            return (
              <tr
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                onDoubleClick={() => onEdit(task)}
                className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                  selected
                    ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                    : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-4">
                  <input
                    type="radio"
                    name="automation-selection"
                    checked={selected}
                    onChange={() => onSelectTask(task.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={task.title}
                  />
                </td>
                <td className="px-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-text-secondary">
                        {task.title}
                      </div>
                      <div className="truncate text-xs text-text-muted">{task.prompt}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2">
                  <AutomationStatusBadge
                    label={statusMeta.label}
                    className={statusMeta.className}
                  />
                </td>
                <td className="px-2 text-[13px] font-medium text-text-secondary">
                  <div className="truncate">
                    {task.nextRunAt === null
                      ? t('schedule.nextRunNoneValue')
                      : formatTime(task.nextRunAt)}
                  </div>
                </td>
                <td className="px-2">
                  <div className="truncate text-[13px] font-medium text-text-secondary">
                    {formatScheduleRule(task, t, weekdayOptions)}
                  </div>
                </td>
                <td className="px-2 text-[13px] font-medium text-text-secondary">
                  <div className="truncate">{formatTime(task.updatedAt)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AutomationStatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function AutomationPaginationFooter({
  count,
  currentPage,
  onPageChange,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(count / AUTOMATION_TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), pageCount);

  return (
    <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4 text-[13px] text-text-secondary">
      <span>{t('data.totalCount', { count })}</span>
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary">
          {t('data.rowsPerPage', { count: AUTOMATION_TABLE_PAGE_SIZE })}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 px-2 text-xs font-medium text-accent">
          {safePage}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function AutomationLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center text-[13px] text-text-muted">
      {label}
    </div>
  );
}

function AutomationEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center text-[13px] text-text-muted">
      {label}
    </div>
  );
}

function getAutomationStatusMeta(
  task: ScheduleTask,
  runningSessionIds: Set<string>,
  t: TFunction
): { label: string; className: string } {
  if (task.lastRunSessionId && runningSessionIds.has(task.lastRunSessionId)) {
    return { label: t('schedule.statusRunning'), className: 'bg-[#E9F7F5] text-[#238C80]' };
  }
  if (task.lastError) {
    return { label: t('schedule.statusFailed'), className: 'bg-error/10 text-error' };
  }
  if (task.enabled) {
    return { label: t('schedule.taskEnabled'), className: 'bg-success/10 text-success' };
  }
  return { label: t('schedule.taskDisabled'), className: 'bg-surface-hover text-text-muted' };
}

// ==================== Schedule Helpers ====================

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatTime(timestamp: number): string {
  return formatAppDateTime(timestamp);
}

function stripAutomationTitlePrefix(value: string): string {
  return value.replace(/^\s*\[自动化\]\s*/, '').trim();
}

function formatScheduleRule(
  task: ScheduleTask,
  t: TFunction,
  weekdayOptions: Array<{ value: ScheduleWeekday; label: string }>
): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return t('schedule.ruleDaily', { times: joinAppList(task.scheduleConfig.times) });
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    const weekdays = task.scheduleConfig.weekdays.map(
      (weekday) =>
        weekdayOptions.find((option) => option.value === weekday)?.label ??
        t('schedule.unknownWeekday')
    );
    return t('schedule.ruleWeekly', {
      weekdays: joinAppList(weekdays),
      times: joinAppList(task.scheduleConfig.times),
    });
  }
  if (!task.repeatEvery || !task.repeatUnit) {
    return t('schedule.ruleOnce');
  }
  if (task.repeatUnit === 'minute') {
    return t('schedule.repeatEveryMinute', { count: task.repeatEvery });
  }
  if (task.repeatUnit === 'hour') {
    return t('schedule.repeatEveryHour', { count: task.repeatEvery });
  }
  return t('schedule.repeatEveryDay', { count: task.repeatEvery });
}

function detectScheduleMode(task: ScheduleTask): ScheduleFormMode {
  if (task.scheduleConfig?.kind === 'daily') {
    return 'daily';
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return 'weekly';
  }
  if (task.repeatEvery && task.repeatUnit) {
    return 'legacy-interval';
  }
  return 'once';
}

function buildScheduleConfigFromForm(
  mode: ScheduleFormMode,
  times: string[],
  weekdays: ScheduleWeekday[]
): ScheduleConfig | null {
  const normalizedTimes = Array.from(new Set(times)).sort();
  if (mode === 'daily' && normalizedTimes.length > 0) {
    return { kind: 'daily', times: normalizedTimes };
  }
  if (mode === 'weekly' && normalizedTimes.length > 0 && weekdays.length > 0) {
    return {
      kind: 'weekly',
      weekdays: Array.from(new Set(weekdays)).sort((left, right) => left - right),
      times: normalizedTimes,
    };
  }
  return null;
}

function buildScheduleSignatureFromTask(task: ScheduleTask): string {
  if (task.scheduleConfig) {
    return JSON.stringify(task.scheduleConfig);
  }
  if (task.repeatEvery && task.repeatUnit) {
    return JSON.stringify({
      mode: 'legacy-interval',
      runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
    });
  }
  return JSON.stringify({
    mode: 'once',
    runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
  });
}

function buildScheduleSignatureFromForm(
  mode: ScheduleFormMode,
  runAt: string,
  times: string[],
  weekdays: ScheduleWeekday[],
  repeatEvery: number,
  repeatUnit: ScheduleRepeatUnit
): string {
  if (mode === 'daily' || mode === 'weekly') {
    return JSON.stringify(buildScheduleConfigFromForm(mode, times, weekdays));
  }
  if (mode === 'legacy-interval') {
    return JSON.stringify({ mode, runAt, repeatEvery, repeatUnit });
  }
  return JSON.stringify({ mode, runAt });
}

function computeNextScheduledRun(
  scheduleConfig: ScheduleConfig | null,
  now: number
): number | null {
  if (!scheduleConfig || scheduleConfig.times.length === 0) {
    return null;
  }
  const allowedWeekdays =
    scheduleConfig.kind === 'weekly' ? new Set(scheduleConfig.weekdays) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduleWeekday)) {
      continue;
    }
    for (const time of scheduleConfig.times) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}

function toggleTimeValue(current: string[], target: string): string[] {
  if (!isValidTimeValue(target)) {
    return current;
  }
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort();
}

function toggleWeekdayValue(
  current: ScheduleWeekday[],
  target: ScheduleWeekday
): ScheduleWeekday[] {
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort((left, right) => left - right);
}

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

// ==================== Schedule UI Sub-components ====================

function ScheduleSelectMenu(props: {
  label: string;
  options: Array<{ value: string | number; label: string }>;
  value?: string | number;
  values?: Array<string | number>;
  placeholder?: string;
  summary?: string;
  onChange?: (value: string | number) => void;
  onToggle?: (value: string | number) => void;
}) {
  const { t } = useTranslation();
  const {
    label,
    options,
    value,
    values = [],
    placeholder = t('schedule.timePlaceholder'),
    summary,
    onChange,
    onToggle,
  } = props;
  const [open, setOpen] = useState(false);
  const isMulti = typeof onToggle === 'function';
  const buttonText =
    summary ||
    (isMulti
      ? values.length > 0
        ? joinAppList(
            values
              .map((item) => options.find((option) => option.value === item)?.label ?? String(item))
              .filter(Boolean)
          )
        : placeholder
      : (options.find((option) => option.value === value)?.label ?? placeholder));

  return (
    <div>
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <GlassDropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        contentClassName="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        trigger={
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              open
                ? 'border-accent bg-surface text-text-primary'
                : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
            }`}
          >
            <span className="truncate">{buttonText}</span>
            <ChevronDown
              className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        }
      >
        {options.map((option) => {
          const selected = isMulti ? values.includes(option.value) : option.value === value;
          return (
            <GlassMenuItem
              key={String(option.value)}
              selected={selected}
              closeOnSelect={!isMulti}
              onSelect={() => {
                if (isMulti) {
                  onToggle?.(option.value);
                  return;
                }
                onChange?.(option.value);
              }}
            >
              {option.label}
            </GlassMenuItem>
          );
        })}
      </GlassDropdownMenu>
    </div>
  );
}

function TimeMultiSelectMenu(props: {
  label: string;
  values: string[];
  placeholder?: string;
  summary?: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const { t } = useTranslation();
  const {
    label,
    values,
    placeholder = t('schedule.timePlaceholder'),
    summary,
    onAdd,
    onRemove,
  } = props;
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [draftTime, setDraftTime] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonText = summary || (values.length > 0 ? joinAppList(values) : placeholder);

  useDismissibleLayer({
    open,
    refs: [containerRef],
    onDismiss: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePlacement() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const estimatedPanelHeight = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < estimatedPanelHeight && spaceAbove > spaceBelow);
    }

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  function addDraftTime() {
    if (!isValidTimeValue(draftTime)) {
      return;
    }
    onAdd(draftTime);
    setDraftTime('');
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? 'border-accent bg-surface text-text-primary'
            : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-20 w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] p-3 shadow-elevated backdrop-blur-xl ${
            openUpward ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
          }`}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {t('schedule.pickerEditTimes')}
                  </div>
                  <div className="text-xs text-text-muted">{t('schedule.pickerAnyHHmm')}</div>
                </div>
                {values.length > 0 && (
                  <div className="text-xs text-text-muted">
                    {t('schedule.pickerSelectedCount', { count: values.length })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={60}
                  value={draftTime}
                  onChange={(event) => setDraftTime(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background/42 px-3 py-2 text-sm text-text-primary"
                />
                <button
                  type="button"
                  onClick={addDraftTime}
                  disabled={!isValidTimeValue(draftTime)}
                  className="inline-flex min-w-[92px] flex-shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('schedule.pickerAdd')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">{t('schedule.pickerSelectedTimes')}</div>
              {values.length > 0 ? (
                <div className="flex flex-wrap gap-2 rounded-lg bg-background/42 p-2">
                  {values.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => onRemove(time)}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface px-3 py-1 text-sm text-accent shadow-sm"
                    >
                      <span>{time}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-background/42 px-3 py-2 text-xs text-text-muted">
                  {t('schedule.pickerNone')}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">{t('schedule.pickerSuggestions')}</div>
              <div className="flex flex-wrap gap-2">
                {SCHEDULE_TIME_SUGGESTIONS.map((time) => {
                  const selected = values.includes(time);
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        if (selected) {
                          onRemove(time);
                          return;
                        }
                        onAdd(time);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-background text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
