/**
 * 与 Java 本地宝的字节级兼容性：
 *  - fixtures/java/lz4-java.lz4 由 lz4-java 1.8.0 `LZ4FrameOutputStream(SIZE_1MB)` 生成；
 *  - fixtures/java/csv-expected.csv 由 commons-csv 1.14 `CSVFormat.DEFAULT` 生成；
 *  - 本机有 JDK + lz4-java 时，额外让 Java 解 TS 生成的 Frame（没有则跳过）。
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Lz4FrameEncoder,
  lz4FrameDecode,
  lz4FrameEncode,
  xxhash32,
} from '../../src/main/local-agent/lz4';
import { encodeCsvRow, formatCsvRecord } from '../../src/main/local-agent/s3/s3-upload-stream';

const FIXTURES = path.join(__dirname, 'fixtures/java');
const JAVA_INPUT_SHA256 = 'ac855cf59a8d7661bad42fb29654880c94c6a95eef146a49c3cd835d54427429';

describe('xxhash32', () => {
  it('matches reference vectors', () => {
    expect(xxhash32(new Uint8Array(0), 0)).toBe(0x02cc5d05);
    expect(xxhash32(Buffer.from('abc'), 0)).toBe(0x32d153ff);
  });
});

describe('LZ4 frame (lz4-java LZ4FrameOutputStream compatible)', () => {
  it('writes the same frame header as lz4-java (FLG 0x60, BD 0x60)', () => {
    const frame = lz4FrameEncode(Buffer.from('hello'));
    expect(Buffer.from(frame.subarray(0, 6)).toString('hex')).toBe('04224d186060');
    const hc = (xxhash32(Buffer.from([0x60, 0x60]), 0) >>> 8) & 0xff;
    expect(frame[6]).toBe(hc);
    // 结束标记
    expect(Buffer.from(frame.subarray(frame.length - 4)).toString('hex')).toBe('00000000');
  });

  it('round-trips compressible, random and multi-block data', () => {
    const csv = Buffer.from('1,商品,2024-01-05\r\n'.repeat(200_000));
    const rnd = randomBytes(300_000);
    for (const data of [Buffer.alloc(0), Buffer.from('x'), csv, rnd, Buffer.concat([csv, rnd])]) {
      const frame = lz4FrameEncode(data);
      expect(Buffer.from(lz4FrameDecode(frame)).equals(data)).toBe(true);
    }
    expect(lz4FrameEncode(csv).length).toBeLessThan(csv.length / 5);
  });

  it('streaming encoder equals one-shot encoding and tracks compressed size', () => {
    const enc = new Lz4FrameEncoder();
    const chunks = Array.from({ length: 50 }, (_v, i) =>
      Buffer.from(`${i},row-${i}\r\n`.repeat(3000))
    );
    for (const c of chunks) enc.write(c);
    const out = enc.finish();
    expect(Buffer.from(lz4FrameDecode(out)).equals(Buffer.concat(chunks))).toBe(true);
  });

  it('decodes a frame produced by lz4-java', () => {
    const decoded = lz4FrameDecode(readFileSync(path.join(FIXTURES, 'lz4-java.lz4')));
    expect(createHash('sha256').update(decoded).digest('hex')).toBe(JAVA_INPUT_SHA256);
  });

  const java = process.env.LZ4_JAVA_HOME
    ? path.join(process.env.LZ4_JAVA_HOME, 'bin/java')
    : '/workspace/review/jdk/jdk-11.0.33.1+1/bin/java';
  const jar =
    process.env.LZ4_JAVA_JAR ??
    path.join(
      process.env.HOME ?? '',
      '.gradle/caches/modules-2/files-2.1/org.lz4/lz4-java/1.8.0/4b986a99445e49ea5fbf5d149c4b63f6ed6c6780/lz4-java-1.8.0.jar'
    );
  const verifier = '/workspace/review/lz4-verify/Gen.class';
  const canRunJava = existsSync(java) && existsSync(jar) && existsSync(verifier);

  it.skipIf(!canRunJava)('lz4-java decodes frames produced by TS', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lz4-java-'));
    try {
      const data = Buffer.concat([Buffer.from('a,b,c\r\n'.repeat(400_000)), randomBytes(200_000)]);
      await writeFile(path.join(dir, 'in.lz4'), lz4FrameEncode(data));
      execFileSync(java, [
        '-cp',
        `${jar}:${path.dirname(verifier)}`,
        'Gen',
        'decode',
        path.join(dir, 'in.lz4'),
        path.join(dir, 'out.bin'),
      ]);
      expect((await readFile(path.join(dir, 'out.bin'))).equals(data)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('CSV rows (commons-csv 1.14 CSVFormat.DEFAULT compatible)', () => {
  it('produces byte-identical output to CSVPrinter', () => {
    const records = JSON.parse(readFileSync(path.join(FIXTURES, 'csv-records.json'), 'utf8')) as (
      string | null
    )[][];
    const expected = readFileSync(path.join(FIXTURES, 'csv-expected.csv'), 'utf8');
    expect(records.map((r) => formatCsvRecord(r)).join('')).toBe(expected);
    expect(Buffer.concat(records.map((r) => Buffer.from(encodeCsvRow(r)))).toString('utf8')).toBe(
      expected
    );
  });
});
