/**
 * Header detection for cloud drive file previews.
 *
 * The drive API returns raw sheet rows where merged cells are filled with the
 * merged value (e.g. a title spanning every column). Using rows[0] as the
 * header then yields identical column names and the record-keyed preview
 * shows the same value in every column. This module:
 *  - skips leading title / note / blank rows (rows with fewer than 2 distinct non-empty values),
 *  - merges a two-row header (parent row with repeated merged labels + sub-header row),
 *  - de-duplicates column names.
 */

type Cell = unknown;

function text(cell: Cell): string {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function distinctNonEmpty(row: Cell[]): string[] {
  return [...new Set(row.map(text).filter(Boolean))];
}

function isNumericLike(value: string): boolean {
  return /^[-+]?[¥$]?[\d,]+(\.\d+)?%?$/.test(value);
}

export interface DetectedDriveHeader {
  columns: string[];
  /** Index of the first data row in the original rows array. */
  dataStart: number;
}

export function detectDriveFileHeader(rows: Cell[][], columnCount: number): DetectedDriveHeader {
  const width = Math.max(
    columnCount,
    ...rows.slice(0, 20).map((r) => (Array.isArray(r) ? r.length : 0))
  );
  const at = (r: number) => (Array.isArray(rows[r]) ? rows[r] : []);
  let h = 0;
  // Skip leading title/blank rows, but never beyond the first 20 rows or the last row.
  while (h < Math.min(rows.length - 1, 20) && width > 1 && distinctNonEmpty(at(h)).length < 2) h++;
  if (distinctNonEmpty(at(h)).length < 2 && width > 1) h = 0;

  const header = Array.from({ length: width }, (_, i) => text(at(h)[i]));
  let dataStart = h + 1;
  let names = header;

  const parentRepeats = header.some((v, i) => v && i > 0 && header[i - 1] === v);
  const sub = Array.from({ length: width }, (_, i) => text(at(h + 1)[i]));
  const subFilled = sub.filter(Boolean);
  const subLooksLikeHeader =
    rows.length > h + 2 &&
    subFilled.length > 0 &&
    subFilled.every((v) => !isNumericLike(v)) &&
    // Sub-header cells only sit under merged (repeated) parents, or under empty parents.
    sub.every((v, i) => {
      if (!v) return true;
      const p = header[i];
      return !p || header[i - 1] === p || header[i + 1] === p;
    });
  if (parentRepeats && subLooksLikeHeader) {
    names = header.map((p, i) => {
      const s = sub[i];
      if (!s) return p;
      if (!p) return s;
      const merged = header[i - 1] === p || header[i + 1] === p;
      return merged ? `${p}_${s}` : p;
    });
    dataStart = h + 2;
  }

  const seen = new Map<string, number>();
  const columns = names.map((name, index) => {
    const base = name || `col_${index + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  return { columns, dataStart };
}
