import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');

describe('config / detail views use the flush group variant', () => {
  const css = read('src/renderer/styles/globals.css');

  it('defines a descendant flush variant and keeps the default inset .ui-group card', () => {
    expect(css).toContain('.ui-config-flush .ui-group');
    expect(css).toContain('margin: var(--space-group) var(--space-inset) 0;');
    expect(css).toContain('border-radius: var(--radius-group);');
  });

  it('applies the variant to the four config / detail bodies', () => {
    expect(read('src/renderer/components/data-view/raw-table-editor-workbench.tsx')).toContain(
      'ui-config-flush'
    );
    expect(read('src/renderer/components/data-view/result-tables.tsx')).toContain(
      'ui-config-flush'
    );
    expect(read('src/renderer/components/settings/SettingsSchedule.tsx')).toContain(
      'ui-config-flush'
    );
    expect(read('src/renderer/components/data-view/cloud-connection-datasource.tsx')).toContain(
      'configFlushBodyClass'
    );
    expect(read('src/renderer/components/data-view/shared.tsx')).toContain(
      "export const configFlushBodyClass = 'ui-config-flush min-h-0 flex-1 overflow-auto bg-surface'"
    );
  });

  it('leaves the wizard and raw-source detail on the inset groupClass', () => {
    expect(read('src/renderer/components/data-view/raw-source-wizard.tsx')).toContain(
      "export const groupClass = 'ui-group ui-form-flush !mx-0 !mb-2 !mt-0 bg-surface'"
    );
    expect(read('src/renderer/components/data-view/raw-source-detail.tsx')).toContain(
      'className={groupClass}'
    );
    expect(read('src/renderer/components/data-view/cloud-connection-datasource.tsx')).not.toContain(
      'groupClass'
    );
  });
});
