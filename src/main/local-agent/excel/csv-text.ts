/**
 * CSV 文件读取：编码识别、分隔符识别、CSVFormat.EXCEL 风格解析。
 *
 * Java 端（hihidata-excel CsvReader）用 ICU CharsetDetector 识别编码、univocity
 * 自动识别分隔符（候选 , ; \t |，读前 5 行）。这里用等价的轻量规则：
 * - 编码：BOM（UTF-8 / UTF-16LE / UTF-16BE）优先；否则合法 UTF-8 → UTF-8，不合法 → GBK。
 * - 分隔符：前 5 个非空行里，引号外各候选字符的出现次数；优先选每行次数一致且 >0 的，
 *   其次总次数最多的；都没有时用逗号。
 */
export type CsvCharsetName = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'GBK';

export interface DecodedCsv {
  text: string;
  charset: CsvCharsetName;
}

export function decodeCsvBuffer(buf: Uint8Array): DecodedCsv {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), charset: 'UTF-8' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), charset: 'UTF-16LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), charset: 'UTF-16BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), charset: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('gbk').decode(buf), charset: 'GBK' };
  }
}

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

function countOutsideQuotes(line: string, ch: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ch) n++;
  }
  return n;
}

export function detectCsvDelimiter(text: string): string {
  const lines = text
    .slice(0, 64 * 1024)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (lines.length === 0) return ',';
  let best: string = ',';
  let bestScore = -1;
  for (const ch of DELIMITER_CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, ch));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const consistent = counts.every((c) => c === counts[0]) && counts[0] > 0;
    const score = (consistent ? 1_000_000 : 0) + total;
    if (score > bestScore) {
      best = ch;
      bestScore = score;
    }
  }
  return best;
}

/** CSVFormat.EXCEL 解析：双引号转义，CR / LF / CRLF 换行，空行保留为一个空字段。 */
export function* parseCsvRecords(text: string, delimiter: string): Generator<string[]> {
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  let sawAny = false;
  while (i < n) {
    const c = text[i];
    sawAny = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      record.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      record.push(field);
      yield record;
      record = [];
      field = '';
      sawAny = false;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (sawAny || field.length > 0 || record.length > 0) {
    record.push(field);
    yield record;
  }
}
