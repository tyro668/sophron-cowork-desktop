import { useState } from 'react';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { DEFAULT_TIME } from './types';
import { GlassTimePicker } from '../../GlassTimePicker';
import { GlassDropdownMenu } from '../../GlassDropdownMenu';

export const WEEKDAY_ORDER: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_SHORT_FALLBACK: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};
export const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** Trigger classes for a picker that fills a flush form cell (no own frame). */
export const flushPickerTriggerClass =
  '!h-full !min-h-[35px] !w-full !rounded-none !border-0 !bg-transparent !px-[10px] !shadow-none hover:!bg-surface-hover';

export function WeekdayPicker({
  value,
  onChange,
  flush = false,
  tr,
}: {
  value: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  /** Seven flush cells filling the value cell (shared 1px grid lines). */
  flush?: boolean;
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
  if (flush) {
    return (
      <div className="grid min-h-[35px] flex-1 grid-cols-7" data-testid="weekday-picker-flush">
        {WEEKDAY_ORDER.map((day, index) => {
          const active = selected.has(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(day)}
              className={`inline-flex items-center justify-center text-[12.5px] transition-colors ${
                index > 0 ? 'border-l border-border-subtle' : ''
              } ${
                active
                  ? 'bg-accent-muted font-medium text-accent-text'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {tr(`schedule.weekdayShort${day}`, WEEKDAY_SHORT_FALLBACK[day])}
            </button>
          );
        })}
      </div>
    );
  }
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
                ? 'border-accent bg-accent text-accent-foreground shadow-soft'
                : 'border-border-muted bg-surface text-text-secondary hover:border-accent/25 hover:bg-accent-muted hover:text-accent'
            }`}
          >
            {tr(`schedule.weekdayShort${day}`, WEEKDAY_SHORT_FALLBACK[day])}
          </button>
        );
      })}
    </div>
  );
}

export function MonthlyDayPicker({
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
            className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-surface px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:border-accent/25 hover:bg-surface-hover focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {selectedTags.length > 0 ? (
                selectedTags.slice(0, 4).map((tag) => (
                  <span
                    key={tag.key}
                    className="inline-flex h-5 max-w-[5.25rem] items-center gap-1 rounded-md bg-accent-muted px-1.5 text-[11px] font-semibold text-accent"
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
                      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-accent/70 transition-colors hover:bg-accent-muted hover:text-accent"
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
                <span className="inline-flex h-5 items-center rounded-md bg-surface px-1.5 text-[11px] text-text-muted">
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
                    ? 'border-accent bg-accent-muted text-accent shadow-soft'
                    : 'border-border-muted bg-surface text-text-secondary hover:border-accent/25 hover:bg-accent-muted hover:text-accent'
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
                ? 'border-accent bg-accent-muted text-accent shadow-soft'
                : 'border-border-muted bg-surface text-text-secondary hover:border-accent/25 hover:bg-accent-muted hover:text-accent'
            }`}
          >
            {tr('schedule.monthLastDay', '每月最后一天')}
          </button>
        </div>
      </GlassDropdownMenu>
    </div>
  );
}

export function TimesEditor({
  times,
  onChange,
  flush = false,
  tr,
}: {
  times: string[];
  /** Fill the value cell: time picker fills, 删除 / 添加时间 are flush side cells. */
  flush?: boolean;
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
  if (flush) {
    return (
      <div className="flex flex-1 flex-col" data-testid="times-editor-flush">
        {safeTimes.map((time, index) => (
          <div
            key={index}
            className={`flex min-h-[35px] items-stretch ${
              index > 0 ? 'border-t border-border-subtle' : ''
            }`}
          >
            <div className="flex min-w-0 flex-1">
              <GlassTimePicker
                value={time}
                onChange={(next) => updateAt(index, next)}
                triggerClassName={flushPickerTriggerClass}
              />
            </div>
            {safeTimes.length > 1 && (
              <button
                type="button"
                onClick={() => removeAt(index)}
                title={tr('schedule.removeTime', '删除')}
                aria-label={tr('schedule.removeTime', '删除')}
                className="flex w-10 flex-shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-error"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {index === safeTimes.length - 1 ? (
              <button
                type="button"
                onClick={() => onChange([...safeTimes, DEFAULT_TIME])}
                className="ui-accent-cell w-[28.5714%] flex-shrink-0 border-l border-border-subtle"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('schedule.addTime', '添加时间')}
              </button>
            ) : (
              <span className="w-[28.5714%] flex-shrink-0 border-l border-border-subtle" />
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {safeTimes.map((time, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <GlassTimePicker value={time} onChange={(next) => updateAt(index, next)} />
          </div>
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
          {index === safeTimes.length - 1 && (
            <button
              type="button"
              onClick={() => onChange([...safeTimes, DEFAULT_TIME])}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              {tr('schedule.addTime', '添加时间')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
