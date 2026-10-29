/** Minimal RFC 4180 CSV parsing for script output validation (quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** JSON output: an array of flat objects (or `{ rows: [...] }`). Columns keep first-seen order. */
export function jsonRowsToCsv(text: string): string {
  const parsed: unknown = JSON.parse(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (!rows) throw new Error('JSON 输出必须是对象数组');
  const columns: string[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('JSON 输出的每一项都必须是对象');
    }
    for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const item of rows as Array<Record<string, unknown>>) {
    lines.push(columns.map((column) => csvCell(item[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export interface ParsedScriptOutput {
  csv: string;
  columns: string[];
  rows: number;
}

export function readScriptOutput(
  text: string,
  format: 'csv' | 'json',
  requiredColumns: string[] = []
): ParsedScriptOutput {
  const csv = format === 'json' ? jsonRowsToCsv(text) : text;
  const table = parseCsv(csv);
  if (table.length === 0) throw new Error('结果文件为空');
  const columns = table[0].map((column) => column.trim());
  if (columns.every((column) => !column)) throw new Error('结果文件缺少表头');
  const missing = requiredColumns.filter((column) => !columns.includes(column));
  if (missing.length > 0) throw new Error(`结果缺少列：${missing.join('、')}`);
  return { csv, columns, rows: table.length - 1 };
}
