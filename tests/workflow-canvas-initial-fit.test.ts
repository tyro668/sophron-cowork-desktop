import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_FIT_VIEW_OPTIONS,
  WORKFLOW_MAX_ZOOM,
  WORKFLOW_MIN_ZOOM,
} from '../src/renderer/components/data-view/data-pipelines/workflow/WorkflowCanvas';

const W = 'src/renderer/components/data-view/data-pipelines/workflow/';

describe('workflow canvas initial fit', () => {
  it('clamps the fit zoom so small chains are not oversized and big ones stay readable', () => {
    expect(WORKFLOW_FIT_VIEW_OPTIONS.maxZoom).toBeGreaterThanOrEqual(0.85);
    expect(WORKFLOW_FIT_VIEW_OPTIONS.maxZoom).toBeLessThanOrEqual(1);
    expect(WORKFLOW_FIT_VIEW_OPTIONS.minZoom).toBeGreaterThanOrEqual(0.3);
    expect(WORKFLOW_MIN_ZOOM).toBeLessThanOrEqual(WORKFLOW_FIT_VIEW_OPTIONS.minZoom);
    expect(WORKFLOW_MAX_ZOOM).toBeGreaterThan(1);
  });
  it('fits after nodes are initialized and the pane has a size, keyed by pipeline, until the user moves', () => {
    const s = readFileSync(W + 'WorkflowCanvas.tsx', 'utf8');
    expect(s).toContain('useNodesInitialized()');
    expect(s).toMatch(
      /nodeCount === 0 \|\| !nodesInitialized \|\| paneWidth <= 0 \|\| paneHeight <= 0/
    );
    expect(s).toContain('requestAnimationFrame');
    expect(s).toContain('onMoveStart={handleMoveStart}');
    expect(s).toContain('if (event) autoFitRef.current.active = false;');
    // toolbar + tidy share the same fit logic
    expect(s).toContain('onClick={() => fitCanvas(200)}');
    expect(s).toContain('fitCanvas(250)');
    expect(readFileSync(W + 'PipelineEditor.tsx', 'utf8')).toContain('fitKey={pipeline.id}');
  });
});
