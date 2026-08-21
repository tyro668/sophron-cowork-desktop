import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_MIN_HEIGHT,
  DEFAULT_SPLIT_RATIO,
  DSL_MIN_HEIGHT,
  PANEL_BOTTOM_PADDING,
  PANEL_TOP_PADDING,
  SPLIT_HANDLE_HEIGHT,
  calculateOperatorPanelHeightBounds,
  calculateOperatorPanelSplitLayout,
} from '../src/renderer/components/data-view/operator-panel-layout';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/data-view/WorkflowOperatorConfigPanel.tsx'),
  'utf8'
);
const inspectorSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/data-view/data-tasks.tsx'),
  'utf8'
);

describe('WorkflowOperatorConfigPanel adjustable layout', () => {
  it('always shows the graphical configuration and read-only DSL preview', () => {
    expect(source).toContain('<OperatorFormWrapper');
    expect(source).toContain('editable={false}');
    expect(source).not.toContain('OperatorPanelSplitMode');
    expect(source).not.toContain('splitMode');
  });

  it('does not add a second mode switcher to the inspector header', () => {
    expect(inspectorSource).not.toContain('operatorPanelMode');
    expect(inspectorSource).not.toContain('graphicalConfig');
    expect(inspectorSource).not.toContain('splitView');
    expect(inspectorSource).not.toContain('dslView');
  });

  it('allows both panes to become compact while preserving useful content', () => {
    expect(CONFIG_MIN_HEIGHT).toBe(72);
    expect(DSL_MIN_HEIGHT).toBe(76);
    expect(source).toContain('min-h-[32px]');
  });

  it('collapses the DSL preview at the bottom and exposes a rounded restore button', () => {
    expect(source).toContain('{!splitLayout.isDslCollapsed && (');
    expect(source).toContain('onClick={handleRestoreDslPreview}');
    expect(source).toContain("t('data.workflow.expandDslPreview', 'Expand DSL preview')");
    expect(source).toContain('viewBox="0 0 36 20"');
    expect(source).toContain('C1 5 5 1 10 1');
    expect(source).toContain('h-5 w-9');
    expect(source).toContain('h-7 w-9');
    expect(source).toContain('strokeLinejoin="round"');
    expect(source).toContain('group-focus-visible:ring-2');
    expect(source).toContain('group-focus-visible:opacity-100');
    expect(source).toContain("splitLayout.isDslCollapsed ? 'pb-0' : 'pb-2'");
    expect(source).toContain('? CONFIG_MIN_HEIGHT + SPLIT_HANDLE_HEIGHT + PANEL_TOP_PADDING');
    expect(source).not.toContain(
      'if (availableHeight < CONFIG_MIN_HEIGHT + DSL_MIN_HEIGHT) return;'
    );
  });

  it('restores a visible DSL preview even when the collapsed panel starts short', () => {
    const collapsed = calculateOperatorPanelSplitLayout(100, 1);
    const restored = calculateOperatorPanelSplitLayout(100, DEFAULT_SPLIT_RATIO);

    expect(collapsed.isDslCollapsed).toBe(true);
    expect(collapsed.bottomHeight).toBe(0);
    expect(restored.isDslCollapsed).toBe(false);
  });

  it('reserves both minimum pane heights after the expanded panel reaches its minimum size', () => {
    const expandedPanelHeight =
      CONFIG_MIN_HEIGHT +
      DSL_MIN_HEIGHT +
      SPLIT_HANDLE_HEIGHT +
      PANEL_TOP_PADDING +
      PANEL_BOTTOM_PADDING;
    const layout = calculateOperatorPanelSplitLayout(expandedPanelHeight, DEFAULT_SPLIT_RATIO);

    expect(layout.isDslCollapsed).toBe(false);
    expect(layout.topHeight).toBeGreaterThanOrEqual(CONFIG_MIN_HEIGHT);
    expect(layout.bottomHeight).toBeGreaterThanOrEqual(DSL_MIN_HEIGHT);
    expect(layout.canDrag).toBe(false);

    const adjustableLayout = calculateOperatorPanelSplitLayout(
      expandedPanelHeight + 1,
      DEFAULT_SPLIT_RATIO
    );
    expect(adjustableLayout.canDrag).toBe(true);
  });

  it('uses one shared set of height boundaries for layout and interaction', () => {
    const paneHeight = 500;
    const bounds = calculateOperatorPanelHeightBounds(paneHeight);

    expect(bounds.availableHeight).toBe(
      paneHeight - SPLIT_HANDLE_HEIGHT - PANEL_TOP_PADDING - PANEL_BOTTOM_PADDING
    );
    expect(bounds.maxVisibleTopHeight).toBe(bounds.availableHeight - DSL_MIN_HEIGHT);
    expect(bounds.canShowBothPanes).toBe(true);
    expect(bounds.canDrag).toBe(true);
  });

  it('exposes an accessible separator for pointer and keyboard resizing', () => {
    expect(source).toContain("role={isSplitAdjustable ? 'separator' : undefined}");
    expect(source).toContain('aria-valuemin={isSplitAdjustable ? CONFIG_MIN_HEIGHT : undefined}');
    expect(source).toContain(
      'aria-valuenow={isSplitAdjustable ? Math.round(splitLayout.topHeight) : undefined}'
    );
    expect(source).toContain('tabIndex={isSplitAdjustable ? 0 : -1}');
    expect(source).toContain('handleSplitPointerDown');
    expect(source).toContain('handleSplitKeyDown');
    expect(source).toContain('if (nextTopHeight > maxVisibleTopHeight)');
    expect(source).toContain('splitLayout.topHeight - 16');
    expect(source).toContain('splitLayout.topHeight + 16');
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'Home'");
    expect(source).toContain("event.key === 'End'");
    expect(source).toContain('<GripHorizontal className="h-4 w-4"');
  });

  it('preserves the chosen height ratio when selecting another node', () => {
    expect(source).toContain('const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);');
    expect(source).toContain('const handleRestoreDslPreview = useCallback(() => {');
  });

  it('keeps copy, expand, and the full DSL editing dialog', () => {
    expect(source).toContain("t('data.workflow.copyDsl', 'Copy DSL')");
    expect(source).toContain("t('common.expand', 'Expand')");
    expect(source).toContain('WorkflowOperatorDslDialog');
  });
});
