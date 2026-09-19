import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

const TAG_GAP = 4;
const TAG_GAPS: Record<'compact' | 'field', number> = { compact: 4, field: 6 };

export function getVisibleTagCount(
  tagWidths: number[],
  badgeWidth: number,
  availableWidth: number,
  tagGap: number = TAG_GAP
): number {
  const totalWidth = tagWidths.reduce(
    (width, tagWidth, index) => width + tagWidth + (index > 0 ? tagGap : 0),
    0
  );
  if (totalWidth <= availableWidth) return tagWidths.length;

  let usedWidth = 0;
  for (let index = 0; index < tagWidths.length; index += 1) {
    const nextWidth = tagWidths[index] + (index > 0 ? tagGap : 0);
    const badgeReserve = index < tagWidths.length - 1 ? tagGap + badgeWidth : 0;
    if (usedWidth + nextWidth + badgeReserve > availableWidth) return index;
    usedWidth += nextWidth;
  }
  return tagWidths.length;
}

function Tag({
  label,
  variant,
  disabled,
  missing,
  missingTitle,
  onRemove,
}: {
  label: string;
  variant: 'compact' | 'field';
  disabled?: boolean;
  missing?: boolean;
  missingTitle?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      title={missing ? missingTitle : undefined}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border font-medium ${
        missing
          ? 'border-error/25 bg-error/10 text-error'
          : 'border-accent/20 bg-accent-muted text-accent'
      } ${
        variant === 'compact'
          ? 'h-5 max-w-[132px] px-1.5 text-[11px] leading-none'
          : 'h-6 max-w-[180px] px-2 text-[12px]'
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {missing && <span className="shrink-0 text-[9px]">?</span>}
      {onRemove && (
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={label}
          className={`inline-flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
            missing ? 'hover:bg-error/15' : 'hover:bg-accent/15'
          } ${variant === 'compact' ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
        >
          <X className={variant === 'compact' ? 'h-2 w-2' : 'h-2.5 w-2.5'} />
        </button>
      )}
    </span>
  );
}

export function GlassOverflowTagList({
  values,
  onRemove,
  disabled,
  placeholder,
  trailing,
  trailingReserve = 0,
  variant = 'compact',
  missing,
  missingTitle,
}: {
  values: string[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
  trailing?: ReactNode;
  trailingReserve?: number;
  variant?: 'compact' | 'field';
  /** Selected values absent from the option list — rendered with an error marker. */
  missing?: ReadonlySet<string>;
  missingTitle?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(values.length);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure || values.length === 0) return;

    const updateVisibleCount = () => {
      const parts = Array.from(measure.children) as HTMLElement[];
      const tagWidths = parts.slice(0, values.length).map((part) => part.offsetWidth);
      const badgeWidth = parts[values.length]?.offsetWidth ?? 0;
      const availableWidth = Math.max(0, box.clientWidth - trailingReserve);
      const count = getVisibleTagCount(tagWidths, badgeWidth, availableWidth, TAG_GAPS[variant]);
      setVisibleCount((previous) => (previous === count ? previous : count));
    };

    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(box);
    return () => observer.disconnect();
  }, [values, trailingReserve, variant]);

  const count = Math.min(visibleCount, values.length);
  const hidden = values.slice(count);

  return (
    <div
      ref={boxRef}
      className="relative flex w-full min-w-0 flex-1 items-center gap-1 whitespace-nowrap"
    >
      <div
        className={`flex min-w-0 flex-shrink items-center overflow-hidden ${
          variant === 'compact' ? 'gap-1' : 'gap-1.5'
        }`}
      >
        {values.length === 0 && placeholder && (
          <span className="truncate text-[12px] italic text-text-muted">{placeholder}</span>
        )}
        {values.slice(0, count).map((label, index) => (
          <Tag
            key={`${label}-${index}`}
            label={label}
            variant={variant}
            disabled={disabled}
            missing={missing?.has(label)}
            missingTitle={missingTitle}
            onRemove={onRemove ? () => onRemove(index) : undefined}
          />
        ))}
        {hidden.length > 0 && (
          <span
            title={hidden.join(', ')}
            className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted px-1 font-medium leading-none text-accent ${
              variant === 'compact' ? 'text-[10px]' : 'text-[11px]'
            }`}
          >
            +{hidden.length}
          </span>
        )}
      </div>
      {trailing}
      {values.length > 0 && (
        <div
          ref={measureRef}
          aria-hidden
          className={`pointer-events-none absolute -left-[9999px] top-0 flex items-center ${
            variant === 'compact' ? 'gap-1' : 'gap-1.5'
          }`}
        >
          {values.map((label, index) => (
            <Tag
              key={`${label}-${index}`}
              label={label}
              variant={variant}
              disabled
              onRemove={onRemove ? () => undefined : undefined}
            />
          ))}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-muted px-1 text-[11px] font-medium leading-none text-accent">
            +{values.length}
          </span>
        </div>
      )}
    </div>
  );
}
