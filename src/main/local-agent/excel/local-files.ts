/**
 * 本地目录的文件选择，对应 Java：
 *   - `ExcelUtils.getFiles` / `getNoEmptyFiles`：手动表（单文件 / 合并表）要读取的文件及顺序；
 *   - `LocalFileNameVisitor` + `LocalTableId.createTables`：分组目录的自动表扫描。
 * 路径比较、排序与 Java 一致（`String.compareTo`、`NaturalOrderSorter`、创建 / 修改时间）。
 */
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

import {
  LocalReadStrategy,
  TableReadStrategy,
  TableSourceStrategy,
  formatAbsolutePath,
  normalizeRelativeFilePath,
  type ExcelTableConfig,
} from './local-config';
import { javaCompare, naturalOrderCompare } from './natural-order';

/** `UnchangedFile`：fileName 为绝对路径（平台分隔符），equals 只比较 fileName + modifyTime。 */
export interface LocalFileVersion {
  fileName: string;
  modifyTime: number;
  createTime?: number;
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.substring(i + 1).toLowerCase();
}

/** `ExcelUtils.isExcel`（只认 xlsx / xls）。 */
export function isJavaExcel(name: string): boolean {
  const e = ext(name);
  return e === 'xlsx' || e === 'xls';
}

export function isJavaCsv(name: string): boolean {
  return ext(name) === 'csv';
}

/** `ExcelUtils.isTemp`：`~` 或 `$` 开头。 */
export function isTempName(name: string): boolean {
  return name.startsWith('~') || name.startsWith('$');
}

/** `Files.isHidden`（Unix 语义：名字以 `.` 开头）。 */
function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** `ExcelUtils.isNotHiddenExcelOrCsv`（只看文件自身的名字）。 */
export function isNotHiddenExcelOrCsv(filePath: string): boolean {
  const name = path.basename(filePath);
  return !isHiddenName(name) && (isJavaExcel(name) || isJavaCsv(name)) && !isTempName(name);
}

async function fileVersion(filePath: string): Promise<LocalFileVersion> {
  try {
    const st = await stat(filePath);
    return {
      fileName: filePath,
      modifyTime: Math.trunc(st.mtimeMs),
      createTime: Math.trunc(st.birthtimeMs || st.ctimeMs),
    };
  } catch {
    return { fileName: filePath, modifyTime: 0, createTime: 0 };
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** `Files.walk(path, maxDepth)`：深度优先先序遍历（含起点本身）。 */
async function walk(start: string, maxDepth: number, out: string[], depth = 0): Promise<void> {
  out.push(start);
  if (depth >= maxDepth) return;
  let st;
  try {
    st = await stat(start);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  const entries = await readdir(start, { withFileTypes: true });
  for (const e of entries) {
    const child = path.join(start, e.name);
    if (e.isSymbolicLink()) {
      out.push(child);
      continue;
    }
    await walk(child, maxDepth, out, depth + 1);
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** `ExcelUtils.getFiles(directoryPath, excelTableBean)`。 */
export async function getTableFiles(
  directoryPath: string,
  table: ExcelTableConfig
): Promise<LocalFileVersion[]> {
  const target = path.resolve(formatAbsolutePath(table, directoryPath));
  if (!(await exists(target))) return [];
  if (table.strategy === TableSourceStrategy.SINGLE_FILE) return [await fileVersion(target)];
  const walked: string[] = [];
  const depth =
    table.readStrategy === TableReadStrategy.ONLY_CURRENT_DIRECTORY ? 1 : Number.MAX_SAFE_INTEGER;
  await walk(target, depth, walked);
  const files: LocalFileVersion[] = [];
  for (const p of walked) {
    if (await isDirectory(p)) continue;
    if (!isNotHiddenExcelOrCsv(p)) continue;
    files.push(await fileVersion(p));
  }
  const s = table.strategy;
  files.sort((x, y) => {
    if (s === TableSourceStrategy.APPEND_BY_NATURAL_ORDER_FILE_NAME)
      return naturalOrderCompare(x.fileName, y.fileName);
    if (s === TableSourceStrategy.APPEND_BY_FILE_NAME || s === TableSourceStrategy.APPEND)
      return javaCompare(x.fileName, y.fileName);
    if (s === TableSourceStrategy.APPEND_BY_MODIFY_TIME) return x.modifyTime - y.modifyTime;
    return (x.createTime ?? 0) - (y.createTime ?? 0);
  });
  return files;
}

/** `ExcelUtils.folder_empty_no_exist` 文案（EmptyPathException）。 */
export function emptyPathMessage(p: string): string {
  return `文件夹为空或者文件不存在, 文件路径为 ${p}`;
}

/** `ExcelUtils.getNoEmptyFiles`：没有文件时抛 EmptyPathException。 */
export async function getNoEmptyTableFiles(
  directoryPath: string,
  table: ExcelTableConfig
): Promise<LocalFileVersion[]> {
  const files = await getTableFiles(directoryPath, table);
  if (files.length === 0) {
    throw new Error(emptyPathMessage(path.join(directoryPath, table.relativeFilePath)));
  }
  return files;
}

function toUnix(p: string): string {
  return p.split(path.sep).join('/').replace(/\\/g, '/');
}

/**
 * `LocalFileNameVisitor`：返回分组目录下要生成自动表的文件（绝对路径 + 相对路径）。
 * 与 Java 一致：
 *   - 合并表的 relativeFilePath 作为前缀排除目录（含 `/` 时整个目录不扫描）；
 *   - 单文件表的文件本身被排除；
 *   - 「仅读取当前目录」不进入子目录；
 *   - Java 判断隐藏目录用的是带前导 `/` 的相对路径，实际不会跳过 `.xxx` 目录，这里保持一致。
 */
export async function scanAutoTableFiles(
  directoryPath: string,
  strategy: number,
  manualTables: ExcelTableConfig[]
): Promise<Array<{ filePath: string; relativePath: string }>> {
  if (strategy === LocalReadStrategy.NONE || !directoryPath) return [];
  const firstPath = toUnix(path.resolve(directoryPath));
  const excludeDirs = new Set<string>();
  const excludeFiles = new Set<string>();
  for (const t of manualTables) {
    if (t.strategy !== TableSourceStrategy.SINGLE_FILE) {
      excludeDirs.add(normalizeRelativeFilePath(t.relativeFilePath));
    } else {
      excludeFiles.add(toUnix(formatAbsolutePath(t, firstPath)));
    }
  }
  if (excludeDirs.has('/')) return [];
  if (!(await isDirectory(firstPath))) return [];
  const out: Array<{ filePath: string; relativePath: string }> = [];
  const visit = async (dir: string, root: boolean): Promise<void> => {
    if (!root) {
      const rel = toUnix(dir).substring(firstPath.length);
      if (rel.startsWith('.') || isTempName(rel)) return;
      if ([...excludeDirs].some((d) => rel.startsWith(d))) return;
      if (strategy === LocalReadStrategy.ONLY_CURRENT_DIRECTORY) return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(child, false);
        continue;
      }
      const abs = toUnix(child);
      if (isNotHiddenExcelOrCsv(child) && !excludeFiles.has(abs)) {
        out.push({ filePath: child, relativePath: toUnix(path.relative(firstPath, child)) });
      }
    }
  };
  await visit(firstPath, true);
  return out;
}
