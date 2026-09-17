import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker, type NavProps, useDayPicker } from '@daypicker/react';
import { enUS, zhCN } from '@daypicker/react/locale';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
} from 'lucide-react';
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

function startOfLocalDay(timestamp: number): Date {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date;
}

function clampToMinValue(timestamp: number, minValue?: number): number {
  return minValue !== undefined && timestamp < minValue ? minValue : timestamp;
}

function addCalendarYears(date: Date, amount: number): Date {
  return new Date(date.getFullYear() + amount, date.getMonth(), 1);
}

const DROPDOWN_COLLISION_PADDING = 12;
const DATE_PICKER_SIDE_OFFSET = 4;
// Includes the calendar, footer controls, and the time columns opened below the footer.
const EXPANDED_PICKER_HEIGHT = 620;
const NAV_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-30';

function GlassDatePickerNav({
  className,
  previousMonth,
  nextMonth,
  onPreviousClick,
  onNextClick,
  ...props
}: NavProps) {
  const { months, goToMonth } = useDayPicker();
  const currentMonth = months[0]?.date;

  const goToYear = (amount: number) => {
    if (currentMonth) {
      goToMonth(addCalendarYears(currentMonth, amount));
    }
  };

  return (
    <nav {...props} className={className}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous year"
          disabled={!currentMonth}
          className={NAV_BUTTON_CLASS}
          onClick={() => goToYear(-1)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Previous month"
          disabled={!previousMonth}
          className={NAV_BUTTON_CLASS}
          onClick={onPreviousClick}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Next month"
          disabled={!nextMonth}
          className={NAV_BUTTON_CLASS}
          onClick={onNextClick}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next year"
          disabled={!currentMonth}
          className={NAV_BUTTON_CLASS}
          onClick={() => goToYear(1)}
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

interface GlassDateTimePickerProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  minValue?: number;
  className?: string;
  triggerClassName?: string;
}

export function GlassDateTimePicker({
  value,
  onChange,
  disabled = false,
  minValue,
  className,
  triggerClassName,
}: GlassDateTimePickerProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<'bottom' | 'top'>('bottom');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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
    onChange(clampToMinValue(Date.now(), minValue));
  };

  const updatePickerSide = () => {
    if (typeof window === 'undefined') return;
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;

    const availableBelow =
      window.innerHeight -
      triggerRect.bottom -
      DATE_PICKER_SIDE_OFFSET -
      DROPDOWN_COLLISION_PADDING;
    const availableAbove = triggerRect.top - DATE_PICKER_SIDE_OFFSET - DROPDOWN_COLLISION_PADDING;

    setPickerSide(
      availableBelow < EXPANDED_PICKER_HEIGHT && availableAbove > availableBelow ? 'top' : 'bottom'
    );
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
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          updatePickerSide();
        }
        setOpen(nextOpen);
      }}
      align="start"
      side={pickerSide}
      sideOffset={4}
      contentClassName={`w-[19.5rem] !overflow-visible p-3 ${className ?? ''}`}
      trigger={
        <button
          ref={triggerRef}
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
          fixedWeeks
          showOutsideDays
          onMonthChange={setDisplayMonth}
          onSelect={(date) => {
            if (date) {
              onChange(clampToMinValue(applyDatePart(value, date), minValue));
            }
          }}
          disabled={minValue === undefined ? undefined : { before: startOfLocalDay(minValue) }}
          locale={dateLocale}
          components={{
            Nav: GlassDatePickerNav,
          }}
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
            month_grid: 'w-full table-fixed border-separate border-spacing-y-1',
            weekdays: '',
            weekday: 'h-7 text-center text-[11px] font-medium text-text-muted',
            week: 'h-9',
            day: 'h-8 w-8 p-0 text-center align-middle',
            day_button:
              'mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-[12px] font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
            selected:
              '[&>button]:bg-success [&>button]:text-success-foreground [&>button]:shadow-soft',
            today: '[&>button]:ring-1 [&>button]:ring-success/45',
            outside: 'opacity-35',
            disabled: 'opacity-30',
          }}
        />
        <div className="mt-3 flex items-center gap-2 border-t border-border-muted pt-3">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                updatePickerSide();
                setTimeOpen((next) => !next);
              }}
              className="inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-surface px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/25"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="min-w-0 truncate tabular-nums">{getTimeValue(selectedDate)}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            </button>
            {timeOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-32 rounded-xl border border-border-subtle bg-surface p-2 shadow-elevated">
                <GlassTimePickerColumns
                  value={getTimeValue(selectedDate)}
                  onChange={(time) =>
                    onChange(clampToMinValue(applyTimePart(value, time), minValue))
                  }
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
