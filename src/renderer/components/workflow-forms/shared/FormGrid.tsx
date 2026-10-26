import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { GlassOptionSingleSelect } from './GlassOptionSingleSelect';
import './form-grid.css';

/**
 * One shared column grid per operator form. All rows use these cells and merge
 * columns via `span`, so every vertical divider falls on the same x positions.
 */
export function FormGrid({
  columns,
  children,
  className = '',
  style,
  testId,
}: {
  columns: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <div className="opg-frame">
      <div
        className={`opg ${className}`}
        style={{ gridTemplateColumns: columns, ...style }}
        data-testid={testId}
        data-opg-columns={columns}
      >
        {children}
      </div>
    </div>
  );
}

export type CellVariant =
  | 'lab'
  | 'top'
  | 'th'
  | 'opt'
  | 'on'
  | 'ro'
  | 'muted'
  | 'mono'
  | 'num'
  | 'ctr'
  | 'blank'
  | 'wrap'
  | 'hl'
  | 'err'
  | 'erow'
  | 'wrow'
  | 'hint'
  | 'add'
  | 'btns'
  | 'btnp'
  | 'acts'
  | 'chips'
  | 'pane'
  | 'ctl';

function cellClass(variants: Array<CellVariant | false | null | undefined>, extra = '') {
  return ['opg-c', ...variants.filter(Boolean), extra].filter(Boolean).join(' ');
}

function spanStyle(span?: number, rowSpan?: number, style?: CSSProperties): CSSProperties {
  return {
    ...(span && span > 1 ? { gridColumn: `span ${span} / span ${span}` } : {}),
    ...(rowSpan && rowSpan > 1 ? { gridRow: `span ${rowSpan} / span ${rowSpan}` } : {}),
    ...style,
  };
}

export function Cell({
  span,
  rowSpan,
  v = [],
  children,
  className,
  style,
  title,
  testId,
}: {
  span?: number;
  rowSpan?: number;
  v?: Array<CellVariant | false | null | undefined>;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  testId?: string;
}) {
  return (
    <div
      className={cellClass(v, className)}
      style={spanStyle(span, rowSpan, style)}
      title={title}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Label column cell (surface-muted). `rowSpan` lets one label cover a table. */
export function LabelCell({
  children,
  rowSpan,
  required,
  top,
}: {
  children: ReactNode;
  rowSpan?: number;
  required?: boolean;
  top?: boolean;
}) {
  return (
    <Cell v={['lab', (top || (rowSpan ?? 1) > 1) && 'top']} rowSpan={rowSpan}>
      <span className="truncate">{children}</span>
      {required ? <span className="req">*</span> : null}
    </Cell>
  );
}

/** Segmented control where every option occupies exactly one grid column. */
export function SegmentCells<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string; span?: number }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={ariaLabel ? `${ariaLabel}: ${String(option.value)}` : undefined}
            title={option.title}
            disabled={disabled}
            className={cellClass(['opt', on && 'on'])}
            style={spanStyle(option.span)}
            onClick={() => !on && onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </>
  );
}

export interface SelectCellOption<T extends string> {
  value: T;
  label: string;
  /** Short secondary line shown under the label in the open list. */
  description?: string;
  icon?: ReactNode;
  title?: string;
  /** Legacy SegmentCells column width; summed for the default cell span. */
  span?: number;
}

/**
 * Dropdown filling grid cells flush (the enum counterpart of SegmentCells).
 * Default span equals the option count, so it drops into a SegmentCells slot
 * without shifting the grid.
 */
export function SelectCell<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  span,
  highlight,
  testId,
}: {
  value: T;
  options: Array<SelectCellOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  span?: number;
  highlight?: boolean;
  testId?: string;
}) {
  const cellSpan = span ?? options.reduce((sum, option) => sum + (option.span ?? 1), 0);
  return (
    <Cell span={cellSpan} v={['ctl', highlight && 'hl']}>
      <GlassOptionSingleSelect
        value={value}
        groups={[
          {
            key: 'options',
            items: options.map((option) => ({
              value: option.value,
              label: option.label,
              description: option.description,
              icon: option.icon,
              title: option.title,
            })),
          },
        ]}
        onChange={(next) => {
          if (next !== value) onChange(next as T);
        }}
        disabled={disabled}
        ariaLabel={ariaLabel}
        testId={testId}
        className="w-full"
      />
    </Cell>
  );
}

