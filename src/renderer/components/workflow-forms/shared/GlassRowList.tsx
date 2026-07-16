import React from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';

export interface GlassRowListColumn<T> {
  flex: string;
  header: string;
  render: (item: T, index: number) => ReactNode;
}

interface GlassRowListProps<T> {
  items: T[];
  columns: GlassRowListColumn<T>[];
  onAdd: (index: number) => void;
  onRemove: (index: number) => void;
  addTitle: string;
  removeTitle: string;
  draggable?: boolean;
  onDragStart?: (index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: () => void;
  getRowOpacity?: (index: number) => boolean;
  dragTitle?: string;
  hideHeader?: boolean;
  hideActions?: boolean;
}

export function GlassRowList<T>({
  items,
  columns,
  onAdd,
  onRemove,
  addTitle,
  removeTitle,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  getRowOpacity,
  dragTitle = '拖拽排序',
  hideHeader,
  hideActions,
}: GlassRowListProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center gap-1 px-0.5 pb-0.5 text-[13px] font-medium text-text-muted">
          {draggable && (
            <span
              className="flex h-6 w-4 flex-shrink-0 items-center justify-center"
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
          <span className="flex h-6 w-[3.25rem] flex-shrink-0" aria-hidden="true" />
        </div>
      )}

      {/* Rows */}
      {items.map((item, index) => (
        <div
          key={index}
          className={`flex items-center gap-1 px-0.5 ${
            draggable ? 'rounded transition-colors hover:bg-surface-hover/40' : ''
          } ${getRowOpacity?.(index) ? 'opacity-50' : ''}`}
          onDragOver={draggable ? (e) => onDragOver?.(e, index) : undefined}
        >
          {/* Drag handle */}
          {draggable && (
            <div
              draggable
              onDragStart={() => onDragStart?.(index)}
              onDragEnd={() => onDragEnd?.()}
              className="flex h-6 w-4 flex-shrink-0 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
              title={dragTitle}
              aria-label={dragTitle}
            >
              <GripVertical className="h-4 w-4" />
            </div>
          )}

          {/* Column cells */}
          {columns.map((col, i) => (
            <div key={i} className={`flex items-center justify-center ${col.flex} min-w-0`}>
              <div className="w-full flex">{col.render(item, index)}</div>
            </div>
          ))}

          {/* Default actions */}
          {!hideActions && (
            <>
              <button
                type="button"
                onClick={() => onAdd(index)}
                className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                title={addTitle}
                aria-label={addTitle}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                title={removeTitle}
                aria-label={removeTitle}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
