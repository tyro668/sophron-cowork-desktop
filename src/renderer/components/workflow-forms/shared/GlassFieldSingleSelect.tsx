import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { dataFieldTypeLabel } from '@/shared/data-field-types';
import { parseFieldRef } from '@/shared/prep-dsl/parser';
import { useDropdown } from '../../../hooks/useDropdown';

function extractFieldName(value: string): string {
  return parseFieldRef(value)?.name ?? value;
}

function calcMaxOptionWidth(options: string[], columnTypes: Record<string, string>): number {
  const el = document.createElement('span');
  el.style.cssText =
    'position:fixed;visibility:hidden;white-space:nowrap;font-size:12px;line-height:1.4;padding:0 2px;font-family:inherit';
  document.body.appendChild(el);
  let max = 0;
  for (const opt of options) {
    const name = extractFieldName(opt);
    const type = columnTypes[opt] ? `  ${dataFieldTypeLabel(columnTypes[opt])}` : '';
    el.textContent = name + type;
    max = Math.max(max, el.offsetWidth);
  }
  document.body.removeChild(el);
  return max + 48;
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
  showType = false,
  displayLabel,
}: GlassFieldSingleSelectProps) {
  const { t } = useTranslation();
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
      return dataFieldTypeLabel(type).toLowerCase().includes(lower);
    });
  }, [options, search, columnTypes]);

  const selectedIndex = useMemo(
    () => filteredOptions.findIndex((opt) => opt === value),
    [filteredOptions, value]
  );

  useEffect(() => {
    setHighlightedIndex(Math.max(0, selectedIndex));
  }, [selectedIndex, open]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentWidth = calcMaxOptionWidth(options, columnTypes);
    setPosition({
      left: rect.left,
      top: rect.bottom + 2,
      width: rect.width,
      minWidth: Math.max(rect.width, contentWidth),
    });
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    setMaxHeight(Math.min(240, Math.max(100, spaceBelow)));
  }, [options, columnTypes, triggerRef, setPosition, setMaxHeight]);

  const handleClose = useCallback(() => {
    close();
    setSearch('');
  }, [close]);

  const handleOpen = useCallback(() => {
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

  // Close on window resize to avoid stale positioning
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', handleClose);
    return () => window.removeEventListener('resize', handleClose);
  }, [open, handleClose]);

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
  }, [highlightedIndex, open]);

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
    [filteredOptions, highlightedIndex, handleSelect, handleClose]
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
          'inline-flex h-6 min-w-0 items-center gap-1 rounded border px-1.5 text-[12px] outline-none transition-colors',
          'border-border-muted bg-background/42 text-text-primary hover:bg-surface-hover focus:border-accent',
          className || '',
        ].join(' ')}
      >
        <span className="flex-1 text-center truncate">
          {value ? (
            showType && columnTypes[value] ? (
              <>
                {displayLabel || value}
                <span className="ml-1 text-[11px] text-text-muted">
                  ({dataFieldTypeLabel(columnTypes[value])})
                </span>
              </>
            ) : (
              displayLabel || value
            )
          ) : (
            <span className="text-text-muted">{placeholder}</span>
          )}
        </span>
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
              top: position.top,
              width: position.width,
              minWidth: position.minWidth,
              maxHeight,
            }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl"
          >
            <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
              <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                className="h-5 flex-1 min-w-0 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-1">
              {filteredOptions.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-[12px] text-text-muted">
                  {emptyText ||
                    t('data.workflow.formLabels.noMatch', { defaultValue: '无匹配字段' })}
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
                        'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] outline-none transition-colors',
                        selected
                          ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
                          : 'text-text-secondary hover:bg-background/58 hover:text-text-primary',
                        disabled ? 'pointer-events-none opacity-45' : '',
                        idx === highlightedIndex && !selected
                          ? 'bg-background/58 text-text-primary'
                          : '',
                      ].join(' ')}
                    >
                      <span className="min-w-0 flex-1 truncate">{optLabel}</span>
                      {columnTypes[opt] && (
                        <span className="flex-shrink-0 text-[11px] text-text-muted tabular-nums">
                          {dataFieldTypeLabel(columnTypes[opt])}
                        </span>
                      )}
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
