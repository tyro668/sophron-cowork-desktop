import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const workbench = read('src/renderer/components/data-view/raw-table-editor-workbench.tsx');
const consoleSrc = read('src/renderer/components/data-view/raw-table-generation-console.tsx');
const versions = read('src/renderer/components/data-view/raw-table-version-history.tsx');

describe('raw table 自定义 flow matches config design c15–c19', () => {
  it('处理流程 row keeps the › chevron separators without chip backgrounds', () => {
    expect(workbench).toContain('data-testid="raw-customize-steps"');
    expect(workbench).toContain("t('data.rawTables.editor.customizeFlowLabel')");
    expect(workbench).toContain('mx-2.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted');
    expect(workbench).not.toContain('flex h-4.5 w-4.5 items-center justify-center rounded-full');
  });
  it('rules step: flush prompt, own model row, example chips, bottom action row', () => {
    expect(workbench).toContain('ui-composer-flush min-h-0 flex-1');
    expect(workbench).toContain("t('data.rawTables.editor.customizeModelLabel')");
    expect(workbench).toContain('data-testid="raw-customize-prompt-count"');
    expect(workbench).toContain('data-testid="raw-customize-actions"');
    expect(workbench).toContain('data-testid="raw-customize-generate"');
    expect(workbench).not.toContain(
      'min-w-[8rem] items-center justify-center gap-1.5 rounded-lg bg-accent'
    );
  });
  it('generate step: status row, error kept in log, regenerate cell, no red banner', () => {
    expect(consoleSrc).toContain('data-testid="generation-status-row"');
    expect(consoleSrc).toContain('data-testid="generation-copy-log"');
    expect(consoleSrc).toContain('data-testid="generation-error-line"');
    expect(workbench).toContain('data-testid="raw-customize-regenerate"');
    expect(workbench).not.toContain('mx-4 flex-shrink-0 rounded-lg border border-error/20');
  });
  it('review step: shared 36px pane header and flush action cells', () => {
    expect(workbench).toContain('grid-rows-[36px_minmax(0,1fr)]');
    expect(workbench).toContain("'grid-cols-[minmax(0,1fr)_92px_240px_40px]'");
    // After an AI 修复 the header gains the 差异/全文 dropdown column.
    expect(workbench).toContain("'grid-cols-[minmax(0,1fr)_150px_92px_240px_40px]'");
    expect(workbench).toContain('data-testid="raw-customize-version-summary"');
    expect(workbench).toContain("'104px minmax(0,1fr) 104px 140px 104px'");
    expect(versions).not.toContain('ring-1 ring-inset ring-accent/20');
  });
  it('version history: flush 6-column grid in a p-0 dialog', () => {
    expect(versions).toContain('grid-cols-[120px_100px_120px_minmax(0,1fr)_92px_40px]');
    expect(versions).toContain('data-testid="normalizer-version-publish"');
    expect(workbench).toContain('data-testid="normalizer-versions-header"');
    expect(workbench).not.toContain('className="w-full max-w-4xl p-5"');
  });
});
