import { useCallback, useEffect, useRef, useState } from 'react';

export interface DropdownPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  minWidth?: number;
}

/** Gap kept between the panel and the viewport edge when measuring space. */
const VIEWPORT_MARGIN = 4;
/** Gap between the trigger's edge and the floating panel. */
const TRIGGER_GAP = 2;
const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT = 240;
/** Minimum viewport space below the trigger for the panel to open downward. */
const MIN_DROP_SPACE = 140;

export interface DropdownPlacement {
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Shared placement rule for dropdown panels: prefer opening below the trigger,
 *  flip above it when the viewport below is too tight, and clamp the panel
 *  height to the space available on the chosen side. */
export function computeDropdownPlacement(rect: DOMRect): DropdownPlacement {
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const preferDown = spaceBelow >= MIN_DROP_SPACE;
  return {
    top: preferDown ? rect.bottom + TRIGGER_GAP : undefined,
    bottom: preferDown ? undefined : window.innerHeight - rect.top + TRIGGER_GAP,
    maxHeight: Math.min(
      MAX_PANEL_HEIGHT,
      Math.max(MIN_PANEL_HEIGHT, preferDown ? spaceBelow : spaceAbove)
    ),
  };
}

export function useDropdown() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const [maxHeight, setMaxHeight] = useState(MAX_PANEL_HEIGHT);

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

  // The panel is position:fixed in document.body and JS repositioning lags
  // compositor scrolling, so close on container scroll instead of following.
  // Capture phase catches scrolls of inner containers (scroll events do not
  // bubble); scrolling inside the panel's own option list stays open.
  useEffect(() => {
    if (!open) return;
    const handleScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
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
