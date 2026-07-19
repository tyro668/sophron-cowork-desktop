import { useCallback, useEffect, useRef, useState } from 'react';

export interface DropdownPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  minWidth?: number;
}

export function useDropdown() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const [maxHeight, setMaxHeight] = useState(240);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [open, close]);

  return {
    open,
    setOpen,
    position,
    setPosition,
    maxHeight,
    setMaxHeight,
    triggerRef,
    dropdownRef,
    close,
  };
}
