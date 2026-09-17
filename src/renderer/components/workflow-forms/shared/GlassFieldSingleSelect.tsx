import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { useDataFieldTypeLabel } from '../../../hooks/useDataFieldTypeLabel';
import { parseFieldRef } from '@/shared/prep-dsl/parser';
import { computeDropdownPlacement, useDropdown } from '../../../hooks/useDropdown';
import { DataTypeIcon } from './DataTypeIcon';
import { computeDropdownWidth, measureMaxTextWidth } from './dropdownWidth';

function extractFieldName(value: string): string {
  return parseFieldRef(value)?.name ?? value;
}

interface GlassFieldSingleSelectProps {
  value: string;
  options: string[];
  columnTypes?: Record<string, string>;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabledOptions?: Set<string>;
  className?: string;
  showType?: boolean;
  displayLabel?: string;
}

export function GlassFieldSingleSelect({
  value,
  options,
  columnTypes = {},
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabledOptions,
  className,
  showType = true,
  displayLabel,
}: GlassFieldSingleSelectProps) {
  const { t } = useTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();
  const {
    open,
    setOpen,
    position,
    setPosition,
    maxHeight,
    setMaxHeight,
    triggerRef,
    dropdownRef,
    close,
  } = useDropdown();
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return options;
    return options.filter((opt) => {
      const label = extractFieldName(opt).toLowerCase();
      if (label.includes(lower)) return true;
      const type = columnTypes[opt];
      if (!type) return false;
      return dataTypeLabel(type).toLowerCase().includes(lower);
    });
  }, [columnTypes, dataTypeLabel, options, search]);

  const selectedIndex = useMemo(
    () => filteredOptions.findIndex((opt) => opt === value),
    [filteredOptions, value]
  );

  const optionTexts = useMemo(() => options.map(extractFieldName), [options]);

  useEffect(() => {
    setHighlightedIndex(Math.max(0, selectedIndex));
  }, [selectedIndex, open]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentWidth = measureMaxTextWidth(optionTexts);
    const dropdownWidth = computeDropdownWidth(rect.width, contentWidth);
    const placement = computeDropdownPlacement(rect);
    setMaxHeight(placement.maxHeight);
    setPosition({
      left: rect.left,
      top: placement.top,
      bottom: placement.bottom,
      width: rect.width,
      ...dropdownWidth,
    });
  }, [optionTexts, triggerRef, setPosition, setMaxHeight]);

  const handleClose = useCallback(() => {
    close();
    setSearch('');
  }, [close]);

  const handleOpen = useCallback(() => {
    // The hook's outside-click/resize close bypasses handleClose, so stale
    // search text must be cleared here to avoid reopening with a hidden filter.
    setSearch('');
    updatePosition();
    setOpen(true);
  }, [updatePosition, setOpen]);

  const handleSelect = useCallback(
    (opt: string) => {
      if (disabledOptions?.has(opt)) return;
      onChange(opt);
      handleClose();
      triggerRef.current?.focus();
    },
    [disabledOptions, onChange, handleClose, triggerRef]
  );

  // Focus search input on open
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open) return;
    const el = dropdownRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [dropdownRef, highlightedIndex, open]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleOpen();
      }
    },
    [handleOpen]
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        triggerRef.current?.focus();
        return;
      }

      if (filteredOptions.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(filteredOptions.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = filteredOptions[highlightedIndex];
        if (opt) handleSelect(opt);
      }
    },
    [filteredOptions, highlightedIndex, handleSelect, handleClose, triggerRef]
  );

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setHighlightedIndex(0);
  }, []);

  const handleTriggerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (open) {
        handleClose();
      } else {
        handleOpen();
      }
    },
    [open, handleClose, handleOpen]
  );

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onMouseDown={handleTriggerMouseDown}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={placeholder}
        className={[
          'inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded border px-2 text-[13px] outline-none transition-colors',
          'border-border-muted bg-surface text-text-primary hover:bg-surface-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
          className || '',
        ].join(' ')}
      >
        {value ? (
          showType ? (
            <>
              <DataTypeIcon type={columnTypes[value]} />
              <span className="flex-1 min-w-0 truncate text-left">{displayLabel || value}</span>
            </>
          ) : (
            <span className="flex-1 min-w-0 truncate text-left">{displayLabel || value}</span>
          )
        ) : (
          <span className="flex-1 min-w-0 truncate text-left text-text-muted">{placeholder}</span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            onKeyDown={handleListKeyDown}
            role="listbox"
            aria-label={placeholder}
            style={{
              left: position.left,
              top: position.top ?? undefined,
              bottom: position.bottom ?? undefined,
              width: position.width,
              minWidth: position.minWidth,
              maxWidth: position.maxWidth,
              maxHeight,
            }}
            className="operator-ui fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-elevated"
          >
            <div className="flex min-h-8 items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                className="h-8 flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>

            <div className="scrollbar-hover flex-1 overflow-y-auto p-1">
              {filteredOptions.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-[12px] text-text-muted">
                  {emptyText ||
                    t('data.workflow.formLabels.fieldPicker.noMatch', {
                      defaultValue: 'No match',
                    })}
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const disabled = disabledOptions?.has(opt) ?? false;
                  const selected = opt === value;
                  const optLabel = extractFieldName(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-disabled={disabled}
                      data-index={idx}
                      disabled={disabled}
                      onClick={() => handleSelect(opt)}
                      className={[
                        'flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30',
                        selected
                          ? 'bg-accent-muted text-text-primary ring-1 ring-inset ring-accent/20'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                        disabled ? 'pointer-events-none opacity-45' : '',
                        idx === highlightedIndex && !selected ? 'bg-surface text-text-primary' : '',
                      ].join(' ')}
                    >
                      <DataTypeIcon type={columnTypes[opt]} />
                      <span className="min-w-0 flex-1 truncate">{optLabel}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
