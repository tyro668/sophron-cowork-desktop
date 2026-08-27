import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Trash2, X } from 'lucide-react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { splitInValues, joinInValues } from '../../../../shared/filter-condition';

interface GlassValueInputProps {
  value?: string;
  values?: string[];
  suggestions: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onValuesChange?: (values: string[]) => void;
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
  values,
  suggestions,
  isLoading = false,
  disabled,
  onChange,
  onValuesChange,
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
  const [inputText, setInputText] = useState<string>(multi ? '' : (value ?? ''));
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useClickOutside(ref, () => setOpen(false));

  // Keep the single-value input in sync with the external value so that
  // remounts (e.g. switching config/data tabs) do not show an empty box
  // that later overwrites the config on blur.
  useEffect(() => {
    if (!multi) setInputText(value ?? '');
  }, [value, multi]);

  const openDropdown = useCallback(() => {
    setOpen((prev) => {
      if (!prev) onOpen?.();
      return !prev;
    });
  }, [onOpen]);

  // ── 多值模式 ──
  const tags = useMemo(() => values ?? splitInValues(value ?? ''), [value, values]);

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
    <div
      ref={ref}
      className={`relative min-w-0 ${multi ? 'w-[280px] max-w-full flex-shrink' : 'flex-1'} ${className ?? ''}`}
    >
      <div
        className={`flex h-7 w-full items-center gap-1 rounded-md border bg-background/42 transition-colors ${
          multi ? 'pl-1 pr-0' : 'focus-within:border-accent'
        } ${open ? 'border-accent' : 'border-border-muted'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {multi && tags.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              emitTags([]);
              setInputText('');
              inputRef.current?.focus();
            }}
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-error/10 hover:text-error focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
            title={clearLabel ?? tr('filterClearValues')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}

        <div
          className={`flex min-w-0 flex-1 gap-1 ${
            multi ? 'scrollbar-hover items-end overflow-x-auto overflow-y-hidden' : 'items-center'
          }`}
        >
          {multi &&
            tags.map((v, i) => (
              <span
                key={i}
                className="inline-flex h-5 max-w-[132px] flex-shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-none text-accent"
              >
                <span className="min-w-0 truncate">{v}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeTag(i);
                  }}
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  <X className="h-2 w-2" />
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
            onBlur={multi ? undefined : commitSingleValue}
            placeholder={multi ? (tags.length === 0 ? placeholder : '') : placeholder}
            className={`bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed ${multi ? 'h-6 min-w-[60px] flex-1 pl-0.5' : 'h-7 min-w-[60px] flex-1 pl-2'}`}
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
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-r-md border-l border-border-muted text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[168px] w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border-muted bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={`h-7 w-full min-w-0 overflow-hidden px-3 text-left text-[13px] outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${!multi && s === inputText ? 'bg-accent/10 font-medium text-accent ring-1 ring-inset ring-accent/20' : 'text-text-secondary'}`}
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
              className="h-7 w-full min-w-0 overflow-hidden px-3 text-left text-[13px] text-accent outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
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
          {filtered.length === 0 && (!multi || !inputText) && (
            <div className="px-3 py-3 text-center text-[12px] text-text-muted">
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
