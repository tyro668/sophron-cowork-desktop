import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const workbench = read('src/renderer/components/data-view/raw-table-editor-workbench.tsx');
const automations = read('src/renderer/components/data-view/table-automations.tsx');
const grid = read('src/renderer/components/GlassDataGridPreview.tsx');

describe('raw table editor matches config design c05–c08', () => {
  it('header uses 104 back cell, 92px tool cells and a ⋯ delete menu', () => {
    expect(workbench).toContain('w-[104px] flex-shrink-0 items-center justify-center');
    expect(workbench).toContain("label: t('data.rawTables.actions.deleteEllipsis')");
    expect(workbench).not.toContain("'bg-accent text-accent-foreground hover:bg-accent-hover'");
  });
  it('config groups are flush with accent action cells', () => {
    expect(workbench).toContain('ui-group ui-form-flush bg-surface');
    expect(workbench).toContain('data-testid="raw-source-change"');
    expect(workbench).not.toContain('!h-8 w-full justify-between rounded-lg bg-surface px-2.5');
  });
  it('has only 配置 / 数据 / 自动化 tabs (no 关联设置)', () => {
    expect(workbench).not.toContain('value="relations"');
    expect(workbench.indexOf('<TabsTrigger value="data"')).toBeLessThan(
      workbench.indexOf('<TabsTrigger value="automation"')
    );
  });
  it('automation tab uses the 104 | 1fr | 40 | 40 | 104 grid', () => {
    expect(automations).toContain('grid-cols-[104px_minmax(0,1fr)_40px_40px_104px]');
    expect(automations).toContain("t('data.resultTables.automation.addLinkShort')");
  });
  it('data grid has a flush toolbar and pager', () => {
    expect(grid).toContain('data-testid="grid-toolbar"');
    expect(grid).toContain('data-testid="grid-pager"');
  });
});
