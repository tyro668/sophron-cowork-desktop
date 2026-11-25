/**
 * 字段类型推断与取值规范化，移植自 hihidata-excel（3.0.4）：
 * `FieldType`、`ExcelUtils.format/normalizeSpace/parseExcelValueType/buildFrom`、
 * `DateParserContext`、`ExcelFieldTypeParser`、`ExcelFieldsHelper.getTreatedFieldNames`，
 * 以及 hihidata-agent `ExcelMeta.speType`。
 */

export enum FieldType {
  INFER = 'INFER',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  YEAR_MONTH_DAY = 'YEAR_MONTH_DAY',
}

export function isDateFieldType(type: FieldType): boolean {
  return type === FieldType.DATE || type === FieldType.YEAR_MONTH_DAY;
}

/** `ProjectConstants.Column`：云端列类型编码。 */
export const ColumnType = {
  Bool: 1,
  Int: 2,
  Float: 3,
  Long: 4,
  Double: 5,
  String: 6,
  Date: 7,
  Time: 8,
  Timestamp: 9,
  Decimal: 10,
} as const;

/** `ExcelMeta.speType`：STRING→6，NUMBER→5，DATE→9，其它（INFER / YEAR_MONTH_DAY）→6。 */
export function speType(type: FieldType): number {
  switch (type) {
    case FieldType.STRING:
      return ColumnType.String;
    case FieldType.NUMBER:
      return ColumnType.Double;
    case FieldType.DATE:
      return ColumnType.Timestamp;
    default:
      return ColumnType.String;
  }
}

export interface CellData {
  data: string;
  type: FieldType;
}

const MAX_STRING_LENGTH = 10000;
const SPACE_CHARS = new Set([' ', '\u3000', '\u00a0', '\u2007', '\u202f']);
const ERRORS = new Set(['#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NUM!', '#REF!', '#NULL!']);
const NUMBER_REGEX = /^[+-]?([1-9]([0-9]*)|0)(\.[0-9]+)?%?$/;
const PHONE_NUMBER_REGEX = /^1[3-9]\d{9}$/;
const NUM_PATTERN = /[0#]+/;
const WEEKDAY_DATE_FORMAT_PATTERN = /^(\[[^\]]+])*a{3,4}(;@)?$/;

/** Java `Character.isWhitespace`（不含不间断空格，与 JDK 一致）。 */
function isJavaWhitespace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c === 0x00a0 || c === 0x2007 || c === 0x202f) return false;
  if ((c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x20)) return true;
  return (
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x2006) ||
    (c >= 0x2008 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Java `String.trim()`：去掉首尾 ≤ U+0020 的字符。 */
export function javaTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return start === 0 && end === s.length ? s : s.slice(start, end);
}

/** `ExcelUtils.normalizeSpace`：各种空白统一为半角空格、去掉 BOM、trim（不合并连续空格）。 */
export function normalizeSpace(str: string): string {
  if (!str) return str;
  let out = '';
  for (const ch of str) {
    if (ch.length === 1 && (isJavaWhitespace(ch) || SPACE_CHARS.has(ch))) out += ' ';
    else if (ch === '\ufeff') continue;
    else out += ch;
  }
  return javaTrim(out);
}

/** `ExcelUtils.format`：超长（>10000）置空、错误值置空、空白规范化。 */
export function formatExcelValue(data: string | null | undefined): string {
  if (!data) return '';
  if (data.length > MAX_STRING_LENGTH) return '';
  const normalized = normalizeSpace(data);
  return ERRORS.has(normalized) ? '' : normalized;
}

