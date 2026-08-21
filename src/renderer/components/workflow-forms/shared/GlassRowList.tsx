import React from 'react';
import {
  Plus,
  Trash2,
  GripVertical,
  Copy,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';

export type RowAction = 'add' | 'copy' | 'remove' | 'moveUp' | 'moveDown' | 'toTop' | 'toBottom';

export interface GlassRowListColumn<T> {
  flex: string;
  header: string;
  render: (item: T, index: number) => ReactNode;
}

interface GlassRowListProps<T> {
  items: T[];
  columns: GlassRowListColumn<T>[];
  actions?: RowAction[];
  onAdd?: (index: number) => void;
  onRemove?: (index: number) => void;
  addTitle?: string;
  removeTitle?: string;
  copyTitle?: string;
  moveUpTitle?: string;
  moveDownTitle?: string;
  toTopTitle?: string;
  toBottomTitle?: string;
  onCopy?: (index: number) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  onToTop?: (index: number) => void;
  onToBottom?: (index: number) => void;
  canAct?: (action: RowAction, index: number) => boolean;
  renderExtraActions?: (index: number) => ReactNode;
  draggable?: boolean;
  onDragStart?: (index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: () => void;
  getRowOpacity?: (index: number) => boolean;
  dragTitle?: string;
  hideHeader?: boolean;
  headerClassName?: string;
}

const ACTION_ICON: Record<RowAction, React.ComponentType<{ className?: string }>> = {
  add: Plus,
  copy: Copy,
  remove: Trash2,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  toTop: ArrowUpToLine,
  toBottom: ArrowDownToLine,
};

const defaultActions: RowAction[] = ['add', 'remove'];

export function GlassRowList<T>({
  items,
  columns,
  actions = defaultActions,
  onAdd,
  onRemove,
  addTitle,
  removeTitle,
  copyTitle,
  moveUpTitle,
  moveDownTitle,
  toTopTitle,
  toBottomTitle,
  onCopy,
  onMoveUp,
  onMoveDown,
  onToTop,
  onToBottom,
  canAct,
  renderExtraActions,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  getRowOpacity,
  dragTitle,
  hideHeader,
  headerClassName,
}: GlassRowListProps<T>) {
  const tr = useFormTranslation();

  function getActionLabel(action: RowAction): string {
    switch (action) {
      case 'add':
        return addTitle ?? tr('addRow');
      case 'remove':
        return removeTitle ?? tr('removeRow');
      case 'copy':
        return copyTitle ?? tr('copyRow');
      case 'moveUp':
        return moveUpTitle ?? tr('moveUp');
      case 'moveDown':
        return moveDownTitle ?? tr('moveDown');
      case 'toTop':
        return toTopTitle ?? tr('toTop');
      case 'toBottom':
        return toBottomTitle ?? tr('toBottom');
    }
  }
  const extraActionsWidth = renderExtraActions ? 32 : 0;
  const actionsWidth = actions.length * 28 + (actions.length - 1) * 4 + extraActionsWidth;

  return (
    <div className="flex flex-col gap-2">
      {!hideHeader && (
        <div
          className={`flex items-center gap-1 px-0.5 pb-0.5 font-medium text-text-muted ${headerClassName ?? ''}`}
        >
          {draggable && (
            <span
              className="flex h-7 w-6 flex-shrink-0 items-center justify-center"
              aria-hidden="true"
            />
          )}
          {columns.map((col, i) => (
            <span
              key={i}
              className={`flex items-center justify-center ${col.flex} min-w-0 text-center`}
            >
              {col.header}
            </span>
          ))}
          <span className="flex flex-shrink-0" style={{ width: actionsWidth }} aria-hidden="true" />
        </div>
      )}

      {items.map((item, index) => (
        <div
          key={index}
          className={`flex min-h-8 items-center gap-1 px-0.5 ${
            draggable ? 'rounded transition-colors hover:bg-surface-hover/40' : ''
          } ${getRowOpacity?.(index) ? 'opacity-50' : ''}`}
          onDragOver={draggable ? (e) => onDragOver?.(e, index) : undefined}
        >
          {draggable && (
            <div
              draggable
              onDragStart={() => onDragStart?.(index)}
              onDragEnd={() => onDragEnd?.()}
              className="flex h-7 w-6 flex-shrink-0 cursor-grab items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30 active:cursor-grabbing"
              title={dragTitle ?? tr('dragToReorder')}
              aria-label={dragTitle ?? tr('dragToReorder')}
            >
              <GripVertical className="h-4 w-4" />
            </div>
          )}

          {columns.map((col, i) => (
            <div key={i} className={`flex items-center justify-center ${col.flex} min-w-0`}>
              <div className="w-full flex">{col.render(item, index)}</div>
            </div>
          ))}

          <div className="flex items-center gap-1 flex-shrink-0">
            {renderExtraActions?.(index)}
            {actions.map((action) => {
              const Icon = ACTION_ICON[action];
              const disabled = canAct !== undefined && !canAct(action, index);
              const label = getActionLabel(action);
              const handler = () => {
                switch (action) {
                  case 'add':
                    return onAdd?.(index);
                  case 'remove':
                    return onRemove?.(index);
                  case 'copy':
                    return onCopy?.(index);
                  case 'moveUp':
                    return onMoveUp?.(index);
                  case 'moveDown':
                    return onMoveDown?.(index);
                  case 'toTop':
                    return onToTop?.(index);
                  case 'toBottom':
                    return onToBottom?.(index);
                }
              };
              return (
                <button
                  key={action}
                  type="button"
                  onClick={handler}
                  disabled={disabled}
                  className={`inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : action === 'remove'
                        ? 'text-text-muted hover:text-error hover:bg-error/10'
                        : 'text-text-muted hover:bg-surface-hover hover:text-accent'
                  }`}
                  title={label}
                  aria-label={label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
