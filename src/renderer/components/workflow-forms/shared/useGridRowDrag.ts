import { useCallback, useEffect, type DragEvent, type KeyboardEvent } from 'react';
import { useDragReorder } from '../../../hooks/useDragReorder';

/**
 * Drag-reorder wiring for FormGrid rows. Rows are `display: contents` wrappers,
 * so drag-over events from any cell in the row bubble to the row.
 */
export function useGridRowDrag<T>(items: T[], onChange: (next: T[]) => void) {
  const {
    activeItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(items, onChange);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [items, isDragging, resetDrag]);

  const rowProps = useCallback(
    (index: number) => ({
      onDragOver: (event: DragEvent) => handleDragOver(event, index),
      dragging: Boolean(isDragging && dragIndexRef.current === index),
    }),
    [dragIndexRef, handleDragOver, isDragging]
  );

  const dragHandle = useCallback(
    (index: number) => ({
      onDragStart: (event: DragEvent) => {
        event.dataTransfer?.setData('text/plain', String(index));
        handleDragStart(index);
      },
      onDragEnd: () => handleDragEnd(),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? 'up' : 'down';
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= activeItems.length) return;
        handleKeyboardMove(index, direction);
      },
    }),
    [activeItems.length, handleDragEnd, handleDragStart, handleKeyboardMove]
  );

  return { activeItems, rowProps, dragHandle };
}
