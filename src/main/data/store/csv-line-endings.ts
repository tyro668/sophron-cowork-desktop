/**
 * Mixed line endings in CSVs (`\r\n` + `\n`, or bare `\r` mixed in) make DuckDB's dialect
 * sniffer fail. Such files are normalized to `\n` in a streamed pass into a temp copy that
 * lives only for the duration of one read; the original file is never modified.
 * Line breaks inside quoted fields are left as they are.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHUNK_SIZE = 1024 * 1024;
const CR = 0x0d;
const LF = 0x0a;
const QUOTE = 0x22;

export interface LineEndingCounts {
  crlf: number;
  lf: number;
  cr: number;
}

/** Streaming state machine over raw bytes (the delimiters are ASCII, so UTF-8 is safe). */
class LineEndingScanner {
  inQuotes = false;
  pendingCR = false;
  readonly counts: LineEndingCounts = { crlf: 0, lf: 0, cr: 0 };

  /** Processes one chunk; when `normalize` is set returns the chunk with `\n` endings. */
  push(chunk: Buffer, normalize: boolean): Buffer | null {
    const out = normalize ? Buffer.allocUnsafe(chunk.length + 1) : null;
    let o = 0;
    let i = 0;
    if (this.pendingCR) {
      // A `\r` ended the previous chunk outside quotes; decide now whether it was `\r\n`.
      this.pendingCR = false;
      if (chunk.length > 0 && chunk[0] === LF) {
        this.counts.crlf += 1;
        i = 1;
      } else {
        this.counts.cr += 1;
      }
      if (out) out[o++] = LF;
    }
    for (; i < chunk.length; i += 1) {
      const byte = chunk[i];
      if (byte === QUOTE) {
        this.inQuotes = !this.inQuotes;
      } else if (!this.inQuotes && byte === CR) {
        if (i + 1 === chunk.length) {
          this.pendingCR = true;
          continue;
        }
        if (chunk[i + 1] === LF) {
          this.counts.crlf += 1;
          i += 1;
        } else {
          this.counts.cr += 1;
        }
        if (out) out[o++] = LF;
        continue;
      } else if (!this.inQuotes && byte === LF) {
        this.counts.lf += 1;
      }
      if (out) out[o++] = byte;
    }
    return out ? out.subarray(0, o) : null;
  }

  /** Flushes a trailing `\r`. */
  end(normalize: boolean): Buffer | null {
    if (!this.pendingCR) return normalize ? Buffer.alloc(0) : null;
    this.pendingCR = false;
    this.counts.cr += 1;
    return normalize ? Buffer.from([LF]) : null;
  }
}

function forEachChunk(filePath: string, chunkSize: number, onChunk: (chunk: Buffer) => void) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(chunkSize);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (read <= 0) break;
      onChunk(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function countLineEndings(filePath: string, chunkSize = CHUNK_SIZE): LineEndingCounts {
  const scanner = new LineEndingScanner();
  forEachChunk(filePath, chunkSize, (chunk) => scanner.push(chunk, false));
  scanner.end(false);
  return scanner.counts;
}

/** More than one kind of line terminator outside quoted fields. */
export function hasMixedLineEndings(filePath: string, chunkSize = CHUNK_SIZE): boolean {
  const { crlf, lf, cr } = countLineEndings(filePath, chunkSize);
  return [crlf, lf, cr].filter((count) => count > 0).length > 1;
}

export function csvLineEndingTempDir(): string {
  return path.join(os.tmpdir(), 'sophron-csv-eol');
}

/** Writes a `\n`-normalized copy of `filePath` and returns its path. */
export function writeNormalizedCopy(filePath: string, chunkSize = CHUNK_SIZE): string {
  const dir = csvLineEndingTempDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(
    dir,
    `${crypto.randomUUID()}${path.extname(filePath).toLowerCase() || '.csv'}`
  );
  const scanner = new LineEndingScanner();
  const out = fs.openSync(target, 'w');
  try {
    forEachChunk(filePath, chunkSize, (chunk) => {
      const normalized = scanner.push(chunk, true)!;
      if (normalized.length) fs.writeSync(out, normalized);
    });
    const tail = scanner.end(true)!;
    if (tail.length) fs.writeSync(out, tail);
  } catch (error) {
    fs.closeSync(out);
    fs.rmSync(target, { force: true });
    throw error;
  }
  fs.closeSync(out);
  return target;
}

/**
 * Runs `read` with a path DuckDB can parse: `readPath` itself, or — when its line endings
 * are mixed — a normalized temp copy that is deleted afterwards, also on error.
 */
export async function withNormalizedLineEndings<T>(
  readPath: string,
  read: (path: string) => Promise<T>,
  chunkSize = CHUNK_SIZE
): Promise<T> {
  if (!hasMixedLineEndings(readPath, chunkSize)) return read(readPath);
  const temp = writeNormalizedCopy(readPath, chunkSize);
  try {
    return await read(temp);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
