import { useMemo } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { GlassDropdownMenu, glassTriggerButtonClass } from './GlassDropdownMenu';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function normalizeTime(value: string): { hour: number; minute: number } {
  const [rawHour, rawMinute] = (value ?? '').split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 0,
    minute: Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  };
}

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

interface GlassTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

/**
 * Time-only picker styled to match GlassDateTimePicker / the glass design system.
 * Replaces the bare native <input type="time"> (whose dropdown renders an
 * off-theme native wheel) with two themed hour/minute columns.
 */
export function GlassTimePicker({
  value,
  onChange,
  disabled = false,
  triggerClassName,
}: GlassTimePickerProps) {
  const { hour, minute } = useMemo(() => normalizeTime(value), [value]);
  const displayValue = `${pad2(hour)}:${pad2(minute)}`;

  return (
    <GlassDropdownMenu
      align="start"
      sideOffset={4}
      contentClassName="w-32 p-2"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={`${glassTriggerButtonClass} ${triggerClassName ?? ''}`}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="min-w-0 truncate tabular-nums">{displayValue}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        </button>
      }
    >
      <GlassTimePickerColumns value={displayValue} onChange={onChange} />
    </GlassDropdownMenu>
  );
}

export function GlassTimePickerColumns({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { hour, minute } = useMemo(() => normalizeTime(value), [value]);
  const columnClass =
    'flex max-h-52 flex-col gap-0.5 overflow-y-auto px-1 py-1 [scrollbar-width:thin]';
  const cellClass = (active: boolean) =>
    `flex h-7 w-10 shrink-0 items-center justify-center rounded-lg text-[12px] font-medium transition-colors ${
      active
        ? 'bg-success text-white shadow-soft'
        : 'text-text-secondary hover:bg-accent/10 hover:text-accent'
    }`;

  return (
    <div className="flex items-stretch justify-center gap-1">
      <div className={columnClass}>
        {HOURS.map((item) => (
          <button
            key={item}
            type="button"
            className={cellClass(item === hour)}
            onClick={() => onChange(`${pad2(item)}:${pad2(minute)}`)}
          >
            {pad2(item)}
          </button>
        ))}
      </div>
      <div className="my-1 w-px shrink-0 bg-border-muted" />
      <div className={columnClass}>
        {MINUTES.map((item) => (
          <button
            key={item}
            type="button"
            className={cellClass(item === minute)}
            onClick={() => onChange(`${pad2(hour)}:${pad2(item)}`)}
          >
            {pad2(item)}
          </button>
        ))}
      </div>
    </div>
  );
}
