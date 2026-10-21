import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editor = readFileSync(
  'src/renderer/components/settings/schedule/cloud-sync-editor.tsx',
  'utf8'
);
const selector = readFileSync(
  'src/renderer/components/settings/schedule/cloud-resource-selector.tsx',
  'utf8'
);
const select = readFileSync('src/renderer/components/GlassSelect.tsx', 'utf8');

describe('cloud sync action matches c13/c14', () => {
  it('uses one flush grid without cards', () => {
    expect(editor).not.toContain('ConfigSection');
    expect(editor).not.toContain('FieldStack');
    expect(editor).toContain('<SubGroupRow>');
    expect(editor).toContain('<FlushSelect');
  });
  it('legacy target renders a warning row', () => {
    expect(editor).toMatch(/legacy && \(\s*<FormRow/);
  });
  it('not-connected note row with accent cells; dropdowns disabled', () => {
    expect(selector).toContain('data-testid="cloud-not-connected"');
    expect(selector).toContain('ui-accent-cell');
    expect(selector).toContain('disabled={!connected}');
    expect(selector).not.toContain('<Button');
  });
  it('load more is a fixed dropdown footer and loading shows a trigger spinner', () => {
    expect(selector).toContain('data-testid="cloud-load-more"');
    expect(select).toContain('data-testid="glass-select-loading"');
  });
});
