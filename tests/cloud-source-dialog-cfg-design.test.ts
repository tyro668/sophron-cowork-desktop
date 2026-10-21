import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dialog = readFileSync(
  'src/renderer/components/data-view/raw-table-cloud-source-dialog.tsx',
  'utf8'
);
const selector = readFileSync(
  'src/renderer/components/settings/schedule/cloud-resource-selector.tsx',
  'utf8'
);

describe('选择云端表 dialog matches config design c20–c23', () => {
  it('flush title row with close cell, no nested label grid, flush action row', () => {
    expect(dialog).toContain('data-testid="cloud-source-dialog-title"');
    expect(dialog).toContain('grid-cols-[minmax(0,1fr)_40px]');
    expect(dialog).toContain('<div className="ui-group-title">');
    expect(dialog).not.toContain('ui-form-value py-2');
    expect(dialog).toContain('data-testid="cloud-source-dialog-actions"');
    expect(dialog).toContain('ui-accent-cell border-l border-border-subtle');
    expect(dialog).not.toContain('variant="primary"');
  });
  it('not-logged-in row is compact with a single 登录云空间 action', () => {
    expect(dialog).toContain('<CloudConnectionRow compact />');
    expect(selector).toContain('{compact ? null : (');
  });
  it('loading placeholder and error row with retry', () => {
    expect(selector).toContain("t('schedule.cloudSync.loadingTargets')");
    expect(selector).toContain('data-testid="cloud-error-row"');
    expect(selector).toContain('data-testid="cloud-retry"');
    expect(selector).toContain('setReloadKey((key) => key + 1)');
  });
});
