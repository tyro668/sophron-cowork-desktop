import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Trash2, X } from 'lucide-react';
import { splitInValues, joinInValues } from './filter-condition';

interface GlassMultiValueInputProps {
  value: string;
  suggestions: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 预翻译："添加" */
  addLabel: string;
  /** 预翻译："暂无建议值" */
  noSuggestionsLabel: string;
  /** 预翻译："清空输入框" */
  clearLabel?: string;
  className?: string;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, onClose]);
}

export function GlassMultiValueInput({
  value,
  suggestions,
  isLoading = false,
  disabled,
  onChange,
  placeholder = '',
  addLabel,
  noSuggestionsLabel,
  clearLabel = '清空输入框',
  className,
}: GlassMultiValueInputProps) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const values = useMemo(() => splitInValues(value), [value]);

  useClickOutside(ref, () => setOpen(false));

  const filtered = useMemo(() => {
    const available = suggestions.filter((s) => !values.includes(s));
    if (!inputText) return available.slice(0, 20);
    const lower = inputText.toLowerCase();
    return available.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [inputText, suggestions, values]);

  const addValue = useCallback(
    (v: string) => {
      const trimmed = v.trim();
      if (!trimmed || values.includes(trimmed)) return;
      const next = joinInValues([...values, trimmed]);
      onChange(next);
      setInputText('');
    },
    [values, onChange]
  );

  const removeValue = useCallback(
    (idx: number) => {
      const next = values.filter((_, i) => i !== idx);
      onChange(joinInValues(next));
    },
    [values, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addValue(inputText);
      } else if (e.key === 'Backspace' && !inputText && values.length > 0) {
        removeValue(values.length - 1);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [inputText, values.length, addValue, removeValue]
  );

  return (
    <div ref={ref} className={`relative ${className ?? ''}`} style={{ width: 280, flexShrink: 0 }}>
      <div
        className={`flex h-8 w-full items-center gap-1 rounded-md border bg-background/42 pl-1.5 pr-1 py-0.5 transition-colors ${
          open ? 'border-accent' : 'border-border-muted'
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {values.length > 0 && (
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
            title={clearLabel}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto">
          {values.map((v, i) => (
            <span
              key={i}
              className="inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {v}
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeValue(i);
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
            onFocus={() => setOpen(true)}
            placeholder={values.length === 0 ? placeholder : ''}
            className="h-6 min-w-[60px] bg-transparent pl-0.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
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
            setOpen(!open);
          }}
          className="flex h-6 w-5 flex-shrink-0 items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          {filtered.length > 0 && (
            <div className="max-h-40 overflow-y-auto">
              {filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="w-full px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover text-text-secondary"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    addValue(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {inputText && !filtered.includes(inputText) && (
            <button
              type="button"
              className="w-full px-2.5 py-1.5 text-left text-[12px] text-accent transition-colors hover:bg-surface-hover"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addValue(inputText);
              }}
            >
              {addLabel} "{inputText}"
            </button>
          )}
          {filtered.length === 0 && !inputText && (
            <div className="px-3 py-3 text-center text-[12px] text-text-muted">
              {noSuggestionsLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
