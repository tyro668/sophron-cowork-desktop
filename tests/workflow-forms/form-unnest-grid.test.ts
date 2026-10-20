import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../src/renderer/components/workflow-forms/FormUnnest.tsx'),
  'utf8'
);

describe('FormUnnest', () => {
  it('writes undefined when the alias is cleared instead of keeping the old value', () => {
    expect(source).toContain('alias: v.trim() || undefined');
    expect(source).toContain("tr('unnestAliasRequired')");
  });
  it('uses the shared grid', () => {
    expect(source).toContain('UNNEST_GRID_COLUMNS');
    expect(source).toContain('<FormScroll>');
  });
});
