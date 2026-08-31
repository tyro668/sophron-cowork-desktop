import { useCallback, useRef, useState } from 'react';

export type ReorderDirection = 'up' | 'down';

export function getReorderTargetIndex(
  itemCount: number,
  index: number,
  direction: ReorderDirection
): number | null {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  return index >= 0 && index < itemCount && targetIndex >= 0 && targetIndex < itemCount
    ? targetIndex
    : null;
}

export function reorderItem<T>(
  items: readonly T[],
  index: number,
  direction: ReorderDirection
): T[] | null {
  const targetIndex = getReorderTargetIndex(items.length, index, direction);
  if (targetIndex === null) return null;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function useDragReorder<T>(
  items: T[],
  onCommit: (reordered: T[]) => void,
  snapshotSource?: T[]
) {
  const dragIndexRef = useRef<number | null>(null);
  const [dragState, setDragState] = useState<T[] | null>(null);

  const activeItems = dragState ?? items;

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragState([...(snapshotSource ?? items)]);
    },
    [items, snapshotSource]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragState((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragState && dragIndexRef.current !== null) {
      onCommit(dragState);
    }
    dragIndexRef.current = null;
    setDragState(null);
  }, [dragState, onCommit]);

  const handleKeyboardMove = useCallback(
    (index: number, direction: ReorderDirection) => {
      const reordered = reorderItem(snapshotSource ?? items, index, direction);
      if (reordered) onCommit(reordered);
    },
    [items, onCommit, snapshotSource]
  );

  const resetDrag = useCallback(() => {
    dragIndexRef.current = null;
    setDragState(null);
  }, []);

  return {
    activeItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    resetDrag,
    isDragging: dragState !== null,
    dragIndexRef,
  };
}
