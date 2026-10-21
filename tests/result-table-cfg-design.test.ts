import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/components/data-view/result-tables.tsx', 'utf8');

describe('result table editor matches config design c09–c12', () => {
  it('重新运行 is a tool cell, not a solid primary button', () => {
    expect(src).not.toContain('jade-primary-button border-l');
    expect(src).toContain('w-[92px] items-center justify-center gap-1.5 whitespace-nowrap');
  });
  it('basic info has 名称 + 复制来源; lineage has 打开加工 and 下游', () => {
    expect(src).toContain('data-testid="result-basic-name"');
    expect(src).toContain("t('data.resultTables.lineage.openPipeline')");
    expect(src).toContain("t('data.resultTables.lineage.downstreamLabel')");
  });
  it('danger zone is a normal flush group with a red text cell and impact', () => {
    expect(src).not.toContain('ui-group-danger');
    expect(src).toContain('data-testid="result-danger-zone"');
    expect(src).toContain('resultTableDeleteImpact(resultTable, t)');
  });
  it('data and automation tabs reuse the flush grid', () => {
    expect(src).toContain('onExport={canExport');
    expect(src).toMatch(/<ResultTableAutomations[\s\S]*?grid\s*\/>/);
  });
});