export function ErrorRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <Cell v={['erow']} span={span}>
      <AlertCircle className="opg-ic h-3.5 w-3.5" />
      <span className="min-w-0">{children}</span>
    </Cell>
  );
}

export function WarningRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <Cell v={['wrow']} span={span}>
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0">{children}</span>
    </Cell>
  );
}

export function HintRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <Cell v={['hint']} span={span}>
      {children}
    </Cell>
  );
}

export function AddRow({
  span,
  label,
  onClick,
  disabled,
  extra,
}: {
  span: number;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cellClass(['add'])}
      style={spanStyle(span)}
      onClick={onClick}
      disabled={disabled}
    >
      <Plus className="opg-ic h-3.5 w-3.5" />
      {label}
      {extra}
    </button>
  );
}

export interface RowActionLabels {
  add: string;
  copy: string;
  remove: string;
  drag?: string;
}

/** Always-visible row actions: ＋ / 复制 / 删除 (and optional drag grip). */
export function RowActionsCell({
  labels,
  onAdd,
  onCopy,
  onRemove,
  canAdd = true,
  canRemove = true,
  dragHandle,
  extra,
}: {
  labels: RowActionLabels;
  onAdd?: () => void;
  onCopy?: () => void;
  onRemove?: () => void;
  canAdd?: boolean;
  canRemove?: boolean;
  dragHandle?: {
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
  };
  extra?: ReactNode;
}) {
  return (
    <Cell v={['acts']}>
      {extra}
      {onAdd ? (
        <button
          type="button"
          className="opg-act"
          onClick={onAdd}
          disabled={!canAdd}
          title={labels.add}
          aria-label={labels.add}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onCopy ? (
        <button
          type="button"
          className="opg-act"
          onClick={onCopy}
          disabled={!canAdd}
          title={labels.copy}
          aria-label={labels.copy}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="opg-act danger"
          onClick={onRemove}
          disabled={!canRemove}
          title={labels.remove}
          aria-label={labels.remove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {dragHandle ? (
        <span
          role="button"
          tabIndex={0}
          draggable
          className="opg-act cursor-grab"
          onDragStart={dragHandle.onDragStart}
          onDragEnd={dragHandle.onDragEnd}
          onKeyDown={dragHandle.onKeyDown}
          title={labels.drag}
          aria-label={labels.drag}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </Cell>
  );
}

/**
 * Text input with a local draft: commits on blur / Enter, Esc restores.
 * Per-keystroke config writes were the source of lost characters.
 */
export function GlassCommitTextInput({
  value,
  onCommit,
  placeholder,
  className = '',
  ariaLabel,
  ariaInvalid,
  disabled,
  onDraftChange,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  disabled?: boolean;
  /** Observe the uncommitted draft (e.g. for live validation). */
  onDraftChange?: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const skipCommitRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      disabled={disabled}
      className={`min-w-0 bg-transparent text-text-primary outline-none placeholder:text-text-muted ${className}`}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (skipCommitRef.current) {
          skipCommitRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          (event.target as HTMLInputElement).blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          skipCommitRef.current = true;
          setDraft(value);
          onDraftChange?.(value);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Scroll container for grid forms — flush, no reserved scrollbar gutter. */
export function FormScroll({ children }: { children?: ReactNode }) {
  return <div className="opg-scroll">{children}</div>;
}

/** Logical grid row (display: contents) — groups cells for drag-over / dragging state. */
export function GridRow({
  children,
  onDragOver,
  dragging,
  hover,
  compact,
  testId,
}: {
  children?: ReactNode;
  onDragOver?: (event: React.DragEvent) => void;
  dragging?: boolean;
  /** Tint the whole row on hover (list-style rows). */
  hover?: boolean;
  /** 32px list rows (field lists). */
  compact?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`opg-row${dragging ? ' dragging' : ''}${hover ? ' hov' : ''}${compact ? ' compact' : ''}`}
      onDragOver={onDragOver}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
