import { useEffect, useRef } from 'react';

/**
 * Ensures a row list has at least one row by committing an empty row on mount
 * when the initial items array is empty. Centralizes the "auto-init empty row"
 * pattern previously duplicated across FormSort, FormFieldMapping, etc.
 *
 * - Runs only on mount (empty dependency array semantics)
 * - If `items.length > 0`, no commit happens
 * - If `items.length === 0`, calls `commit([emptyRow()])` once
 * - Safe against Strict Mode double-mount: uses an internal ref guard
 */
export function useEnsureOneRow<T>(
  items: T[],
  commit: (next: T[]) => void,
  emptyRow: () => T
): void {
  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (items.length === 0) {
      commit([emptyRow()]);
    }
    // Intentionally run only on mount — callers pass stable commit/emptyRow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
