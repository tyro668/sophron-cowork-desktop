export const CONFIG_MIN_HEIGHT = 72;
export const DSL_MIN_HEIGHT = 76;
export const SPLIT_HANDLE_HEIGHT = 20;
export const DEFAULT_SPLIT_RATIO = 0.72;
export const DSL_COLLAPSE_RATIO = 1;
export const PANEL_TOP_PADDING = 8;
export const PANEL_BOTTOM_PADDING = 8;

export interface OperatorPanelSplitLayout {
  topHeight: number;
  bottomHeight: number;
  canDrag: boolean;
  isDslCollapsed: boolean;
}

export interface OperatorPanelHeightBounds {
  availableHeight: number;
  maxVisibleTopHeight: number;
  canShowBothPanes: boolean;
  canDrag: boolean;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function calculateOperatorPanelHeightBounds(paneHeight: number): OperatorPanelHeightBounds {
  const availableHeight = Math.max(
    0,
    paneHeight - SPLIT_HANDLE_HEIGHT - PANEL_TOP_PADDING - PANEL_BOTTOM_PADDING
  );
  const minimumPanesHeight = CONFIG_MIN_HEIGHT + DSL_MIN_HEIGHT;

  return {
    availableHeight,
    maxVisibleTopHeight: Math.max(0, availableHeight - DSL_MIN_HEIGHT),
    canShowBothPanes: availableHeight >= minimumPanesHeight,
    canDrag: availableHeight > minimumPanesHeight,
  };
}

export function calculateOperatorPanelSplitLayout(
  paneHeight: number,
  splitRatio: number
): OperatorPanelSplitLayout {
  const {
    availableHeight: expandedAvailableHeight,
    maxVisibleTopHeight,
    canShowBothPanes,
    canDrag,
  } = calculateOperatorPanelHeightBounds(paneHeight);
  const minTopHeight = canShowBothPanes ? CONFIG_MIN_HEIGHT : 0;
  const maxTopHeight = canShowBothPanes ? maxVisibleTopHeight : expandedAvailableHeight;
  const requestedTopHeight = clampNumber(
    expandedAvailableHeight * splitRatio,
    minTopHeight,
    maxTopHeight
  );
  const isDslCollapsed = splitRatio >= DSL_COLLAPSE_RATIO;
  const availableHeight = isDslCollapsed
    ? Math.max(0, paneHeight - SPLIT_HANDLE_HEIGHT - PANEL_TOP_PADDING)
    : expandedAvailableHeight;
  const topHeight = isDslCollapsed ? availableHeight : requestedTopHeight;

  return {
    topHeight,
    bottomHeight: isDslCollapsed ? 0 : Math.max(0, availableHeight - topHeight),
    canDrag,
    isDslCollapsed,
  };
}
