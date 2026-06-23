import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

interface GlassValueInputProps {
  value: string;
  suggestions: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
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

export function GlassValueInput({
  value,
  suggestions,
  isLoading = false,
  disabled,
  onChange,
  placeholder = '',
  className,
}: GlassValueInputProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setInput(value), [value]);

  useClickOutside(ref, () => setOpen(false));

  const filtered = useMemo(() => {
    if (!input) return suggestions.slice(0, 20);
    const lower = input.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [input, suggestions]);

  return (
    <div ref={ref} className={`relative flex-1 min-w-0 ${className ?? ''}`}>
      <div className="flex rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'Enter') {
              onChange(input);
              setOpen(false);
            }
          }}
          onBlur={() => onChange(input)}
          placeholder={placeholder}
          className="h-8 flex-1 min-w-[60px] bg-transparent pl-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
        />
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
          className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          <div className="max-h-40 overflow-y-auto">
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                className={`w-full px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover ${
                  s === input ? 'text-accent' : 'text-text-secondary'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(s);
                  onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
