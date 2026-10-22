import type { DataWorkflowEdge, DataWorkflowNode } from '../../../../types';
import { WORKFLOW_NODE_HEIGHT, WORKFLOW_NODE_WIDTH } from './workflow-model';
import { collapseWorkflowComposites } from './workflow-composites';

const LAYER_STEP = 260; // column pitch — matches the merge offset used elsewhere
const ROW_STEP = WORKFLOW_NODE_HEIGHT + 44;
const ROW_GAP = 140;
const COMPONENT_GAP = 140;
const ORIGIN_X = 48;
const ORIGIN_Y = 48;
// Row-direction scoring counts backward edges first, span second.
const BACKWARD_EDGE_PENALTY = 100_000;

/**
 * Layered left-to-right auto layout ("tidy") with viewport-aware wrapping:
 * - weakly-connected components become vertical bands, stacked top to bottom;
 * - within a component, nodes are layered by longest path from the sources
 *   (cycle-safe: leftovers settle one column past their resolved parents);
 * - columns order their members by barycenter sweeps over predecessor and
 *   successor positions to reduce edge crossings;
 * - when a component has more columns than fit `viewportWidth` at 100% zoom,
 *   columns wrap onto additional rows. Each wrapped row picks its direction
 *   greedily — left-to-right keeps the row's own edges flowing forward
 *   (a single "carriage-return" edge at the wrap point), while right-to-left
 *   lands the row head under the previous tail (short wrap edge, reversed
 *   intra-row edges). Whichever produces fewer/shorter backward edges wins;
 *   ties keep left-to-right for a consistent reading direction;
 * - each column is vertically centered inside its row band.
 *
 * `viewportWidth` is the canvas pane width in pixels; `Infinity` disables
 * wrapping entirely (one row per component).
 */
export function layoutWorkflowNodes(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[],
  viewportWidth = Number.POSITIVE_INFINITY
): DataWorkflowNode[] {
  // Composite steps lay out as their (collapsed) main node; the helpers sit in a row just below it
  // so expanding a group shows its chain without disturbing the rest of the canvas.
  const view = collapseWorkflowComposites(nodes, edges, new Set());
  if (view.hiddenToMain.size === 0) return layoutFlat(nodes, edges, viewportWidth);
  const placed = new Map(layoutFlat(view.nodes, view.edges, viewportWidth).map((n) => [n.id, n]));
  for (const info of view.composites.values()) {
    const main = placed.get(info.id);
    if (!main) continue;
    const helpers = info.memberIds.filter((id) => id !== info.id);
    helpers.forEach((id, index) => {
      const node = nodes.find((item) => item.id === id);
      if (!node) return;
      placed.set(id, {
        ...node,
        x: Math.round(main.x - (helpers.length - index) * (WORKFLOW_NODE_WIDTH + 24)),
        y: Math.round(main.y + ROW_STEP),
      });
    });
  }
  return nodes.map((node) => placed.get(node.id) ?? node);
}

