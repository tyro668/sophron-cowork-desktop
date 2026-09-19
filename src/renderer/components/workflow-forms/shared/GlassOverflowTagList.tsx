import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GlassValueChip } from './GlassValueChip';

const TAG_GAP = 6;

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

export function GlassOverflowTagList({
  values,
  onRemove,
  disabled,
  placeholder,
  trailing,
  trailingReserve = 0,
  missing,
  missingTitle,
}: {
  values: string[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
  trailing?: ReactNode;
  trailingReserve?: number;
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
      const count = getVisibleTagCount(tagWidths, badgeWidth, availableWidth, TAG_GAP);
      setVisibleCount((previous) => (previous === count ? previous : count));
    };

    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(box);
    return () => observer.disconnect();
  }, [values, trailingReserve]);

  const count = Math.min(visibleCount, values.length);
  const hidden = values.slice(count);

  return (
    <div
      ref={boxRef}
      className="relative flex w-full min-w-0 flex-1 items-center gap-1 whitespace-nowrap"
    >
      <div className="flex min-w-0 flex-shrink items-center gap-1.5 overflow-hidden">
        {values.length === 0 && placeholder && (
          <span className="truncate text-[12px] italic text-text-muted">{placeholder}</span>
        )}
        {values.slice(0, count).map((label, index) => (
          <GlassValueChip
            key={`${label}-${index}`}
            label={label}
            disabled={disabled}
            missing={missing?.has(label)}
            missingTitle={missingTitle}
            onRemove={onRemove ? () => onRemove(index) : undefined}
          />
        ))}
        {hidden.length > 0 && (
          <span
            title={hidden.join(', ')}
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted px-1 text-[11px] font-medium leading-none text-accent"
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
          className="pointer-events-none absolute -left-[9999px] top-0 flex items-center gap-1.5"
        >
          {values.map((label, index) => (
            <GlassValueChip
              key={`${label}-${index}`}
              label={label}
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
