import { useEffect, useMemo, useState } from 'react';
import { DayPicker } from '@daypicker/react';
import { enUS, zhCN } from '@daypicker/react/locale';
import { CalendarClock, Check, ChevronDown, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassDropdownMenu, glassTriggerButtonClass } from './GlassDropdownMenu';
import { GlassTimePickerColumns } from './GlassTimePicker';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getTimeValue(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function applyDatePart(currentTimestamp: number, selectedDate: Date): number {
  const current = new Date(currentTimestamp);
  const next = new Date(selectedDate);
  next.setHours(current.getHours(), current.getMinutes(), 0, 0);
  return next.getTime();
}

function applyTimePart(currentTimestamp: number, timeValue: string): number {
  const [hour, minute] = timeValue.split(':').map(Number);
  const next = new Date(currentTimestamp);
  next.setHours(
    Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 0,
    Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
    0,
    0
  );
  return next.getTime();
}

interface GlassDateTimePickerProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}

export function GlassDateTimePicker({
  value,
  onChange,
  disabled = false,
  className,
  triggerClassName,
}: GlassDateTimePickerProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const selectedDate = useMemo(() => new Date(value), [value]);
  const [displayMonth, setDisplayMonth] = useState(selectedDate);
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = selectedDate.getMonth();
  const isChinese = i18n.language?.toLowerCase().startsWith('zh');
  const dateLocale = isChinese ? zhCN : enUS;
  const displayLocale = isChinese ? 'zh-CN' : 'en-US';
  const displayValue = useMemo(
    () =>
      new Intl.DateTimeFormat(displayLocale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(selectedDate),
    [displayLocale, selectedDate]
  );

  const handleToday = () => {
    onChange(Date.now());
  };

  useEffect(() => {
    if (open) {
      setDisplayMonth(new Date(selectedYear, selectedMonth, 1));
    } else {
      setTimeOpen(false);
    }
  }, [open, selectedMonth, selectedYear]);

  return (
    <GlassDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      sideOffset={4}
      contentClassName={`w-[19.5rem] !overflow-visible p-3 ${className ?? ''}`}
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={`${glassTriggerButtonClass} ${triggerClassName ?? ''}`}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="min-w-0 truncate">{displayValue}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        </button>
      }
    >
      <div className="relative">
        <DayPicker
          mode="single"
          selected={selectedDate}
          month={displayMonth}
          onMonthChange={setDisplayMonth}
          onSelect={(date) => {
            if (date) {
              onChange(applyDatePart(value, date));
            }
          }}
          locale={dateLocale}
          classNames={{
            root: 'w-full select-none text-[13px] text-text-secondary',
            months: 'flex flex-col',
            month: 'space-y-2',
            month_caption: 'flex h-8 items-center justify-center px-9',
            caption_label: 'truncate text-[13px] font-semibold text-text-primary',
            nav: 'absolute left-0 right-0 top-0 flex h-8 items-center justify-between',
            button_previous:
              'inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary',
            button_next:
              'inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary',
            month_grid: 'w-full border-separate border-spacing-y-1',
            weekdays: '',
            weekday: 'h-7 text-center text-[11px] font-medium text-text-muted',
            week: '',
            day: 'p-0 text-center align-middle',
            day_button:
              'mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-[12px] font-medium text-text-secondary transition-colors hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
            selected: '[&>button]:bg-success [&>button]:text-white [&>button]:shadow-soft',
            today: '[&>button]:ring-1 [&>button]:ring-success/45',
            outside: 'opacity-35',
            disabled: 'opacity-30',
          }}
        />
        <div className="mt-3 flex items-center gap-2 border-t border-border-muted pt-3">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setTimeOpen((next) => !next)}
              className="inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-background/42 px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:border-accent/25 hover:bg-surface-hover focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="min-w-0 truncate tabular-nums">{getTimeValue(selectedDate)}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            </button>
            {timeOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-32 rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] p-2 shadow-elevated backdrop-blur-xl">
                <GlassTimePickerColumns
                  value={getTimeValue(selectedDate)}
                  onChange={(time) => onChange(applyTimePart(value, time))}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleToday}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {t('datePicker.today', { defaultValue: isChinese ? '今天' : 'Today' })}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-success bg-success/10 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/15"
          >
            <Check className="h-3.5 w-3.5" />
            {t('common.confirm', { defaultValue: isChinese ? '确定' : 'OK' })}
          </button>
        </div>
      </div>
    </GlassDropdownMenu>
  );
}
