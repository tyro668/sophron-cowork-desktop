import type { FinalConnectionState } from '@xyflow/react';
import {
  EMPTY_WORKFLOW_ALIGNMENT_GUIDES,
  WORKFLOW_ALIGNMENT_GUIDE_PADDING,
  WORKFLOW_ALIGNMENT_THRESHOLD,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  type WorkflowAlignmentGuides,
  type WorkflowFlowNode,
} from './workflow-model';

export function getNextWorkflowNodePosition(index: number): { x: number; y: number } {
  return {
    x: 64 + (index % 4) * 150,
    y: 72 + Math.floor(index / 4) * 64,
  };
}

export function getWorkflowAlignmentSnap(
  nodeId: string,
  position: { x: number; y: number },
  nodes: WorkflowFlowNode[]
): { position: { x: number; y: number }; guides: WorkflowAlignmentGuides } {
  const otherNodes = nodes.filter((node) => node.id !== nodeId);
  if (otherNodes.length === 0) {
    return { position, guides: EMPTY_WORKFLOW_ALIGNMENT_GUIDES };
  }

  let verticalMatch: {
    distance: number;
    x: number;
    snappedX: number;
    node: WorkflowFlowNode;
  } | null = null;
  let horizontalMatch: {
    distance: number;
    y: number;
    snappedY: number;
    node: WorkflowFlowNode;
  } | null = null;
  const activeLeft = position.x;
  const activeRight = position.x + WORKFLOW_NODE_WIDTH;
  const activeCenterY = position.y + WORKFLOW_NODE_HEIGHT / 2;

  for (const node of otherNodes) {
    const otherLeft = node.position.x;
    const otherRight = node.position.x + WORKFLOW_NODE_WIDTH;
    const otherCenterY = node.position.y + WORKFLOW_NODE_HEIGHT / 2;
    const leftDistance = Math.abs(activeLeft - otherLeft);
    const rightDistance = Math.abs(activeRight - otherRight);
    const centerYDistance = Math.abs(activeCenterY - otherCenterY);

    if (
      leftDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || leftDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: leftDistance,
        x: otherLeft,
        snappedX: otherLeft,
        node,
      };
    }
    if (
      rightDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || rightDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: rightDistance,
        x: otherRight,
        snappedX: otherRight - WORKFLOW_NODE_WIDTH,
        node,
      };
    }
    if (
      centerYDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!horizontalMatch || centerYDistance < horizontalMatch.distance)
    ) {
      horizontalMatch = {
        distance: centerYDistance,
        y: otherCenterY,
        snappedY: otherCenterY - WORKFLOW_NODE_HEIGHT / 2,
        node,
      };
    }
  }

  const snappedPosition = {
    x: verticalMatch ? verticalMatch.snappedX : position.x,
    y: horizontalMatch ? horizontalMatch.snappedY : position.y,
  };
  const guides: WorkflowAlignmentGuides = {
    horizontal: horizontalMatch
      ? {
          id: `horizontal-${horizontalMatch.node.id}`,
          orientation: 'horizontal',
          x1:
            Math.min(snappedPosition.x, horizontalMatch.node.position.x) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          x2:
            Math.max(
              snappedPosition.x + WORKFLOW_NODE_WIDTH,
              horizontalMatch.node.position.x + WORKFLOW_NODE_WIDTH
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y: horizontalMatch.y,
        }
      : null,
    vertical: verticalMatch
      ? {
          id: `vertical-${verticalMatch.node.id}`,
          orientation: 'vertical',
          x: verticalMatch.x,
          y1:
            Math.min(snappedPosition.y, verticalMatch.node.position.y) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y2:
            Math.max(
              snappedPosition.y + WORKFLOW_NODE_HEIGHT,
              verticalMatch.node.position.y + WORKFLOW_NODE_HEIGHT
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
        }
      : null,
  };

  return { position: snappedPosition, guides };
}

function getElementFromConnectEndEvent(event: MouseEvent | TouchEvent): Element | null {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return document.elementFromPoint(touch.clientX, touch.clientY);
  }
  return event.target instanceof Element ? event.target : null;
}

export function getWorkflowConnectionDropTarget(
  event: MouseEvent | TouchEvent,
  connectionState: FinalConnectionState
): { nodeId: string; handleId: string } | null {
  if (connectionState.toNode?.id && connectionState.toHandle?.id) {
    return {
      nodeId: connectionState.toNode.id,
      handleId: connectionState.toHandle.id,
    };
  }
  const targetElement = getElementFromConnectEndEvent(event);
  const handleElement = targetElement?.closest<HTMLElement>('[data-handleid]');
  const nodeElement = handleElement?.closest<HTMLElement>('[data-node-id]');
  const nodeId = nodeElement?.dataset.nodeId;
  const handleId = handleElement?.dataset.handleid;
  if (!nodeId || !handleId) {
    return null;
  }
  return { nodeId, handleId };
}
