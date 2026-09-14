import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ChevronDown, Loader2, X } from 'lucide-react';
import { computeDropdownPlacement, useDropdown } from '../../../hooks/useDropdown';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { splitInValues, joinInValues } from '../../../../shared/filter-condition';

const CHIP_CLASSES =
  'inline-flex h-5 max-w-[132px] flex-shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-none text-accent';
const OVERFLOW_BADGE_CLASSES =
  'inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 px-1 text-[10px] font-medium leading-none text-accent';
/** Horizontal gap (gap-1) between chips and the overflow badge, in px. */
const CHIP_ROW_GAP = 4;
/** Space reserved for the text input (min-w) and its gap next to the chip row. */
const CHIPS_ROW_INPUT_RESERVE = 64;

function ValueChip({
  label,
  disabled,
  onRemove,
}: {
  label: string;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span className={CHIP_CLASSES}>
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        disabled={disabled}
        tabIndex={onRemove ? undefined : -1}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove?.();
        }}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        <X className="h-2 w-2" />
      </button>
    </span>
  );
}

interface GlassValueInputProps {
  value?: string;
  values?: string[];
  suggestions: string[];
  isLoading?: boolean;
  /** Distinct-value lookup failed; renders a retry row instead of "no match". */
  error?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onValuesChange?: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  multi?: boolean;
  addLabel?: string;
  noSuggestionsLabel?: string;
  onOpen?: () => void;
}

