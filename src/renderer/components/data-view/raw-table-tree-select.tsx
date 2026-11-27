/**
 * Dropdown combobox that renders Cloud Connection's grouped `RawTableTree` picker
 * inside a floating portal popover (single-select, searchable, unavailable-safe).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2, Search, Table2, X } from 'lucide-react';
import { isRawTableUnavailable } from '../../../shared/contracts';
import { useDropdown } from '../../hooks/useDropdown';
import type { DataGroup, DataRawSource, DataRawTable } from '../../types';
import { cn } from '../ui';
import { RawTableTree } from './raw-table-tree';
import { isMatchingSearchText } from './shared';

const POPOVER_MIN_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 300;
const POPOVER_MIN_HEIGHT = 140;
const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 3;

export interface RawTableTreeSelectProps {
  value: string;
  rawTables: DataRawTable[];
  sources: DataRawSource[];
  groups: DataGroup[];
  loading?: boolean;
  disabled?: boolean;
  placeholder: string;
  loadingLabel?: string;
  allowClear?: boolean;
  clearLabel?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  onValueChange: (tableId: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export function RawTableTreeSelect({
  value,
  rawTables,
  sources,
  groups,
  loading = false,
  disabled = false,
  placeholder,
  loadingLabel,
  allowClear = false,
  clearLabel,
  ariaLabel,
  triggerClassName,
  onValueChange,
  onOpenChange,
}: RawTableTreeSelectProps) {
  const { t } = useTranslation();
  const dropdown = useDropdown<HTMLButtonElement>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    onOpenChange?.(dropdown.open);
    if (!dropdown.open) setQuery('');
  }, [dropdown.open, onOpenChange]);

  useEffect(() => {
    if (disabled && dropdown.open) dropdown.close();
  }, [disabled, dropdown]);

  useEffect(() => {
    if (!dropdown.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dropdown.close();
      dropdown.triggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [dropdown]);

  useEffect(() => {
    if (!dropdown.open) return;
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dropdown.open]);

  const rawGroups = useMemo(() => groups.filter((item) => item.scope === 'raw'), [groups]);
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources]
  );
  const rawGroupName = useMemo(() => {
    const map = new Map(rawGroups.map((item) => [item.id, item.name]));
    return (groupId: string | null | undefined) => (groupId ? (map.get(groupId) ?? '') : '');
  }, [rawGroups]);

  const filteredRaw = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return rawTables;
    return rawTables.filter((table) => {
      const sourceName = table.sourceId ? (sourceById.get(table.sourceId)?.name ?? '') : '';
      return (
        isMatchingSearchText(table.name, trimmed) ||
        isMatchingSearchText(rawGroupName(table.groupId), trimmed) ||
        isMatchingSearchText(sourceName, trimmed)
      );
    });
  }, [query, rawTables, rawGroupName, sourceById]);

  const selectedTable = useMemo(
    () => rawTables.find((table) => table.id === value) ?? null,
    [rawTables, value]
  );

  const updatePosition = useCallback(() => {
    const rect = dropdown.triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const maxViewportWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
    const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), maxViewportWidth);
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft);
    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const preferDown = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      POPOVER_MAX_HEIGHT,
      Math.max(POPOVER_MIN_HEIGHT, preferDown ? spaceBelow : spaceAbove)
    );
    dropdown.setMaxHeight(maxHeight);
    dropdown.setPosition({
      left,
      top: preferDown ? rect.bottom + TRIGGER_GAP : undefined,
      bottom: preferDown ? undefined : viewportHeight - rect.top + TRIGGER_GAP,
      width,
    });
  }, [dropdown]);

  const toggleOpen = () => {
    if (disabled || loading) return;
    if (dropdown.open) {
      dropdown.close();
      return;
    }
    updatePosition();
    dropdown.setOpen(true);
  };

  const displayLabel = loading
    ? (loadingLabel ?? placeholder)
    : selectedTable
      ? selectedTable.name
      : value || placeholder;

  return (
    <>
      <button
        ref={dropdown.triggerRef}
        type="button"
        role="combobox"
        aria-expanded={dropdown.open}
        aria-haspopup="tree"
        aria-label={ariaLabel}
        disabled={disabled || loading}
        data-testid="raw-table-tree-select-trigger"
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !dropdown.open) {
            event.preventDefault();
            toggleOpen();
          }
        }}
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2 text-left text-[13px] outline-none transition-colors',
          dropdown.open && 'bg-surface-hover',
          selectedTable || value ? 'text-text-primary' : 'text-text-muted',
          triggerClassName
        )}
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
        ) : (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform',
              dropdown.open && 'rotate-180'
            )}
          />
        )}
      </button>

      {dropdown.open &&
        dropdown.position &&
        createPortal(
          <div
            ref={dropdown.dropdownRef}
            data-testid="raw-table-tree-select-popover"
            style={{
              left: dropdown.position.left,
              top: dropdown.position.top,
              bottom: dropdown.position.bottom,
              width: dropdown.position.width,
              maxHeight: dropdown.maxHeight,
            }}
            className="fixed z-[10000] flex flex-col overflow-hidden rounded-none border border-border bg-surface text-text-primary shadow-elevated"
          >
            <div className="relative flex flex-shrink-0 items-center border-b border-border-subtle bg-surface-muted/40">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('data.rawTables.searchPlaceholder')}
                aria-label={ariaLabel}
                data-testid="raw-table-tree-select-search"
                className="h-9 w-full border-0 bg-transparent pl-8 pr-8 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label={t('common.clear')}
                  className="absolute right-2 inline-flex h-5 w-5 items-center justify-center text-text-muted hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto bg-surface"
              data-testid="raw-table-tree-select-list"
            >
              {allowClear && !query.trim() && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  data-testid="raw-table-tree-select-clear"
                  onClick={() => {
                    onValueChange('');
                    dropdown.close();
                    dropdown.triggerRef.current?.focus();
                  }}
                  className={cn(
                    'flex h-9 w-full items-center justify-between gap-2 border-b border-border-subtle px-3 text-left text-[13px] transition-colors',
                    !value
                      ? 'bg-accent-muted font-medium text-accent'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  )}
                >
                  <span className="truncate">{clearLabel ?? placeholder}</span>
                  {!value && <Check className="h-3.5 w-3.5 flex-shrink-0 text-accent" />}
                </button>
              )}
              {filteredRaw.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
                  <Table2 className="h-5 w-5 text-text-muted" />
                  <p className="text-[12.5px] text-text-muted">
                    {query.trim()
                      ? t('cloudConnection.ds.pickerEmptySearch')
                      : t('data.rawTables.empty')}
                  </p>
                </div>
              ) : (
                <RawTableTree
                  variant="picker"
                  rawTables={filteredRaw}
                  sources={sources}
                  groups={rawGroups}
                  selectionMode="single"
                  selectedIds={value ? [value] : []}
                  onSelectedIdsChange={(ids) => {
                    const nextId = ids[0] ?? '';
                    const picked = rawTables.find((rawTable) => rawTable.id === nextId);
                    if (picked && isRawTableUnavailable(picked)) return;
                    onValueChange(nextId);
                    dropdown.close();
                    dropdown.triggerRef.current?.focus();
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
