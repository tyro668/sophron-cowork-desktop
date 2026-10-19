/**
 * CSV text-encoding handling for local imports.
 *
 * DuckDB's CSV reader only accepts UTF-8 (other encodings need the optional
 * `encodings` extension, which is downloaded on demand and unavailable
 * offline). CSVs exported by Excel on Chinese Windows are usually GBK/GB18030,
 * so non-UTF-8 files are transcoded to a cached UTF-8 temp copy before DuckDB
 * reads them.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type CsvEncoding = 'auto' | 'utf-8' | 'gbk';

export const CSV_ENCODING_ERROR_CODE = 'DATA_CSV_ENCODING_ERROR';

export class CsvEncodingError extends Error {
  readonly code = CSV_ENCODING_ERROR_CODE;
  constructor(
    readonly filePath: string,
    readonly encoding: CsvEncoding
  ) {
    super(`${CSV_ENCODING_ERROR_CODE}: unable to decode ${path.basename(filePath)} as ${encoding}`);
    this.name = 'CsvEncodingError';
  }
}

const CSV_EXTENSIONS = new Set(['.csv', '.tsv', '.tab']);
const CHUNK_SIZE = 1024 * 1024;
const transcodeCache = new Map<string, string>();

export function isCsvLikePath(filePath: string): boolean {
  return CSV_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function normalizeCsvEncoding(value: unknown): CsvEncoding {
  return value === 'utf-8' || value === 'gbk' ? value : 'auto';
}

function readChunks(filePath: string, onChunk: (chunk: Buffer, first: boolean) => void): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK_SIZE);
    let first = true;
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null);
      if (bytesRead <= 0) break;
      onChunk(buffer.subarray(0, bytesRead), first);
      first = false;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** True when the whole file is valid UTF-8 (BOM allowed). */
export function isValidUtf8File(filePath: string): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    readChunks(filePath, (chunk) => {
      decoder.decode(chunk, { stream: true });
    });
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

function transcodeToUtf8(filePath: string, stat: fs.Stats): string {
  const key = `${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`;
  const cached = transcodeCache.get(key);
  if (cached && fs.existsSync(cached)) return cached;

  const dir = path.join(os.tmpdir(), 'sophron-csv-utf8');
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  const target = path.join(dir, `${hash}${path.extname(filePath).toLowerCase()}`);
  const temp = `${target}.${process.pid}.tmp`;
  const decoder = new TextDecoder('gb18030', { fatal: true });
  const out = fs.openSync(temp, 'w');
  try {
    readChunks(filePath, (chunk) => {
      fs.writeSync(out, decoder.decode(chunk, { stream: true }));
    });
    fs.writeSync(out, decoder.decode());
  } catch {
    fs.closeSync(out);
    fs.rmSync(temp, { force: true });
    throw new CsvEncodingError(filePath, 'gbk');
  }
  fs.closeSync(out);
  fs.renameSync(temp, target);
  transcodeCache.set(key, target);
  return target;
}

/**
 * Returns a path DuckDB can read as UTF-8: the original file when it already is
 * UTF-8, otherwise a cached UTF-8 copy decoded as GB18030 (a superset of GBK).
 * Non-CSV paths are returned unchanged.
 */
export function resolveCsvReadPath(filePath: string, encoding: CsvEncoding = 'auto'): string {
  if (!isCsvLikePath(filePath)) return filePath;
  const stat = fs.statSync(filePath);
  if (encoding !== 'gbk') {
    if (isValidUtf8File(filePath)) return filePath;
    if (encoding === 'utf-8') throw new CsvEncodingError(filePath, 'utf-8');
  }
  return transcodeToUtf8(filePath, stat);
}

/** Detects DuckDB "not utf-8" failures so callers can surface a friendly message. */
export function isCsvDecodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes(CSV_ENCODING_ERROR_CODE) ||
    /not utf-8 encoded|Invalid unicode \(byte sequence mismatch\)/i.test(message)
  );
}
