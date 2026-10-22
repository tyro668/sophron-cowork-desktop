/**
 * `over` suggestions after an aggregate call: `avg([销售额]) ▌` → `over ()` (all rows) or
 * `over (by: […])` (per group). Shared by the jflow editors and the form expression inputs.
 */
import { lookupExpressionFunction } from './functions';
import { parseExpression } from './parser';

export interface WindowSuggestion {
  /** Start offset of the word being completed (equals `before.length` when none yet). */
  from: number;
  options: Array<{ label: string; apply: string; detail: string }>;
}

const IF_AGG = new Set(['sumif', 'countif', 'avgif', 'minif', 'maxif']);

/** Name of the call whose closing paren is the last char of `text`, if any. */
function callEndingAt(text: string): string | null {
  if (!text.endsWith(')')) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === ']') {
      quote = ch === ']' ? '[' : "'";
      continue;
    }
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) return /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text.slice(0, i))?.[1] ?? null;
    }
  }
  return null;
}

export function isWindowableFunction(name: string): boolean {
  const lower = name.toLowerCase();
  if (IF_AGG.has(lower)) return false;
  const kind = lookupExpressionFunction(lower)?.kind;
  return kind === 'aggregate' || kind === 'window';
}

export function windowSuggestionAt(before: string): WindowSuggestion | null {
  const word = /([A-Za-z_]*)$/.exec(before)![1];
  if (word && !'over'.startsWith(word.toLowerCase())) return null;
  const head = before.slice(0, before.length - word.length);
  if (!/\s$/.test(head)) return null;
  const name = callEndingAt(head.trimEnd());
  if (!name || !isWindowableFunction(name)) return null;
  return {
    from: before.length - word.length,
    options: [
      { label: 'over ()', apply: 'over ()', detail: '窗口值：全部行' },
      { label: 'over (by: …)', apply: 'over (by: ', detail: '窗口值：按分组字段' },
    ],
  };
}

export interface WindowValueDescription {
  function: string;
  partitionBy: string[];
  orderBy: string[];
  /** e.g. `avg · 全部行` / `sum · 按 区域`. */
  label: string;
}

/**
 * First window value in an expression (`avg([销售额]) over (by: [区域])`), for field lists and
 * lineage. Returns null for expressions without `over`.
 */
export function describeWindowValue(expression: string): WindowValueDescription | null {
  let ast: unknown;
  try {
    ast = parseExpression(expression);
  } catch {
    return null;
  }
  let found: WindowValueDescription | null = null;
  const fieldName = (e: unknown): string => {
    const node = e as { k?: string; name?: string };
    return node?.k === 'field' && node.name ? node.name : '…';
  };
  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as {
      k?: string;
      name?: string;
      over?: { partitionBy: unknown[]; orderBy: Array<{ expr: unknown; direction?: string }> };
    };
    if (node.k === 'call' && node.over && node.name) {
      const partitionBy = node.over.partitionBy.map(fieldName);
      const orderBy = node.over.orderBy.map(
        (item) => `${item.direction === 'DESC' ? '-' : ''}${fieldName(item.expr)}`
      );
      found = {
        function: node.name.toLowerCase(),
        partitionBy,
        orderBy,
        label: `${node.name.toLowerCase()} · ${partitionBy.length ? `按 ${partitionBy.join('、')}` : '全部行'}${
          orderBy.length ? ` · 排序 ${orderBy.join('、')}` : ''
        }`,
      };
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(ast);
  return found;
}