/** EasyExcel `XmlConvert.utfDecode`：还原 `_xHHHH_` 转义（`_x005F_` 本身表示下划线）。 */
export function utfDecode(value: string): string {
  if (!value || value.indexOf('_x') < 0) return value;
  return value.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

export function formatOnlyExcelData(data: string | null | undefined): string {
  return utfDecode(formatExcelValue(data));
}

// ---------------------------------------------------------------------------
// 日期识别（DateParserContext）
// ---------------------------------------------------------------------------

const MONTH_LIST = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

class Cursor {
  hasError = false;
  dateOnly = false;
  private index = 0;
  c = '\u0000';

  constructor(readonly s: string) {}

  setError(): void {
    if (this.hasError) return;
    this.hasError = true;
    this.index = this.s.length;
    this.c = '\u0000';
  }

  private previous(): void {
    if (this.index === 0) {
      this.setError();
      return;
    }
    if (this.hasError) return;
    this.index--;
  }

  private next(): void {
    if (this.index === this.s.length) {
      this.c = '\u0000';
      this.index++;
      return;
    }
    if (this.index > this.s.length) {
      this.setError();
      return;
    }
    this.c = this.s.charAt(this.index);
    this.index++;
  }

  readEOF(): void {
    this.next();
    if (this.c !== '\u0000') this.setError();
  }

  readInt(min: number, max = min): number {
    let ret = 0;
    for (let i = 0; i < max; i++) {
      this.next();
      if (this.c < '0' || this.c > '9') {
        if (i < min) {
          this.setError();
          return 0;
        }
        this.previous();
        break;
      }
      ret = ret * 10 + (this.c.charCodeAt(0) - 48);
    }
    return ret;
  }

  readLetter(min: number, max = min): string {
    let ret = '';
    for (let i = 0; i < max; i++) {
      this.next();
      if (!/\p{L}/u.test(this.c)) {
        if (i < min) {
          this.setError();
          return '';
        }
        this.previous();
        break;
      }
      ret += this.c;
    }
    return ret;
  }

  read(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.next();
      if (str.charAt(i) !== this.c) {
        this.setError();
        return;
      }
    }
  }

  build(year: number, month: number, day: number): number {
    this.dateOnly = true;
    if (this.hasError) return -1;
    if (month > 12 || month === 0 || day > 31 || day === 0) {
      this.setError();
      return -1;
    }
    return new Date(year, month - 1, day, 0, 0, 0).getTime();
  }

  buildTime(y: number, mo: number, d: number, h: number, mi: number, s: number, ms = 0): number {
    this.dateOnly = false;
    if (h < 0 || h >= 24 || mi < 0 || mi >= 60 || s < 0 || s >= 60) {
      this.setError();
      return -1;
    }
    const ret = this.build(y, mo, d);
    this.dateOnly = false;
    if (this.hasError) return -1;
    return ret + (s + mi * 60 + h * 3600) * 1000 + ms;
  }
}

type DateParser = (c: Cursor) => number;

function ymd(c: Cursor, sep: string): [number, number, number] {
  const year = c.readInt(4);
  c.read(sep);
  const month = c.readInt(1, 2);
  c.read(sep);
  const day = c.readInt(1, 2);
  return [year, month, day];
}

function hms(c: Cursor, withSeconds = true): [number, number, number] {
  const h = c.readInt(1, 2);
  c.read(':');
  const m = c.readInt(1, 2);
  let s = 0;
  if (withSeconds) {
    c.read(':');
    s = c.readInt(1, 2);
  }
  return [h, m, s];
}

