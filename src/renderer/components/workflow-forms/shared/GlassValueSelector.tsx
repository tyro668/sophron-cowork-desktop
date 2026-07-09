import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Trash2, X } from 'lucide-react';

interface GlassValueSelectorProps {
  values: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  maxHeight?: string;
}

export function GlassValueSelector({
  values,
  selected,
  onChange,
  placeholder,
  maxHeight = '180px',
}: GlassValueSelectorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return values;
    return values.filter((v) => v.toLowerCase().includes(lower));
  }, [values, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.includes(v));

  function toggleAll() {
    if (filtered.length === 0) return;
    if (allFilteredSelected) {
      const filteredSet = new Set(filtered);
      onChange(selected.filter((v) => !filteredSet.has(v)));
    } else {
      const toAdd = filtered.filter((v) => !selected.includes(v));
      onChange([...selected, ...toAdd]);
    }
  }

  function toggleItem(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function handleClear() {
    onChange([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1 rounded-lg border border-border-muted bg-background/60 px-2 py-1">
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex flex-shrink-0 items-center justify-center rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
          title={tr('clearAll', '清空字段')}
          aria-label={tr('clearAll', '清空字段')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {selected.length === 0 && (
          <span className="text-[11px] text-text-muted italic">
            {placeholder || tr('pivotInPlaceholder', '2024, 2025, 2026')}
          </span>
        )}
        <div className="flex flex-1 flex-wrap gap-1">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {v}
              <button
                type="button"
                onClick={() => toggleItem(v)}
                className="inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20 transition-colors"
                aria-label={tr('removeField', '移除')}
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setSearch('');
          }}
          className="inline-flex flex-shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {open ? '收起 ▲' : '展开 ▼'}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded-lg border border-border-muted bg-background/60">
          <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('searchField', '搜索')}
              className="h-5 flex-1 min-w-0 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
            />
            <label
              className="flex cursor-pointer items-center gap-1 flex-shrink-0"
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              <span className="text-[11px] text-text-secondary font-medium whitespace-nowrap">
                {allFilteredSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
              </span>
            </label>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-text-muted">
                {search ? tr('noMatch', '无匹配值') : tr('noFields', '暂无可用值')}
              </div>
            ) : (
              filtered.map((v) => {
                const checked = selected.includes(v);
                return (
                  <label
                    key={v}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-[4px] text-[12px] transition-colors hover:bg-surface-hover ${
                      checked ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItem(v)}
                      className="h-3.5 w-3.5 flex-shrink-0 accent-accent"
                    />
                    <span className="flex-1 min-w-0 truncate">{v}</span>
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
