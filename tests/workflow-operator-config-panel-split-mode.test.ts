import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const componentPath = path.resolve(
  process.cwd(),
  'src/renderer/components/data-view/WorkflowOperatorConfigPanel.tsx'
);
const source = fs.readFileSync(componentPath, 'utf8');

const enLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');
const enLocale = fs.readFileSync(enLocalePath, 'utf8');

const zhLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');
const zhLocale = fs.readFileSync(zhLocalePath, 'utf8');

describe('WorkflowOperatorConfigPanel split mode toggle', () => {
  it('defines the three-mode union type', () => {
    expect(source).toContain("OperatorPanelSplitMode = 'split' | 'dsl-only' | 'form-only'");
  });

  it('initialises splitMode state to split', () => {
    expect(source).toContain("useState<OperatorPanelSplitMode>('split')");
  });

  it('resets splitMode to split on node.id change', () => {
    expect(source).toContain("setSplitMode('split')");
    // must appear inside the useEffect that watches node.id
    const nodeIdEffect = source.match(
      /useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*setSplitMode\('split'\)[^}]*\}\s*,\s*\[node\.id\]\)/s
    );
    expect(nodeIdEffect).not.toBeNull();
  });

  it('has dedicated upper triangle click handler', () => {
    expect(source).toContain('handleUpperTriangleClick');
    expect(source).toContain("prev === 'dsl-only' ? 'split' : 'dsl-only'");
  });

  it('has dedicated lower triangle click handler', () => {
    expect(source).toContain('handleLowerTriangleClick');
    expect(source).toContain("prev === 'form-only' ? 'split' : 'form-only'");
  });

  it('guards drag with splitMode check', () => {
    expect(source).toContain("splitMode !== 'split'");
  });

  it('preserves splitRatio state across mode changes (does not reset on mode toggle)', () => {
    // splitRatio is set once with DEFAULT_SPLIT_RATIO, never explicitly reset
    // in the click handlers or splitMode effect — only the initial useState matters
    const ratioOccurrences = source.match(/setSplitRatio/g);
    // setSplitRatio appears only in useState initializer and inside the drag handler
    expect(ratioOccurrences).not.toBeNull();
    // verify no setSplitRatio in the click handlers
    const upperHandler = source.match(
      /handleUpperTriangleClick\s*=\s*useCallback\s*\(\s*\(\)\s*=>\s*\{[^}]*setSplitRatio/s
    );
    expect(upperHandler).toBeNull();
    const lowerHandler = source.match(
      /handleLowerTriangleClick\s*=\s*useCallback\s*\(\s*\(\)\s*=>\s*\{[^}]*setSplitRatio/s
    );
    expect(lowerHandler).toBeNull();
  });

  it('upper triangle button includes aria-label and aria-pressed', () => {
    expect(source).toContain('aria-label=');
    expect(source).toContain('aria-pressed={splitMode ===');
  });

  it('lower triangle button includes aria-label and aria-pressed', () => {
    // Count occurrences of aria-pressed to verify both buttons have it
    const ariaPressedCount = (source.match(/aria-pressed=/g) || []).length;
    expect(ariaPressedCount).toBeGreaterThanOrEqual(2);
  });

  it('triangle buttons stop event propagation', () => {
    expect(source).toContain('e.stopPropagation()');
    // two buttons, each with onClick stopPropagation + onPointerDown stopPropagation
    const stopCount = (source.match(/e\.stopPropagation\(\)/g) || []).length;
    expect(stopCount).toBeGreaterThanOrEqual(4);
  });

  it('hides form pane in dsl-only mode', () => {
    expect(source).toContain("splitMode !== 'dsl-only'");
  });

  it('hides DSL section in form-only mode', () => {
    expect(source).toContain("splitMode !== 'form-only'");
  });

  it('keeps Copy DSL and Expand buttons in the DSL section', () => {
    expect(source).toContain("t('data.workflow.copyDsl', 'Copy DSL')");
    expect(source).toContain("t('common.expand', 'Expand')");
  });

  it('keeps the WorkflowOperatorDslDialog component', () => {
    expect(source).toContain('WorkflowOperatorDslDialog');
  });

  it('English locale has new i18n keys', () => {
    expect(enLocale).toContain('resizeOperatorDslSplit');
    expect(enLocale).toContain('showDslOnly');
    expect(enLocale).toContain('showFormOnly');
    expect(enLocale).toContain('restoreSplitView');
    expect(enLocale).toContain('splitModeSwitchBar');
  });

  it('Chinese locale has new i18n keys', () => {
    expect(zhLocale).toContain('resizeOperatorDslSplit');
    expect(zhLocale).toContain('showDslOnly');
    expect(zhLocale).toContain('showFormOnly');
    expect(zhLocale).toContain('restoreSplitView');
    expect(zhLocale).toContain('splitModeSwitchBar');
  });
});
