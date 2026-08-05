import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Trash2, X } from 'lucide-react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { splitInValues, joinInValues } from './filter-condition';

interface GlassValueInputProps {
  value: string;
  suggestions: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  multi?: boolean;
  addLabel?: string;
  noSuggestionsLabel?: string;
  clearLabel?: string;
  onOpen?: () => void;
}

export function GlassValueInput({
  value,
  suggestions,
  isLoading = false,
  disabled,
  onChange,
  placeholder = '',
  className,
  multi = false,
  addLabel,
  noSuggestionsLabel,
  clearLabel,
  onOpen,
}: GlassValueInputProps) {
  const tr = useFormTranslation();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState(multi ? '' : value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useClickOutside(ref, () => setOpen(false));

  // Keep the single-value input in sync with the external value so that
  // remounts (e.g. switching config/data tabs) do not show an empty box
  // that later overwrites the config on blur.
  useEffect(() => {
    if (!multi) setInputText(value);
  }, [value, multi]);

  const openDropdown = useCallback(() => {
    setOpen((prev) => {
      if (!prev) onOpen?.();
      return !prev;
    });
  }, [onOpen]);

  // ── 多值模式 ──
  const tags = useMemo(() => splitInValues(value), [value]);

  const addTag = useCallback(
    (v: string) => {
      const trimmed = v.trim();
      if (!trimmed || tags.includes(trimmed)) return;
      onChange(joinInValues([...tags, trimmed]));
      setInputText('');
    },
    [tags, onChange]
  );

  const removeTag = useCallback(
    (idx: number) => {
      onChange(joinInValues(tags.filter((_, i) => i !== idx)));
    },
    [tags, onChange]
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
      onChange(s);
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
        onChange(inputText);
        setOpen(false);
      }
    }
  }

  return (
    <div
      ref={ref}
      className={`relative ${multi ? '' : 'flex-1 min-w-0'} ${className ?? ''}`}
      style={multi ? { width: 280, flexShrink: 0 } : undefined}
    >
      <div
        className={`flex h-8 w-full items-center gap-1 rounded-md border bg-background/42 transition-colors ${
          multi ? 'pl-1.5 pr-1 py-0.5' : 'focus-within:border-accent'
        } ${open ? 'border-accent' : 'border-border-muted'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {multi && tags.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
              setInputText('');
              inputRef.current?.focus();
            }}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-0.5 text-text-muted hover:text-error hover:bg-error/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title={clearLabel ?? tr('filterClearValues')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}

        <div className={`flex flex-1 min-w-0 items-center gap-1 ${multi ? 'overflow-x-auto' : ''}`}>
          {multi &&
            tags.map((v, i) => (
              <span
                key={i}
                className="inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
              >
                {v}
                <button
                  type="button"
                  disabled={disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeTag(i);
                  }}
                  className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            disabled={disabled}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => openDropdown()}
            onBlur={multi ? undefined : () => setTimeout(() => onChange(inputText), 100)}
            placeholder={multi ? (tags.length === 0 ? placeholder : '') : placeholder}
            className={`bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed ${multi ? 'h-6 min-w-[60px] pl-0.5' : 'h-8 min-w-[60px] flex-1 pl-2'}`}
          />
        </div>

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
          className={`flex flex-shrink-0 items-center justify-center text-text-muted hover:text-text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${multi ? 'h-6 w-5' : 'w-7 border-l border-border-muted rounded-r-md'}`}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={`w-full px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover ${!multi && s === inputText ? 'text-accent' : 'text-text-secondary'}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSuggestionClick(s);
              }}
            >
              {s}
            </button>
          ))}
          {multi && inputText && !filtered.includes(inputText) && (
            <button
              type="button"
              className="w-full px-2.5 py-1.5 text-left text-[12px] text-accent transition-colors hover:bg-surface-hover"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addTag(inputText);
              }}
            >
              {addLabel} "{inputText}"
            </button>
          )}
          {filtered.length === 0 && (!multi || !inputText) && (
            <div className="px-2.5 py-4 text-center text-[12px] text-text-muted">
              {multi
                ? (noSuggestionsLabel ?? tr('noSuggestions'))
                : isLoading
                  ? tr('loadingValues')
                  : tr('noMatchValue')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
