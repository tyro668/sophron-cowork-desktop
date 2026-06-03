import { useEffect, useRef, type RefObject } from 'react';

type DismissibleLayerOptions = {
  open: boolean;
  refs: Array<RefObject<HTMLElement | null>>;
  onDismiss: () => void;
  enabled?: boolean;
};

export function useDismissibleLayer({
  open,
  refs,
  onDismiss,
  enabled = true,
}: DismissibleLayerOptions) {
  const refsRef = useRef(refs);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    refsRef.current = refs;
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!enabled || !open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const isInside = refsRef.current.some((ref) => ref.current?.contains(target));
      if (!isInside) {
        onDismissRef.current();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissRef.current();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, open]);
}
