/**
 * NaturalOrderSorter 一致性：fixture 由 Java 本地宝的 `NaturalOrderSorter` 生成
 * （/workspace/review/nat/NatOracle.java，见迁移说明第 10 节）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { naturalOrderCompare } from '../../src/main/local-agent/excel/natural-order';

const dir = path.join(__dirname, 'fixtures/java/settings');
const names = readFileSync(path.join(dir, 'natural-names.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.length > 0);
const [sortedLine, matrixLine] = readFileSync(path.join(dir, 'natural-oracle.txt'), 'utf8').split(
  '\n'
);

describe('naturalOrderCompare (Java NaturalOrderSorter parity)', () => {
  it('sorts like Java', () => {
    const expected = sortedLine.replace(/^SORTED\t/, '').split('\u0001');
    expect([...names].sort(naturalOrderCompare)).toEqual(expected);
  });

  it('matches every pairwise comparison sign', () => {
    const signs = matrixLine.trim().split(' ').map(Number);
    const mismatches: string[] = [];
    names.forEach((a, i) =>
      names.forEach((b, j) => {
        const got = Math.sign(naturalOrderCompare(a, b));
        const want = signs[i * names.length + j];
        if (got !== want) mismatches.push(`${a} vs ${b}: ts=${got} java=${want}`);
      })
    );
    expect(mismatches).toEqual([]);
  });
});
