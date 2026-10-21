import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const W = 'src/renderer/components/data-view/data-pipelines/workflow/';
const read = (p: string) => readFileSync(p, 'utf8');

describe('pipeline editor option A', () => {
  it('header: back cell = palette width 232px; 保存并运行 is an accent text cell; running state', () => {
    const s = read(W + 'PipelineEditor.tsx');
    expect(s).toContain('grid-cols-[232px_minmax(0,1fr)]');
    expect(s).toContain('w-[232px]');
    expect(s).not.toMatch(/variant="primary"\s+onClick=\{\(\) => void handleSaveAndRun\(\)\}/);
    expect(s).toContain('text-accent shadow-none hover:bg-accent-muted/60');
    expect(s).toContain("t('data.workflow.runningShort')");
  });
  it('canvas toolbar: 40px flush row with zoom/fit/minimap icon cells; no floating Controls', () => {
    const s = read(W + 'WorkflowCanvas.tsx');
    expect(s).toContain('flex h-10 shrink-0 items-stretch border-b');
    for (const k of ['zoomOut', 'zoomIn', 'fitView', 'toggleMinimap'])
      expect(s).toContain(`t('data.workflow.${k}')`);
    expect(s).not.toContain('<Controls');
    const css = read('src/renderer/styles/globals.css');
    expect(css).toMatch(/react-flow__minimap \{[^}]*border-radius: 0/);
  });
  it('palette: flush list, no cards / row lines, 10px inset + 2px bar', () => {
    const s = read(W + 'WorkflowOperatorPalette.tsx');
    expect(s).not.toContain('rounded-md border border-border-subtle');
    expect(s).not.toContain('border-b border-border-subtle px-2.5');
    expect(s).toContain('mx-2.5 h-8');
    expect(s).toContain('before:w-0.5 before:bg-accent');
  });
  it('status bar: 48px pager, accent preview cell, page-size dropdown, standard warning badge', () => {
    const ui = read(W + 'WorkflowUi.tsx');
    expect(ui).toContain('footerClassName="h-12"');
    const insp = read(W + 'WorkflowInspector.tsx');
    expect(insp).toContain('NODE_PREVIEW_PAGE_SIZES');
    expect(insp).toContain('data-testid="preview-to-here"');
    expect(insp).toContain('h-5 flex-shrink-0 items-center gap-1 rounded-[4px]');
    const grid = read('src/renderer/components/GlassDataGridPreview.tsx');
    expect(grid).toContain('data-testid="grid-page-size"');
  });
});
