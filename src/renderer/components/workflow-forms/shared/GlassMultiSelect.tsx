import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X } from 'lucide-react';

interface GlassMultiSelectProps {
  value: string[];
  suggestions: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export function GlassMultiSelect({
  value,
  suggestions,
  onChange,
  placeholder,
}: GlassMultiSelectProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );
  const resolvedPlaceholder = placeholder ?? tr('aggregateGroupByPlaceholder', '选择字段...');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    if (!lower) return suggestions.slice(0, 30);
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 30);
  }, [search, suggestions]);

  function toggle(col: string) {
    if (value.includes(col)) {
      onChange(value.filter((v) => v !== col));
    } else {
      onChange([...value, col]);
    }
  }

  function remove(col: string) {
    onChange(value.filter((v) => v !== col));
  }

  const allSelected = suggestions.length > 0 && value.length === suggestions.length;

  function toggleAll() {
    onChange(allSelected ? [] : [...suggestions]);
  }

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => {
          if (open) {
            setSearch('');
          }
          setOpen(!open);
        }}
        className={`flex min-h-7 cursor-pointer flex-wrap items-center gap-1 rounded-md border bg-background/42 px-1.5 py-0.5 text-[12px] outline-none transition-colors ${
          open ? 'border-accent ring-1 ring-accent/20' : 'border-border-muted'
        }`}
      >
        {value.length === 0 ? (
          <span className="text-text-muted">{resolvedPlaceholder}</span>
        ) : (
          value.map((col) => (
            <span
              key={col}
              className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {col}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(col);
                }}
                className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))
        )}
        <ChevronDown className="ml-auto h-3 w-3 flex-shrink-0 text-text-muted" />
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded-md border border-border-muted bg-[var(--glass-card-strong)] py-0.5 shadow-elevated backdrop-blur-xl">
          <div
            className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('search', '搜索...')}
              autoFocus
              className="w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3 w-3 rounded border-border-muted accent-accent"
              />
              {allSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
            </label>
            <span className="text-[10px] text-text-muted">
              {value.length}/{suggestions.length}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-[12px] text-text-muted">
                {tr('noMatch', '无匹配字段')}
              </div>
            ) : (
              filtered.map((col) => {
                const selected = value.includes(col);
                return (
                  <label
                    key={col}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-surface-hover ${
                      selected ? 'text-accent' : 'text-text-secondary'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggle(col);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      readOnly
                      className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                    />
                    {col}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
