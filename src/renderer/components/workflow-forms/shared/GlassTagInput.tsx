import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface GlassTagInputProps {
  value: string[];
  suggestions?: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function GlassTagInput({
  value,
  suggestions = [],
  onChange,
  placeholder,
}: GlassTagInputProps) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
      }
      setInput('');
      setShowSuggestions(false);
    },
    [value, onChange]
  );

  const removeTag = useCallback(
    (tag: string) => {
      onChange(value.filter((t) => t !== tag));
    },
    [value, onChange]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex min-h-[32px] flex-wrap items-center gap-1 rounded-lg border border-border-muted bg-background/42 px-2 py-1.5 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="ml-0.5 rounded p-0.5 hover:bg-accent/20 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative flex-1" style={{ minWidth: '80px' }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            className="h-6 w-full min-w-[80px] bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl py-0.5">
              {filteredSuggestions.slice(0, 8).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="w-full px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
