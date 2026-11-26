/**
 * Compute up to 5 consecutive page numbers centered around `currentPage`.
 */
export function getVisiblePageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 1) return [1];
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}