/** Java `Double.parseDouble` 可接受的十进制写法（含 NaN/Infinity、f/d 后缀、首尾空白）。 */
const JAVA_DOUBLE_BODY = /^[+-]?(NaN|Infinity|((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)[fFdD]?)$/;

/** Java `Double.parseDouble` 会先 trim（去掉 ≤ U+0020 的首尾字符）。 */
function isJavaDouble(s: string): boolean {
  return JAVA_DOUBLE_BODY.test(javaTrim(s));
}

const DATE_PARSERS: DateParser[] = [
  (c) => {
    const [y, m, d] = ymd(c, '-');
    c.readEOF();
    return c.build(y, m, d);
  },
  (c) => {
    const [y, m, d] = ymd(c, '/');
    c.readEOF();
    return c.build(y, m, d);
  },
  (c) => {
    const y = c.readInt(4);
    c.read('年');
    const m = c.readInt(1, 2);
    c.read('月');
    const d = c.readInt(1, 2);
    c.read('日');
    c.readEOF();
    return c.build(y, m, d);
  },
  (c) => {
    const m = c.readInt(1, 2);
    c.read('/');
    const d = c.readInt(1, 2);
    c.read('/');
    const y = c.readInt(4);
    c.readEOF();
    return c.build(y, m, d);
  },
  (c) => {
    const y = c.readInt(4);
    const m = c.readInt(1, 2);
    const d = c.readInt(1, 2);
    c.readEOF();
    return c.build(y, m, d);
  },
  (c) => {
    const [y, m, d] = ymd(c, '-');
    c.read(' ');
    const h = c.readInt(1, 2);
    c.readEOF();
    return c.buildTime(y, m, d, h, 0, 0);
  },
  (c) => {
    const y = c.readInt(4);
    const m = c.readInt(1, 2);
    const d = c.readInt(1, 2);
    c.read(' ');
    const [h, mi, s] = hms(c);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s);
  },
  (c) => {
    const y = c.readInt(4);
    const m = c.readInt(1, 2);
    const d = c.readInt(1, 2);
    c.read(' ');
    const [h, mi] = hms(c, false);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, 0);
  },
  (c) => {
    const m = c.readInt(1, 2);
    c.read('/');
    const d = c.readInt(1, 2);
    c.read('/');
    const y = c.readInt(4);
    c.read(' ');
    const [h, mi, s] = hms(c);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s);
  },
  (c) => {
    const [y, m, d] = ymd(c, '/');
    c.read(' ');
    const [h, mi, s] = hms(c);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s);
  },
  (c) => {
    const [y, m, d] = ymd(c, '-');
    c.read(' ');
    const [h, mi, s] = hms(c);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s);
  },
  (c) => {
    const [y, m, d] = ymd(c, '-');
    c.read(' ');
    const [h, mi, s] = hms(c);
    c.read('.');
    const ms = c.readInt(1, 3);
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s, ms);
  },
  (c) => {
    const [y, m, d] = ymd(c, '-');
    c.read('T');
    const [h, mi, s] = hms(c);
    c.read('Z');
    c.readEOF();
    return c.buildTime(y, m, d, h, mi, s);
  },
  (c) => {
    const month = MONTH_LIST.indexOf(c.readLetter(3).toLowerCase()) + 1;
    if (month === 0) {
      c.setError();
      return 0;
    }
    c.read(' ');
    const d = c.readInt(1, 2);
    c.read(',');
    const y = c.readInt(4);
    c.read(' ');
    const [h0, mi, s] = hms(c);
    let h = h0;
    c.read(' ');
    const ampm = c.readLetter(2).toLowerCase();
    if (ampm === 'pm') {
      if (h < 1 || h > 12) return 0;
      if (h !== 12) h += 12;
    } else if (ampm === 'am') {
      if (h < 1 || h > 12) return 0;
      if (h === 12) h = 0;
    }
    return c.buildTime(y, month, d, h, mi, s);
  },
  (c) => {
    const s = c.s;
    if (!isJavaDouble(s)) {
      c.setError();
      return 0;
    }
    const value = Number(javaTrim(s).replace(/[fFdD]$/, ''));
    if (value >= 1e9) return Math.trunc(value);
    if (value > -4.9e-324 && value < 2958466.0) return excelSerialToMillis(value);
    c.setError();
    return 0;
  },
];

