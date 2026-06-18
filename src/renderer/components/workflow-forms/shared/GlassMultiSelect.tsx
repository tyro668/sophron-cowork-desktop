import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X } from 'lucide-react';

interface GlassMultiSelectProps {
  value: string[];
  suggestions: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  scrollKey?: string;
}

export function GlassMultiSelect({
  value,
  suggestions,
  onChange,
  placeholder,
  scrollKey,
}: GlassMultiSelectProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );
  const resolvedPlaceholder = placeholder ?? tr('aggregateGroupByPlaceholder', '选择字段...');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const scrollLockRef = useRef<{ scrollTop: number; until: number } | null>(null);
  const scrollLockFrameRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    if (!lower) return suggestions.slice(0, 30);
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 30);
  }, [search, suggestions]);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const removingRef = useRef(false);

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus({ preventScroll: true });
    }
  }, [open]);

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

  const restoreScrollTop = useCallback((scrollTop: number) => {
    if (listRef.current) {
      listRef.current.scrollTop = scrollTop;
    }
  }, []);

  const stopScrollLock = useCallback(() => {
    if (scrollLockFrameRef.current !== null) {
      cancelAnimationFrame(scrollLockFrameRef.current);
      scrollLockFrameRef.current = null;
    }
    scrollLockRef.current = null;
  }, []);

  const runScrollLock = useCallback(() => {
    const lock = scrollLockRef.current;
    if (!lock) {
      scrollLockFrameRef.current = null;
      return;
    }

    restoreScrollTop(lock.scrollTop);
    if (performance.now() >= lock.until) {
      scrollLockFrameRef.current = null;
      scrollLockRef.current = null;
      return;
    }

    scrollLockFrameRef.current = requestAnimationFrame(runScrollLock);
  }, [restoreScrollTop]);

  const startScrollLock = useCallback(
    (scrollTop: number) => {
      scrollLockRef.current = {
        scrollTop,
        until: performance.now() + SCROLL_LOCK_WINDOW_MS,
      };
      if (scrollLockFrameRef.current === null) {
        scrollLockFrameRef.current = requestAnimationFrame(runScrollLock);
      }
    },
    [runScrollLock]
  );

  const lockScrollTop = useCallback(() => {
    const scrollTop = listRef.current?.scrollTop ?? 0;
    pendingScrollTopRef.current = scrollTop;
    startScrollLock(scrollTop);
    if (scrollKey) {
      multiSelectScrollCache.set(scrollKey, {
        scrollTop,
        expiresAt: Date.now() + SCROLL_CACHE_TTL_MS,
      });
    }
  }, [scrollKey, startScrollLock]);

  const commitSelection = useCallback(
    (nextValue: string[]) => {
      lockScrollTop();
      onChangeRef.current(nextValue);
    },
    [lockScrollTop]
  );

  useLayoutEffect(() => {
    const pendingScrollTop = pendingScrollTopRef.current;
    if (pendingScrollTop === null) return;

    restoreScrollTop(pendingScrollTop);
    startScrollLock(pendingScrollTop);
    pendingScrollTopRef.current = null;
  });

  useLayoutEffect(() => {
    if (!open || !scrollKey) return;

    const cached = multiSelectScrollCache.get(scrollKey);
    if (!cached || cached.expiresAt < Date.now()) {
      multiSelectScrollCache.delete(scrollKey);
      return;
    }
    restoreScrollTop(cached.scrollTop);
  }, [open, restoreScrollTop, scrollKey]);

  useEffect(() => {
    if (!open) {
      pendingScrollTopRef.current = null;
      stopScrollLock();
    }
  }, [open, stopScrollLock]);

  useEffect(() => stopScrollLock, [stopScrollLock]);

  const toggle = useCallback(
    (col: string) => {
      const cur = valueRef.current;
      if (cur.includes(col)) {
        commitSelection(cur.filter((v) => v !== col));
      } else {
        commitSelection([...cur, col]);
      }
    },
    [commitSelection]
  );

  const remove = useCallback((col: string) => {
    if (removingRef.current) return;
    removingRef.current = true;
    onChangeRef.current(valueRef.current.filter((v) => v !== col));
    requestAnimationFrame(() => {
      removingRef.current = false;
    });
  }, []);

  const allSelected = suggestions.length > 0 && value.length === suggestions.length;

  function toggleAll() {
    commitSelection(allSelected ? [] : [...suggestions]);
  }

  return (
    <div ref={ref} className="relative">
      <div
        className={`flex min-h-7 rounded-md border bg-background/42 text-[12px] transition-colors ${
          open ? 'border-accent ring-1 ring-accent/20' : 'border-border-muted'
        }`}
      >
        <div className="flex flex-1 flex-wrap items-center gap-1 px-1.5 py-0.5">
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
                  onMouseDown={(e) => {
                    e.preventDefault();
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
        </div>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (open) setSearch('');
            setOpen(!open);
          }}
          className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded-md border border-border-muted bg-[var(--glass-card-strong)] py-0.5 shadow-elevated backdrop-blur-xl">
          <div
            className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1"
            onClick={() => searchInputRef.current?.focus({ preventScroll: true })}
          >
            <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('search', '搜索...')}
              ref={searchInputRef}
              className="w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1">
            <button
              type="button"
              role="checkbox"
              aria-checked={allSelected}
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleAll();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                readOnly
                tabIndex={-1}
                className="pointer-events-none h-3 w-3 rounded border-border-muted accent-accent"
              />
              {allSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
            </button>
          </div>
          <div ref={listRef} className="max-h-48 overflow-y-auto [overflow-anchor:none]">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-[12px] text-text-muted">
                {tr('noMatch', '无匹配字段')}
              </div>
            ) : (
              filtered.map((col) => {
                const selected = value.includes(col);
                return (
                  <div
                    key={col}
                    role="checkbox"
                    aria-checked={selected}
                    tabIndex={0}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-surface-hover ${
                      selected ? 'text-accent' : 'text-text-secondary'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(col);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      lockScrollTop();
                      toggle(col);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      readOnly
                      tabIndex={-1}
                      className="pointer-events-none h-3.5 w-3.5 rounded border-border-muted accent-accent"
                    />
                    {col}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SCROLL_CACHE_TTL_MS = 1000;
const SCROLL_LOCK_WINDOW_MS = 350;
const multiSelectScrollCache = new Map<string, { scrollTop: number; expiresAt: number }>();
