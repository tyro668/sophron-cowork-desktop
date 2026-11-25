/**
 * 文件名「自然顺序」比较，逐行移植 Java `com.fanruan.opensource.common.NaturalOrderSorter`
 * （合并表策略 `APPEND_BY_NATURAL_ORDER_FILE_NAME` 使用）。包括它的一些不直观之处：
 * 中文片段按 `str6.compareToIgnoreCase(str5)` 倒序比较、数值相等时按位数比较等，
 * 以保证与本地宝追加文件的顺序完全一致。
 */

const SBC_SPACE = 12288;
const DBC_SPACE = 32;
const ASCII_END = 126;
const UNICODE_START = 65281;
const UNICODE_END = 65374;
const DBC_SBC_STEP = 65248;

function isFullChar(c: number): boolean {
  return c === SBC_SPACE || (c >= UNICODE_START && c <= UNICODE_END);
}

function isHalfChar(c: number): boolean {
  return c === DBC_SPACE || c <= ASCII_END;
}

function full2halfChar(c: number): number {
  if (c === SBC_SPACE) return DBC_SPACE;
  if (c >= UNICODE_START && c <= UNICODE_END) return c - DBC_SBC_STEP;
  return c;
}

/** `AsciiUtils.full2half(String)`。 */
export function full2half(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) out += String.fromCharCode(full2halfChar(src.charCodeAt(i)));
  return out;
}

const DIGIT_PATTERN = /^[0-9]*[0-9]$/;
const LETTER_PATTERN = /^[A-Za-z0-9_]/;
const SPLIT_PATTERN = /-*[0-9]+|-*[^0-9]/gu;
const CHINESE_PATTERN = /[\u4E00-\u9FBF]+/;
const SPECIAL_STRING = ' !"#$%()*,、.-。/:;?@[\\]^`{|}~\u2018\u2019\u201C\u201D《》￥【】+<=>×…';

const SORT_MAP = new Map<string, number>();
{
  let j = 10;
  for (const ch of SPECIAL_STRING.split('')) {
    SORT_MAP.set(ch, j);
    j += 10;
  }
  SORT_MAP.set('\\d', 1000);
}

/** `NaturalOrderSorter.splitString`。 */
export function splitString(str: string): string[] {
  const list: string[] = [];
  let pos = 0;
  SPLIT_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPLIT_PATTERN.exec(str)) !== null) {
    list.push(m[0]);
    pos = m.index + m[0].length;
    if (m[0].length === 0) SPLIT_PATTERN.lastIndex++;
  }
  list.push(str.substring(pos));
  return list;
}

function isChinese(str: string): boolean {
  return CHINESE_PATTERN.test(javaTrimLocal(str));
}

function javaTrimLocal(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 32) start++;
  while (end > start && s.charCodeAt(end - 1) <= 32) end--;
  return s.substring(start, end);
}

/** Java `String.compareTo`（UTF-16 码元比较）。 */
export function javaCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Java `Character.toUpperCase(char)`：只做一对一映射。 */
function charUpper(c: string): string {
  const u = c.toUpperCase();
  return u.length === 1 ? u : c;
}

function charLower(c: string): string {
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
}

/** Java `String.compareToIgnoreCase`。 */
function javaCompareIgnoreCase(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let c1 = a[i];
    let c2 = b[i];
    if (c1 !== c2) {
      c1 = charUpper(c1);
      c2 = charUpper(c2);
      if (c1 !== c2) {
        c1 = charLower(c1);
        c2 = charLower(c2);
        if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0);
      }
    }
  }
  return a.length - b.length;
}

/** Java `Long.parseLong`：非法或溢出时返回 null（对应 NumberFormatException）。 */
function parseJavaLong(s: string): bigint | null {
  if (!/^[+-]?[0-9]+$/.test(s)) return null;
  const v = BigInt(s);
  if (v > 9223372036854775807n || v < -9223372036854775808n) return null;
  return v;
}

/** `NaturalOrderSorter.compare`。 */
export function naturalOrderCompare(str1: string, str2: string): number {
  let result = 0;
  const str3 = full2half(str1);
  const str4 = full2half(str2);
  const list1 = splitString(str3);
  const list2 = splitString(str4);
  let i1 = 0;
  let i2 = 0;
  for (;;) {
    if (i1 >= list1.length && i2 >= list2.length) {
      const list3 = splitString(str1.replaceAll('－', ''));
      const list4 = splitString(str2.replaceAll('－', ''));
      let i3 = 0;
      let i4 = 0;
      for (;;) {
        if (i3 >= list3.length && i4 >= list4.length) {
          if (str1.includes('-') && str2.includes('－')) return -1;
          if (str1.includes('－') && str2.includes('-')) return 1;
          const list5 = splitString(str3);
          const list6 = splitString(str4);
          let i5 = 0;
          let i6 = 0;
          for (;;) {
            if (i5 >= list5.length && i6 >= list6.length) return result;
            if (i5 >= list5.length) return -1;
            if (i6 >= list6.length) return 1;
            const str9 = list5[i5++];
            const str10 = list6[i6++];
            if (str9.includes('-') && !str10.includes('-')) return 1;
            if (!str9.includes('-') && str10.includes('-')) return -1;
            if (str9.includes('-') && str10.includes('-')) {
              result = str9.length - str10.length;
              if (result !== 0) return result;
            }
          }
        }
        if (i3 >= list3.length) return -1;
        if (i4 >= list4.length) return 1;
        const str7 = list3[i3++].replaceAll('-', '').replaceAll('－', '');
        const str8 = list4[i4++].replaceAll('-', '').replaceAll('－', '');
        if (str7.length === str8.length && str7.length === 1) {
          const c1 = str7.charCodeAt(0);
          const c2 = str8.charCodeAt(0);
          if (full2halfChar(c1) === full2halfChar(c2)) {
            if (isHalfChar(c1) && isFullChar(c2)) return -1;
            if (isFullChar(c1) && isHalfChar(c2)) return 1;
          }
        }
      }
    }
    if (i1 >= list1.length) return -1;
    if (i2 >= list2.length) return 1;
    const str5 = list1[i1++].replaceAll('-', '');
    const str6 = list2[i2++].replaceAll('-', '');
    const n5 = parseJavaLong(str5);
    const n6 = n5 === null ? null : parseJavaLong(str6);
    if (n5 !== null && n6 !== null) {
      result = n5 < n6 ? -1 : n5 > n6 ? 1 : 0;
      if (result === 0) {
        if (str3.includes(str5) && !str4.includes(str6)) result = -1;
        else if (!str3.includes(str5) && str4.includes(str6)) result = -1;
        else result = str6.length - str5.length;
      }
    } else {
      const isDigit1 = DIGIT_PATTERN.test(str5);
      const isDigit2 = DIGIT_PATTERN.test(str6);
      if (isDigit1 && SORT_MAP.has(str6)) result = 1;
      else if (isDigit2 && SORT_MAP.has(str5)) result = -1;
      else if (SORT_MAP.has(str5) && SORT_MAP.has(str6))
        result = SORT_MAP.get(str5)! - SORT_MAP.get(str6)!;
      else {
        const isLetter1 = LETTER_PATTERN.test(str5);
        const isLetter2 = LETTER_PATTERN.test(str6);
        if (isLetter1 && SORT_MAP.has(str6)) result = 1;
        else if (isLetter2 && SORT_MAP.has(str5)) result = -1;
        else if (isChinese(str5) && isChinese(str6)) result = javaCompareIgnoreCase(str6, str5);
        else result = javaCompareIgnoreCase(str5, str6);
      }
    }
    if (result !== 0) return result;
  }
}