/** `ExcelUtils.getJavaDate`（1900 日期系统，本地时区）。 */
export function excelSerialToMillis(date: number): number {
  if (date < 36526.0) {
    const wholeDays = Math.floor(date);
    const msInDay = Math.trunc((date - wholeDays) * 8.64e7 + 0.5);
    const dayAdjust = wholeDays < 61 ? 0 : -1;
    return new Date(1900, 0, wholeDays + dayAdjust, 0, 0, 0, msInDay).getTime();
  }
  return Math.trunc(946656000000 + 86400000 * (date - 36526.0));
}

/** `DateParserContext`：记住上一次成功的格式，优先用它解析。 */
export class DateParserContext {
  private previous: DateParser | null = null;
  private previousDateOnly = false;

  parse(value: string): number | null {
    const prev = this.previous;
    this.previous = null;
    this.previousDateOnly = false;
    const candidates = prev ? [prev, ...DATE_PARSERS.filter((p) => p !== prev)] : DATE_PARSERS;
    for (const parser of candidates) {
      const cursor = new Cursor(value);
      const ret = parser(cursor);
      if (cursor.hasError) continue;
      this.previous = parser;
      this.previousDateOnly = cursor.dateOnly;
      return ret;
    }
    return null;
  }

  wasDateOnly(): boolean {
    return this.previousDateOnly;
  }
}

/** `ExcelUtils.parseExcelValueType`。 */
export function parseExcelValueType(v: string, context: DateParserContext): FieldType {
  const escape = v.replace(/,/g, '');
  if (NUMBER_REGEX.test(escape)) {
    if (escape.includes('.')) return FieldType.NUMBER;
    if (escape.length > 15 || PHONE_NUMBER_REGEX.test(escape)) return FieldType.STRING;
    return FieldType.NUMBER;
  }
  if (context.parse(v) !== null) {
    return context.wasDateOnly() ? FieldType.YEAR_MONTH_DAY : FieldType.DATE;
  }
  return FieldType.STRING;
}

// ---------------------------------------------------------------------------
// 单元格格式 → 类型（ExcelUtils.buildFrom / isDateFormat）
// ---------------------------------------------------------------------------

export type DateFormatTester = (format: string) => boolean;

/**
 * `ExcelUtils.buildFrom`：常规格式→INFER，文本（49 / "@"）→STRING，日期格式→DATE，
 * 含 0/# 的数字格式→NUMBER，其它→INFER。`isDateFormat` 由调用方注入（SheetJS SSF.is_date）。
 */
export function fieldTypeFromFormat(
  format: string | undefined,
  formatIndex: number | undefined,
  isDateFormat: DateFormatTester
): FieldType {
  if (format === undefined || format === null) return FieldType.INFER;
  if (formatIndex === 0 || format === 'General' || format === '') return FieldType.INFER;
  if (formatIndex === 49 || format === '@') return FieldType.STRING;
  if (isDateFormat(format) || WEEKDAY_DATE_FORMAT_PATTERN.test(format)) return FieldType.DATE;
  if (NUM_PATTERN.test(format)) return FieldType.NUMBER;
  return FieldType.INFER;
}

// ---------------------------------------------------------------------------
// ExcelFieldTypeParser
// ---------------------------------------------------------------------------

export class ExcelFieldTypeParser {
  private rowCount = 0;
  private readonly votes: FieldType[];
  private readonly dateContexts: DateParserContext[];

  constructor(
    columnSize: number,
    private readonly limit: number
  ) {
    this.votes = Array.from({ length: columnSize }, () => FieldType.INFER);
    this.dateContexts = Array.from({ length: columnSize }, () => new DateParserContext());
  }