export function GlassValueInput({
  value,
  values,
  suggestions,
  isLoading = false,
  error = false,
  onRetry,
  disabled,
  onChange,
  onValuesChange,
  placeholder = '',
  className,
  multi = false,
  addLabel,
  noSuggestionsLabel,
  onOpen,
}: GlassValueInputProps) {
  const tr = useFormTranslation('valueInput');
  const { open, setOpen, position, setPosition, maxHeight, setMaxHeight, triggerRef, dropdownRef } =
    useDropdown();
  const [inputText, setInputText] = useState<string>(multi ? '' : (value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the single-value input in sync with the external value so that
  // remounts (e.g. switching config/data tabs) do not show an empty box
  // that later overwrites the config on blur.
  useEffect(() => {
    if (!multi) setInputText(value ?? '');
  }, [value, multi]);

  const openDropdown = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const placement = computeDropdownPlacement(rect);
      setMaxHeight(placement.maxHeight);
      setPosition({
        left: rect.left,
        top: placement.top,
        bottom: placement.bottom,
        width: rect.width,
      });
    }
    onOpen?.();
    setOpen(true);
  }, [onOpen, open, setOpen, setMaxHeight, setPosition, triggerRef]);

  const openOnFocus = useCallback(() => {
    if (!open) openDropdown();
  }, [open, openDropdown]);

  // ── 多值模式 ──
  const tags = useMemo(() => values ?? splitInValues(value ?? ''), [value, values]);

  // Chips stay on a single line; any that would wrap collapse into a circled
  // "+N" badge instead. A hidden measurer row supplies exact chip widths.
  const chipsBoxRef = useRef<HTMLDivElement>(null);
  const measureRowRef = useRef<HTMLDivElement>(null);
  const [visibleTagCount, setVisibleTagCount] = useState(tags.length);

  useLayoutEffect(() => {
    if (!multi) return;
    const box = chipsBoxRef.current;
    const measurer = measureRowRef.current;
    if (!box || !measurer) return;

    const computeVisibleCount = () => {
      // The box spans the full cell regardless of how many chips are shown,
      // so the same budget applies whether chips are being added or removed.
      const available = box.clientWidth - CHIPS_ROW_INPUT_RESERVE;
      if (available <= 0) return;
      const parts = Array.from(measurer.children) as HTMLElement[];
      const badgeWidth = parts.length > tags.length ? parts[parts.length - 1].offsetWidth : 0;
      const chipWidths = parts.slice(0, tags.length).map((el) => el.offsetWidth);
      const totalWidth = chipWidths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_ROW_GAP : 0), 0);
      let count = chipWidths.length;
      if (totalWidth > available) {
        let used = 0;
        count = 0;
        for (let i = 0; i < chipWidths.length; i++) {
          const chipWidth = chipWidths[i] + (i > 0 ? CHIP_ROW_GAP : 0);
          const reserveBadge = i < chipWidths.length - 1 ? CHIP_ROW_GAP + badgeWidth : 0;
          if (used + chipWidth + reserveBadge > available) break;
          used += chipWidth;
          count = i + 1;
        }
      }
      setVisibleTagCount((prev) => (prev === count ? prev : count));
    };

    computeVisibleCount();
    const observer = new ResizeObserver(computeVisibleCount);
    observer.observe(box);
    return () => observer.disconnect();
  }, [multi, tags]);

  const visibleTags = tags.slice(0, visibleTagCount);
  const hiddenTags = tags.slice(visibleTags.length);

  const emitTags = useCallback(
    (nextTags: string[]) => {
      if (onValuesChange) {
        onValuesChange(nextTags);
        return;
      }
      onChange?.(joinInValues(nextTags));
    },
    [onChange, onValuesChange]
  );

  const addTag = useCallback(
    (v: string) => {
      const trimmed = v.trim();
      if (!trimmed || tags.includes(trimmed)) return;
      emitTags([...tags, trimmed]);
      setInputText('');
    },
    [emitTags, tags]
  );

  const removeTag = useCallback(
    (idx: number) => {
      emitTags(tags.filter((_, i) => i !== idx));
    },
    [emitTags, tags]
  );

  const filtered = useMemo(() => {
    if (!multi) {
      if (!inputText) return suggestions.slice(0, 20);
      const lower = inputText.toLowerCase();
      return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
    }
    const available = suggestions.filter((s) => !tags.includes(s));
    if (!inputText) return available.slice(0, 20);
    const lower = inputText.toLowerCase();
    return available.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [inputText, suggestions, tags, multi]);

  function handleSuggestionClick(s: string) {
    if (multi) {
      addTag(s);
    } else {
      setInputText(s);
      onChange?.(s);
      setOpen(false);
    }
  }

  function commitSingleValue() {
    if (!multi) {
      onChange?.(inputText);
      setOpen(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (multi) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(inputText);
      } else if (e.key === 'Backspace' && !inputText && tags.length > 0) {
        removeTag(tags.length - 1);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    } else {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'Enter') {
        commitSingleValue();
      }
    }
  }

  return (
    <>
      <div
        ref={triggerRef as unknown as React.RefObject<HTMLDivElement>}
        className={`relative min-w-0 ${multi ? 'w-[280px] max-w-full flex-shrink' : 'flex-1'} ${className ?? ''}`}
      >
        <div
          className={`flex h-7 w-full items-center gap-1 rounded-md border bg-background/42 transition-colors ${
            multi ? 'pl-1 pr-0' : 'focus-within:border-accent'
          } ${open ? 'border-accent' : 'border-border-muted'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          {multi ? (
            <div ref={chipsBoxRef} className="flex min-w-0 flex-1 items-center gap-1">
              <div className="flex min-w-0 flex-shrink items-center gap-1 overflow-hidden">
                {visibleTags.map((v, i) => (
                  <ValueChip key={i} label={v} disabled={disabled} onRemove={() => removeTag(i)} />
                ))}
                {hiddenTags.length > 0 && (
                  <span className={OVERFLOW_BADGE_CLASSES} title={hiddenTags.join(', ')}>
                    +{hiddenTags.length}
                  </span>
                )}
              </div>
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                disabled={disabled}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={openOnFocus}
                placeholder={tags.length === 0 ? placeholder : ''}
                className="h-6 min-w-[60px] flex-1 bg-transparent pl-1 text-[13px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
              />
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                disabled={disabled}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={openOnFocus}
                onBlur={commitSingleValue}
                placeholder={placeholder}
                className="h-7 min-w-[60px] flex-1 bg-transparent pl-2 text-[13px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
              />
            </div>
          )}

          {isLoading && (
            <Loader2 className="my-auto h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
          )}
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openDropdown();
            }}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded-r-md border-l border-border-muted text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {multi && tags.length > 0 && (
          <div
            ref={measureRowRef}
            aria-hidden
            className="pointer-events-none absolute -left-[9999px] top-0 flex items-center gap-1"
          >
            {tags.map((v, i) => (
              <ValueChip key={i} label={v} disabled />
            ))}
            <span className={OVERFLOW_BADGE_CLASSES}>+{tags.length}</span>
          </div>
        )}
      </div>

      {open &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              left: position.left,
              top: position.top ?? undefined,
              bottom: position.bottom ?? undefined,
              width: position.width,
              maxHeight,
            }}
            className="operator-ui scrollbar-hover fixed z-50 overflow-y-auto overflow-x-hidden rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl"
          >
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                className={`flex min-h-7 w-full min-w-0 items-center overflow-hidden px-3 text-left text-[13px] outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${!multi && s === inputText ? 'bg-accent/10 font-medium text-accent ring-1 ring-inset ring-accent/20' : 'text-text-secondary'}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSuggestionClick(s);
                }}
              >
                <span className="block min-w-0 truncate">{s}</span>
              </button>
            ))}
            {multi && inputText && !filtered.includes(inputText) && (
              <button
                type="button"
                className="flex min-h-7 w-full min-w-0 items-center overflow-hidden px-3 text-left text-[13px] text-accent outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addTag(inputText);
                }}
              >
                <span className="block min-w-0 truncate">
                  {addLabel} "{inputText}"
                </span>
              </button>
            )}
            {error && !isLoading && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="flex h-9 w-full items-center justify-center gap-1.5 px-3 text-[12px] text-error outline-none transition-colors hover:bg-error/5"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {tr('loadFailed')}
              </button>
            ) : (
              filtered.length === 0 &&
              (!multi || !inputText) && (
                <div className="px-3 py-3 text-center text-[12px] text-text-muted">
                  {multi
                    ? (noSuggestionsLabel ?? tr('noSuggestions'))
                    : isLoading
                      ? tr('loadingValues')
                      : tr('noMatchValue')}
                </div>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}
