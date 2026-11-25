/**
 * 读取本地 Excel / CSV 文件为单元格矩阵（对应 hihidata-excel 的 ExcelReader + ExcelListener
 * + ExcelConvert，以及 CsvReader.readCsv）。
 *
 * - Excel：用仓库已有的 SheetJS（xlsx）。表头是工作表范围内的第一行（EasyExcel 的第 0 行），
 *   数值单元格按格式转文本：日期格式 → `yyyy-MM-dd` / `yyyy-MM-dd HH:mm:ss`，其余走
 *   POI `NumberToTextConverter`；布尔值 → `true` / `false`；错误值 → 空。
 *   单元格类型来自数字格式（`ExcelUtils.buildFrom`）。
 * - CSV：编码 / 分隔符识别后按 CSVFormat.EXCEL 解析，所有单元格类型为 INFER。
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import * as XLSX from '../../utils/xlsx';
import { decodeCsvBuffer, detectCsvDelimiter, parseCsvRecords } from './csv-text';
import {
  FieldType,
  fieldTypeFromFormat,
  formatExcelValue,
  formatOnlyExcelData,
  numberToText,
  type CellData,
} from './field-type';

export function isCsvFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.csv';
}

export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.csv'] as const;

export function isSupportedTableFile(filePath: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase());
}

/** CSV 的 "sheet 名" 是去掉扩展名的文件名（CsvReader.sheets）。 */
export function csvSheetName(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ExcelConvert：日期格式数值 → 字符串（仅日期时 yyyy-MM-dd，否则 yyyy-MM-dd HH:mm:ss）。 */
export function excelDateToText(serial: number, date1904 = false): string | null {
  const code = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!code) return null;
  const ymd = `${code.y}-${pad2(code.m)}-${pad2(code.d)}`;
  if (code.H === 0 && code.M === 0 && code.S === 0) return ymd;
  return `${ymd} ${pad2(code.H)}:${pad2(code.M)}:${pad2(code.S)}`;
}

const dateFormatCache = new Map<string, boolean>();
function isDateFormat(format: string): boolean {
  const cached = dateFormatCache.get(format);
  if (cached !== undefined) return cached;
  let hit: boolean;
  try {
    hit = XLSX.SSF.is_date(format);
  } catch {
    hit = false;
  }
  dateFormatCache.set(format, hit);
  return hit;
}

function cellToData(cell: XLSX.CellObject | undefined, date1904: boolean): CellData {
  if (!cell) return { data: '', type: FieldType.INFER };
  const format = typeof cell.z === 'string' ? cell.z : undefined;
  const type = fieldTypeFromFormat(format, format === undefined ? 0 : undefined, isDateFormat);
  let text: string;
  switch (cell.t) {
    case 'n': {
      const value = cell.v as number;
      const asDate = format && isDateFormat(format) ? excelDateToText(value, date1904) : null;
      text = asDate ?? numberToText(value);
      break;
    }
    case 'b':
      text = cell.v ? 'true' : 'false';
      break;
    case 'e':
      text = '';
      break;
    case 'd': {
      const d = cell.v as Date;
      text = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      if (d.getHours() || d.getMinutes() || d.getSeconds())
        text += ` ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
      break;
    }
    case 'z':
      text = '';
      break;
    default:
      text = cell.v === undefined || cell.v === null ? '' : String(cell.v);
  }
  return { data: formatOnlyExcelData(text), type };
}

export interface WorkbookHandle {
  sheetNames: string[];
  readSheet(sheetName: string): CellData[][];
}

export async function openWorkbook(filePath: string): Promise<WorkbookHandle> {
  const buf = await readFile(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true, cellDates: false, dense: true });
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  return {
    sheetNames: [...wb.SheetNames],
    readSheet(sheetName: string): CellData[][] {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error(`sheet not found: ${sheetName}`);
      const ref = sheet['!ref'];
      if (!ref) return [];
      const range = XLSX.utils.decode_range(ref);
      const dense = (sheet as unknown as { '!data'?: (XLSX.CellObject | undefined)[][] })['!data'];
      const rows: CellData[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const rowCells = dense?.[r];
        if (!rowCells) {
          rows.push([]);
          continue;
        }
        let last = rowCells.length - 1;
        while (last >= 0 && !rowCells[last]) last--;
        const row: CellData[] = [];
        // EasyExcel 的列从 A 开始计；为保持列位置，从第 0 列补齐
        for (let c = 0; c <= last; c++) row.push(cellToData(rowCells[c], date1904));
        rows.push(row);
      }
      // 去掉范围开头不存在的行，表头取第一行有单元格的行
      let first = 0;
      while (first < rows.length && rows[first].length === 0) first++;
      return rows.slice(first);
    },
  };
}

export interface CsvReadResult {
  rows: CellData[][];
  charset: string;
  delimiter: string;
}

/** CsvReader.readCsv：每个值去掉 BOM 字符后走 ExcelUtils.format，类型均为 INFER。 */
export async function readCsvCells(filePath: string): Promise<CsvReadResult> {
  const buf = await readFile(filePath);
  const { text, charset } = decodeCsvBuffer(buf);
  const delimiter = detectCsvDelimiter(text);
  const rows: CellData[][] = [];
  for (const record of parseCsvRecords(text, delimiter)) {
    rows.push(
      record.map((v) => ({
        data: formatExcelValue(v.replace(/\ufeff/g, '')),
        type: FieldType.INFER,
      }))
    );
  }
  return { rows, charset, delimiter };
}