function layoutFlat(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[],
  viewportWidth: number
): DataWorkflowNode[] {
  if (nodes.length === 0) return nodes;

  // Columns that fit the pane at zoom 1: x = ORIGIN_X + i*LAYER_STEP must leave
  // room for the node's own width inside the usable width.
  const usableWidth = Math.max(viewportWidth - ORIGIN_X * 2, LAYER_STEP + WORKFLOW_NODE_WIDTH);
  const maxColumnsPerRow = Math.max(
    2,
    Math.floor((usableWidth - WORKFLOW_NODE_WIDTH) / LAYER_STEP) + 1
  );

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const linked = new Map<string, Set<string>>();
  for (const node of nodes) {
    preds.set(node.id, []);
    succs.set(node.id, []);
    linked.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (!preds.has(edge.sourceNodeId) || !preds.has(edge.targetNodeId)) continue;
    preds.get(edge.targetNodeId)!.push(edge.sourceNodeId);
    succs.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    linked.get(edge.sourceNodeId)!.add(edge.targetNodeId);
    linked.get(edge.targetNodeId)!.add(edge.sourceNodeId);
  }

  // Weakly-connected components (undirected reachability).
  const componentOf = new Map<string, number>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (componentOf.has(node.id)) continue;
    const index = components.length;
    const members: string[] = [];
    const queue = [node.id];
    componentOf.set(node.id, index);
    while (queue.length > 0) {
      const id = queue.shift()!;
      members.push(id);
      for (const next of linked.get(id) ?? []) {
        if (!componentOf.has(next)) {
          componentOf.set(next, index);
          queue.push(next);
        }
      }
    }
    components.push(members);
  }
  // Deterministic component order: biggest first, ties by first node's y.
  const originalY = new Map(nodes.map((node) => [node.id, node.y]));
  components.sort(
    (a, b) => b.length - a.length || (originalY.get(a[0]) ?? 0) - (originalY.get(b[0]) ?? 0)
  );

  const positions = new Map<string, { x: number; y: number }>();
  let bandTop = ORIGIN_Y;

  for (const members of components) {
    const memberSet = new Set(members);

    // Layer = longest path distance from a component source. Kahn's algorithm;
    // cyclic leftovers resolve against whatever predecessors already settled.
    const indegree = new Map(members.map((id) => [id, 0]));
    for (const id of members) {
      indegree.set(id, preds.get(id)!.filter((pred) => memberSet.has(pred)).length);
    }
    const layer = new Map<string, number>();
    const queue = members.filter((id) => (indegree.get(id) ?? 0) === 0);
    for (const id of queue) layer.set(id, 0);
    const processed = new Set<string>();
    const pending = [...queue];
    while (pending.length > 0) {
      const id = pending.shift()!;
      processed.add(id);
      for (const next of succs.get(id)!) {
        if (!memberSet.has(next)) continue;
        layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining <= 0 && !processed.has(next) && !pending.includes(next)) {
          pending.push(next);
        }
      }
    }
    for (const id of members) {
      if (layer.has(id)) continue;
      const settledPreds = preds.get(id)!.filter((pred) => layer.has(pred));
      layer.set(
        id,
        settledPreds.length > 0 ? Math.max(...settledPreds.map((pred) => layer.get(pred)!)) + 1 : 0
      );
    }

    // Group into columns by layer, then reduce crossings with alternating
    // barycenter sweeps (down: order by mean predecessor slot; up: successors).
    const maxLayer = Math.max(...members.map((id) => layer.get(id)!));
    const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const id of members) columns[layer.get(id)!].push(id);
    for (const column of columns) {
      column.sort((a, b) => (originalY.get(a) ?? 0) - (originalY.get(b) ?? 0));
    }
    const slotOf = (): Map<string, number> => {
      const slots = new Map<string, number>();
      columns.forEach((column) => column.forEach((id, index) => slots.set(id, index)));
      return slots;
    };
    for (let sweep = 0; sweep < 4; sweep += 1) {
      const slots = slotOf();
      if (sweep % 2 === 0) {
        for (let level = 1; level <= maxLayer; level += 1) {
          columns[level].sort(
            (a, b) =>
              meanSlot(preds.get(a)!, slots, memberSet) - meanSlot(preds.get(b)!, slots, memberSet)
          );
        }
      } else {
        for (let level = maxLayer - 1; level >= 0; level -= 1) {
          columns[level].sort(
            (a, b) =>
              meanSlot(succs.get(a)!, slots, memberSet) - meanSlot(succs.get(b)!, slots, memberSet)
          );
        }
      }
    }

    // Split columns into wrapped rows. Each wrapped row picks its direction
    // greedily by which yields fewer/shorter backward edges (edges whose
    // target sits left of the source's output handle draw a wide loop, so
    // backward count dominates and span breaks ties):
    // - left-to-right keeps the row's own edges forward — the wrap point
    //   becomes one long "carriage-return" edge back to the left;
    // - right-to-left lands the row head under the previous tail (short wrap
    //   edge) but every intra-row edge runs backward.
    // Ties prefer left-to-right for a consistent reading direction.
    const rows: string[][][] = [];
    for (let start = 0; start < columns.length; start += maxColumnsPerRow) {
      rows.push(columns.slice(start, start + maxColumnsPerRow));
    }
    const rowOf = new Map<string, number>();
    const columnOffsetOf = new Map<string, number>();
    rows.forEach((row, rowIndex) =>
      row.forEach((column, columnIndex) =>
        column.forEach((id) => {
          rowOf.set(id, rowIndex);
          columnOffsetOf.set(id, columnIndex);
        })
      )
    );
    const placedVisualColumn = new Map<string, number>();
    let previousTailVisual = 0;
    rows.forEach((row, rowIndex) => {
      const rowLength = row.length;
      let leftToRight = true;
      if (rowIndex > 0) {
        // Right-to-left rows anchor their head under the previous tail, so
        // the wrap edge collapses into a short drop; clamp the head so the
        // reversed row never extends past the left edge.
        const edgeCost = (ltr: boolean): number => {
          const headVisual = ltr ? 0 : Math.max(previousTailVisual, rowLength - 1);
          const visualFor = (id: string): number | undefined => {
            if (rowOf.get(id) === rowIndex) {
              const offset = columnOffsetOf.get(id)!;
              return ltr ? offset : headVisual - offset;
            }
            return placedVisualColumn.get(id);
          };
          let total = 0;
          for (const edge of edges) {
            if (rowOf.get(edge.targetNodeId) !== rowIndex) continue;
            const sourceVisual = visualFor(edge.sourceNodeId);
            const targetVisual = visualFor(edge.targetNodeId);
            if (sourceVisual === undefined || targetVisual === undefined) continue;
            const sourceX = sourceVisual * LAYER_STEP + WORKFLOW_NODE_WIDTH;
            const targetX = targetVisual * LAYER_STEP;
            total +=
              targetX < sourceX ? BACKWARD_EDGE_PENALTY + sourceX - targetX : targetX - sourceX;
          }
          return total;
        };
        leftToRight = edgeCost(true) <= edgeCost(false);
      }
      const headVisual = leftToRight ? 0 : Math.max(previousTailVisual, rowLength - 1);
      const rowHeight = Math.max(
        ...row.map((column) => column.length * ROW_STEP - (ROW_STEP - WORKFLOW_NODE_HEIGHT))
      );
      row.forEach((column, columnIndex) => {
        const visualColumn = leftToRight ? columnIndex : headVisual - columnIndex;
        const columnHeight = column.length * ROW_STEP - (ROW_STEP - WORKFLOW_NODE_HEIGHT);
        const top = bandTop + Math.max(0, (rowHeight - columnHeight) / 2);
        column.forEach((id, index) => {
          placedVisualColumn.set(id, visualColumn);
          positions.set(id, {
            x: ORIGIN_X + visualColumn * LAYER_STEP,
            y: Math.round(top + index * ROW_STEP),
          });
        });
      });
      previousTailVisual = leftToRight ? rowLength - 1 : headVisual - (rowLength - 1);
      bandTop += rowHeight + ROW_GAP;
    });
    bandTop += COMPONENT_GAP - ROW_GAP;
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

function meanSlot(ids: string[], slots: Map<string, number>, memberSet: Set<string>): number {
  const hits = ids.filter((id) => memberSet.has(id) && slots.has(id));
  if (hits.length === 0) return Number.MAX_SAFE_INTEGER;
  return hits.reduce((sum, id) => sum + slots.get(id)!, 0) / hits.length;
}
