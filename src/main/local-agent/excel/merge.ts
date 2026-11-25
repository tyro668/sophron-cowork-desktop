/**
 * 合并表的表头 / 数据合并，对应 Java `IndexMerge`（按字段顺序合并）与 `NameMerge`
 * （按字段名称合并），以及 `ExcelFieldsHook` 的冻结表头逻辑（maxHeadSize）。
 */
import { FieldType, type CellData } from './field-type';

export interface MergeAppender {
  appendHeaderNames(result: CellData[] | null, current: CellData[]): CellData[];
  appendHeaderTypes(result: CellData[], current: CellData[]): CellData[];
  appendRow(
    result: CellData[] | null,
    current: CellData[],
    row: (string | null)[],
    sys: [string, string, string]
  ): (string | null)[];
}

function normalizeYmd(cell: CellData): void {
  if (cell.type === FieldType.YEAR_MONTH_DAY) cell.type = FieldType.DATE;
}

function mergeType(pre: CellData, cur: CellData): void {
  normalizeYmd(pre);
  normalizeYmd(cur);
  if (pre.type === FieldType.INFER) pre.type = cur.type;
  else if (pre.type !== cur.type && cur.type !== FieldType.INFER) pre.type = FieldType.STRING;
}

/** `IndexMerge`。 */
export class IndexMerge implements MergeAppender {
  appendHeaderNames(result: CellData[] | null, current: CellData[]): CellData[] {
    if (result === null) return current.map((c) => ({ ...c }));
    if (result.length < current.length) {
      return [...result, ...current.slice(result.length).map((c) => ({ ...c }))];
    }
    return result;
  }

  appendHeaderTypes(result: CellData[], current: CellData[]): CellData[] {
    for (let i = 0; i < Math.min(result.length, current.length); i++) {
      mergeType(result[i], { ...current[i] });
    }
    return result;
  }

  appendRow(
    _result: CellData[] | null,
    _current: CellData[],
    row: (string | null)[],
    sys: [string, string, string]
  ): (string | null)[] {
    return [...row, ...sys];
  }
}

/** `NameMerge`。 */
export class NameMerge implements MergeAppender {
  appendHeaderNames(result: CellData[] | null, current: CellData[]): CellData[] {
    if (result === null) return current.map((c) => ({ ...c }));
    const names = new Set(result.map((c) => c.data));
    const out = [...result];
    for (const c of current) if (!names.has(c.data)) out.push({ ...c });
    return out;
  }

  appendHeaderTypes(result: CellData[], current: CellData[]): CellData[] {
    const byName = new Map(result.map((c) => [c.data, c]));
    for (const cur of current) {
      const pre = byName.get(cur.data);
      if (pre) mergeType(pre, { ...cur });
    }
    return result;
  }

  appendRow(
    result: CellData[] | null,
    current: CellData[],
    row: (string | null)[],
    sys: [string, string, string]
  ): (string | null)[] {
    if (result === null) return [...row, ...sys];
    const index = new Map<string, number>();
    result.forEach((c, i) => {
      if (!index.has(c.data)) index.set(c.data, i);
    });
    const out = new Array<string | null>(result.length + 3).fill(null);
    for (let i = 0; i < current.length; i++) {
      const at = index.get(current[i].data);
      if (at !== undefined) out[at] = row[i] ?? null;
    }
    out[result.length] = sys[0];
    out[result.length + 1] = sys[1];
    out[result.length + 2] = sys[2];
    return out;
  }
}

export function createAppender(appendStrategy: number, manual: boolean): MergeAppender {
  return manual && appendStrategy === 1 ? new NameMerge() : new IndexMerge();
}
