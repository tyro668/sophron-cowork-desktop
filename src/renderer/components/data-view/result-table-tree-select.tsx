/**
 * Dropdown combobox that renders the grouped `ResultTableTree` picker
 * inside a floating portal popover (single-select, searchable).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2, Search, UploadCloud, X } from 'lucide-react';
import { useDropdown } from '../../hooks/useDropdown';
import type { DataGroup, DataResultTable } from '../../types';
import { cn } from '../ui';
import { ResultTableTree } from './result-table-tree';
import { isMatchingSearchText } from './shared';

const POPOVER_MIN_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 300;
const POPOVER_MIN_HEIGHT = 140;
const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 3;

export interface ResultTableTreeSelectProps {
  value: string;
  resultTables: DataResultTable[];
  groups: DataGroup[];
  disabledIds?: readonly string[];
  loading?: boolean;
  disabled?: boolean;
  placeholder: string;
  loadingLabel?: string;
  allowClear?: boolean;
  clearLabel?: string;
  fallbackLabel?: string;
  fallbackMuted?: boolean;
  triggerIcon?: ReactNode;
  ariaLabel?: string;
  triggerClassName?: string;
  onValueChange: (tableId: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export function ResultTableTreeSelect({
  value,
  resultTables,
  groups,
  disabledIds = [],
  loading = false,
  disabled = false,
  placeholder,
  loadingLabel,
  allowClear = false,
  clearLabel,
  fallbackLabel,
  fallbackMuted = false,
  triggerIcon,
  ariaLabel,
  triggerClassName,
  onValueChange,
  onOpenChange,
}: ResultTableTreeSelectProps) {
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

  const resultGroups = useMemo(() => groups.filter((item) => item.scope === 'result'), [groups]);
  const resultGroupName = useMemo(() => {
    const map = new Map(resultGroups.map((item) => [item.id, item.name]));
    return (groupId: string | null | undefined) => (groupId ? (map.get(groupId) ?? '') : '');
  }, [resultGroups]);

  const filteredResults = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return resultTables;
    return resultTables.filter(
      (table) =>
        isMatchingSearchText(table.name, trimmed) ||
        isMatchingSearchText(resultGroupName(table.groupId), trimmed)
    );
  }, [query, resultTables, resultGroupName]);

  const selectedTable = useMemo(
    () => resultTables.find((table) => table.id === value) ?? null,
    [resultTables, value]
  );

  const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);

  const updatePosition = useCallback(() => {
    const rect = dropdown.triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), viewportWidth);
    const maxLeft = Math.max(0, viewportWidth - width);
    const left = Math.min(Math.max(0, rect.left), maxLeft);
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
      : (fallbackLabel ?? (value || placeholder));

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
        data-testid="result-table-tree-select-trigger"
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
          (selectedTable || value) && !fallbackMuted ? 'text-text-primary' : 'text-text-muted',
          triggerClassName
        )}
      >
        {triggerIcon}
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
            data-testid="result-table-tree-select-popover"
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
                placeholder={t('data.resultTables.searchPlaceholder')}
                aria-label={ariaLabel}
                data-testid="result-table-tree-select-search"
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
              data-testid="result-table-tree-select-list"
            >
              {allowClear && !query.trim() && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  data-testid="result-table-tree-select-clear"
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
              {filteredResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
                  <UploadCloud className="h-5 w-5 text-text-muted" />
                  <p className="text-[12.5px] text-text-muted">
                    {query.trim()
                      ? t('cloudConnection.ds.pickerEmptySearch')
                      : t('data.resultTables.empty')}
                  </p>
                </div>
              ) : (
                <ResultTableTree
                  variant="picker"
                  resultTables={filteredResults}
                  groups={resultGroups}
                  selectionMode="single"
                  selectedIds={value ? [value] : []}
                  disabledIds={disabledIds}
                  onSelectedIdsChange={(ids) => {
                    const nextId = ids[0] ?? '';
                    if (nextId && disabledSet.has(nextId)) return;
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
