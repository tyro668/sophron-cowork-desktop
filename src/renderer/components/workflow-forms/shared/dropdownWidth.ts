let textMeasureContext: CanvasRenderingContext2D | null = null;

export interface DropdownWidth {
  minWidth: number;
  maxWidth: number;
}

export function computeDropdownWidth(triggerWidth: number, contentWidth: number): DropdownWidth {
  const maxWidth = triggerWidth * 2;
  return {
    minWidth: Math.min(Math.max(triggerWidth, contentWidth), maxWidth),
    maxWidth,
  };
}

function getTextMeasureContext(fontSize: number): CanvasRenderingContext2D {
  if (!textMeasureContext) {
    textMeasureContext = document.createElement('canvas').getContext('2d');
    if (!textMeasureContext) {
      throw new Error('Canvas 2D context is required to measure dropdown option widths');
    }
  }
  textMeasureContext.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
  return textMeasureContext;
}

/** Widest rendered text width plus extra room for item paddings and the
 *  vertical scrollbar, so a dropdown panel can size itself to its longest
 *  option instead of truncating it behind a horizontal scrollbar. Returns 0
 *  outside a browser (SSR renders closed panels, trigger width applies). */
export function measureMaxTextWidth(
  texts: readonly string[],
  fontSize = 13,
  extraPadding = 48
): number {
  if (texts.length === 0 || typeof document === 'undefined') return 0;
  const context = getTextMeasureContext(fontSize);
  let max = 0;
  for (const text of texts) {
    max = Math.max(max, context.measureText(text).width);
  }
  return max + extraPadding;
}