  addData(rows: Iterable<CellData[]>): this {
    for (const row of rows) {
      if (this.rowCount >= this.limit) break;
      for (let i = 0; i < row.length; i++) {
        if (this.votes.length <= i) {
          this.votes.push(FieldType.INFER);
          this.dateContexts.push(new DateParserContext());
        }
        const type = this.votes[i];
        if (type === FieldType.STRING) continue;
        const cell = row[i];
        if (!cell || !cell.data) continue;
        const inferType = this.inferType(cell.data, cell.type, type, this.dateContexts[i]);
        if (type === FieldType.INFER) this.votes[i] = inferType;
        else if (type !== inferType && isDateFieldType(type) && isDateFieldType(inferType))
          this.votes[i] = FieldType.DATE;
        else if (type !== inferType) this.votes[i] = FieldType.STRING;
      }
      this.rowCount++;
    }
    return this;
  }

  private inferType(
    value: string,
    valueType: FieldType,
    currentType: FieldType,
    context: DateParserContext
  ): FieldType {
    if (valueType === FieldType.INFER) return parseExcelValueType(value, context);
    if (valueType === FieldType.DATE) {
      if (currentType === FieldType.DATE) return FieldType.DATE;
      return parseExcelValueType(value, context) === FieldType.YEAR_MONTH_DAY
        ? FieldType.YEAR_MONTH_DAY
        : FieldType.DATE;
    }
    return valueType;
  }

  getResult(): FieldType[] {
    return this.votes.map((t) => (t === FieldType.INFER ? FieldType.STRING : t));
  }
}

// ---------------------------------------------------------------------------
// 字段名处理（ExcelFieldsHelper.getTreatedFieldNames）
// ---------------------------------------------------------------------------

export type AgentLocale = 'zh' | 'en';

export const BLANK_HEADER_NAME: Record<AgentLocale, string> = {
  zh: '空字段名',
  en: 'BlankHeader',
};

/** 空字段名替换为「空字段名」，重名追加 1..9999 后缀。 */
export function getTreatedFieldNames(names: string[], locale: AgentLocale = 'zh'): string[] {
  const blank = BLANK_HEADER_NAME[locale];
  const seen = new Set<string>();
  return names.map((raw) => {
    const name = raw ? raw : blank;
    if (!seen.has(name)) {
      seen.add(name);
      return name;
    }
    for (let i = 1; i < 10000; i++) {
      const candidate = `${name}${i}`;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        return candidate;
      }
    }
    throw new Error('Too many columns');
  });
}

// ---------------------------------------------------------------------------
// 数值转文本（POI NumberToTextConverter.toText）
// ---------------------------------------------------------------------------

function appendExp(exp: number): string {
  return exp < 10 ? `0${exp}` : String(exp);
}

/** 与 Excel / POI 一致：15 位有效数字，|指数|>19 或长度 >20 用科学计数法。 */
export function numberToText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  const negative = value < 0;
  const [mantissa, expPart] = Math.abs(value).toExponential(14).split('e');
  let digits = mantissa.replace('.', '');
  const decExponent = Number(expPart);
  if (digits.length > 15) digits = digits.slice(0, 15);
  let sig = digits.length;
  while (sig > 1 && digits.charAt(sig - 1) === '0') sig--;
  let out = negative ? '-' : '';
  if (decExponent < 0) {
    const nLeadingZeros = -decExponent - 1;
    if (2 + nLeadingZeros + sig > 20) {
      out += digits.charAt(0);
      if (sig > 1) out += `.${digits.slice(1, sig)}`;
      return `${out}E-${appendExp(-decExponent)}`;
    }
    return `${out}0.${'0'.repeat(nLeadingZeros)}${digits.slice(0, sig)}`;
  }
  if (decExponent > 19) {
    out += digits.charAt(0);
    if (sig > 1) out += `.${digits.slice(1, sig)}`;
    return `${out}E+${appendExp(decExponent)}`;
  }
  const nFractional = sig - decExponent - 1;
  if (nFractional > 0) {
    return `${out}${digits.slice(0, decExponent + 1)}.${digits.slice(decExponent + 1, sig)}`;
  }
  return `${out}${digits.slice(0, sig)}${'0'.repeat(-nFractional)}`;
}
