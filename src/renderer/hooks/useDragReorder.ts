import { useCallback, useRef, useState } from 'react';

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

  const resetDrag = useCallback(() => {
    dragIndexRef.current = null;
    setDragState(null);
  }, []);

  return {
    activeItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    resetDrag,
    isDragging: dragState !== null,
    dragIndexRef,
  };
}
