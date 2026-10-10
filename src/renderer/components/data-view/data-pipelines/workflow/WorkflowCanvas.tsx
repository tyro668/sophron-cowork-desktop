import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type NodeChange,
  type OnConnectStartParams,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Ban, Copy, Trash2 } from 'lucide-react';
import type {
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
} from '../../../../types';
import { DataToolbarButton } from '../../shared';
import { useSystemDarkMode, useThemeSetting } from '../../../../store/selectors';
import { getWorkflowAlignmentSnap, getWorkflowConnectionDropTarget } from './canvas-utils';
import { isWorkflowOperatorType } from './operator-catalog';
import { canConnectWorkflowNodes } from './workflow-graph-operations';
import { WorkflowAlignmentGuidesOverlay, WorkflowEdge, WorkflowOperatorNode } from './WorkflowUi';
import {
  EMPTY_WORKFLOW_ALIGNMENT_GUIDES,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  WORKFLOW_OPERATOR_MIME,
  type WorkflowAlignmentGuides,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
} from './workflow-model';

const WORKFLOW_NODE_TYPES = {
  operator: WorkflowOperatorNode,
};
const WORKFLOW_EDGE_TYPES = {
  workflow: WorkflowEdge,
};

// Hoisted to module scope: passing new object/function identities to ReactFlow
// on every render defeats the memoization of GraphView/NodeRenderer/NodeWrapper,
// which makes every node re-render on each drag frame.
const WORKFLOW_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const WORKFLOW_PRO_OPTIONS = { hideAttribution: true };
const WORKFLOW_MINIMAP_STYLE = { width: 100, height: 75 };
const WORKFLOW_DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'workflow',
};

function getWorkflowMinimapNodeColor() {
  return 'var(--workflow-minimap-node)';
}

export function WorkflowCanvas({
  nodes,
  edges,
  invalidNodeIds,
  selectedNodeIds,
  primaryNodeId,
  layoutEpoch,
  onSelectionChange,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
  onViewportSizeChange,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  invalidNodeIds?: ReadonlySet<string>;
  selectedNodeIds: readonly string[];
  /** Last-clicked node — drives the inspector and the toolbar's label. */
  primaryNodeId: string | null;
  /** Bumped by the tidy action — refits the viewport onto the new layout. */
  layoutEpoch?: number;
  onSelectionChange: (ids: string[], primaryId: string | null) => void;
  onDuplicateNode: () => void;
  onToggleNodeDisabled: () => void;
  onDeleteNode: () => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
  /** Reports the RF pane size — the tidy layout wraps rows to fit at 100%. */
  onViewportSizeChange?: (size: { width: number; height: number }) => void;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasContent
        nodes={nodes}
        edges={edges}
        invalidNodeIds={invalidNodeIds}
        selectedNodeIds={selectedNodeIds}
        primaryNodeId={primaryNodeId}
        layoutEpoch={layoutEpoch}
        onSelectionChange={onSelectionChange}
        onDuplicateNode={onDuplicateNode}
        onToggleNodeDisabled={onToggleNodeDisabled}
        onDeleteNode={onDeleteNode}
        onAddNode={onAddNode}
        onMoveNode={onMoveNode}
        onConnectNodes={onConnectNodes}
        onReconnectEdge={onReconnectEdge}
        onRemoveEdge={onRemoveEdge}
        onViewportSizeChange={onViewportSizeChange}
      />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasContent({
  nodes,
  edges,
  invalidNodeIds,
  selectedNodeIds,
  primaryNodeId,
  layoutEpoch,
  onSelectionChange,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
  onViewportSizeChange,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  invalidNodeIds?: ReadonlySet<string>;
  selectedNodeIds: readonly string[];
  primaryNodeId: string | null;
  layoutEpoch?: number;
  onSelectionChange: (ids: string[], primaryId: string | null) => void;
  onDuplicateNode: () => void;
  onToggleNodeDisabled: () => void;
  onDeleteNode: () => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
  onViewportSizeChange?: (size: { width: number; height: number }) => void;
}) {
  const { t } = useTranslation();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const onViewportSizeChangeRef = useRef(onViewportSizeChange);
  onViewportSizeChangeRef.current = onViewportSizeChange;
  useEffect(() => {
    onViewportSizeChangeRef.current?.({ width: paneWidth, height: paneHeight });
  }, [paneWidth, paneHeight]);
  const themeSetting = useThemeSetting();
  const systemDarkMode = useSystemDarkMode();
  const colorMode = themeSetting === 'system' ? (systemDarkMode ? 'dark' : 'light') : themeSetting;
  const [connectionStart, setConnectionStart] = useState<OnConnectStartParams | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedIdSet.has(node.id)),
    [nodes, selectedIdSet]
  );
  const primaryNode = useMemo(
    () => nodes.find((node) => node.id === primaryNodeId) ?? selectedNodes[0] ?? null,
    [nodes, primaryNodeId, selectedNodes]
  );
  const allSelectedDisabled =
    selectedNodes.length > 0 && selectedNodes.every((node) => node.config.disabled === true);
  const mappedFlowNodes = useMemo<WorkflowFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'operator',
        position: { x: node.x, y: node.y },
        width: WORKFLOW_NODE_WIDTH,
        height: WORKFLOW_NODE_HEIGHT,
        initialWidth: WORKFLOW_NODE_WIDTH,
        initialHeight: WORKFLOW_NODE_HEIGHT,
        // adoptUserNodes rebuilds the internal node whenever a new node object
        // arrives; without `measured`, parseHandles wipes internals.handleBounds
        // and every edge on that node hides until a re-measure (which can get
        // stuck, leaving all edges invisible until remount). Passing the known
        // fixed size keeps measured handleBounds across rebuilds.
        measured: { width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT },
        dragHandle: '.workflow-node-drag-handle',
        draggable: true,
        selectable: true,
        selected: selectedIdSet.has(node.id),
        data: {
          workflowNode: node,
          invalid: invalidNodeIds?.has(node.id),
        },
      })),
    [nodes, selectedIdSet, invalidNodeIds]
  );
  const mappedFlowEdges = useMemo<WorkflowFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        type: 'workflow',
        selectable: true,
        reconnectable: true,
        interactionWidth: 18,
      })),
    [edges]
  );
  const [flowNodes, setFlowNodes] = useState<WorkflowFlowNode[]>(mappedFlowNodes);
  const [flowEdges, setFlowEdges] = useState<WorkflowFlowEdge[]>(mappedFlowEdges);
  const [alignmentGuides, setAlignmentGuides] = useState<WorkflowAlignmentGuides>(
    EMPTY_WORKFLOW_ALIGNMENT_GUIDES
  );
  const flowNodesRef = useRef<WorkflowFlowNode[]>(mappedFlowNodes);
  const connectSucceededRef = useRef(false);
  const reconnectSucceededRef = useRef(false);
  const reconnectingEdgeIdRef = useRef<string | undefined>();

  useEffect(() => {
    flowNodesRef.current = mappedFlowNodes;
    setFlowNodes(mappedFlowNodes);
  }, [mappedFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedFlowEdges);
  }, [mappedFlowEdges]);

  // Tidy action bumped the epoch → recenter the viewport onto the new layout.
  const layoutEpochRef = useRef(layoutEpoch ?? 0);
  useEffect(() => {
    if (layoutEpoch === undefined || layoutEpoch === layoutEpochRef.current) return;
    layoutEpochRef.current = layoutEpoch;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.15, duration: 250, maxZoom: 1 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [layoutEpoch, fitView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      let nextGuides = EMPTY_WORKFLOW_ALIGNMENT_GUIDES;
      const snappedChanges = changes.map((change) => {
        if (change.type !== 'position' || !change.dragging || !change.position) {
          return change;
        }
        const snap = getWorkflowAlignmentSnap(change.id, change.position, flowNodesRef.current);
        nextGuides = snap.guides;
        return {
          ...change,
          position: snap.position,
          positionAbsolute: snap.position,
        };
      });
      setAlignmentGuides(nextGuides);
      const nextNodes = applyNodeChanges(snappedChanges, flowNodesRef.current);
      flowNodesRef.current = nextNodes;
      setFlowNodes(nextNodes);
      const selectChanges = snappedChanges.filter((change) => change.type === 'select');
      if (selectChanges.length > 0) {
        const selectedIds = nextNodes.filter((item) => item.selected).map((item) => item.id);
        const lastSelected = [...selectChanges].reverse().find((change) => change.selected)?.id;
        onSelectionChange(selectedIds, lastSelected ?? selectedIds[selectedIds.length - 1] ?? null);
      }
    },
    [onSelectionChange]
  );

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    setFlowEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      connectSucceededRef.current = true;
      onConnectNodes(
        connection.source,
        connection.target,
        connection.sourceHandle ?? 'output',
        connection.targetHandle ?? 'input'
      );
      onSelectionChange([connection.target], connection.target);
    },
    [onConnectNodes, onSelectionChange]
  );
  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      connectSucceededRef.current = false;
      setConnectionStart(params);
    },
    []
  );
  const isValidWorkflowConnection = useCallback(
    (connection: Edge | Connection) =>
      Boolean(
        connection.source &&
        connection.target &&
        canConnectWorkflowNodes(
          nodes,
          edges,
          {
            sourceNodeId: connection.source,
            targetNodeId: connection.target,
            sourceHandle: connection.sourceHandle,
            targetHandle: connection.targetHandle,
          },
          reconnectingEdgeIdRef.current
        )
      ),
    [edges, nodes]
  );
  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, edge: WorkflowFlowEdge, _handleType: HandleType) => {
      reconnectSucceededRef.current = false;
      reconnectingEdgeIdRef.current = edge.id;
    },
    []
  );
  const handleReconnect = useCallback(
    (oldEdge: WorkflowFlowEdge, newConnection: Connection) => {
      reconnectSucceededRef.current = true;
      setFlowEdges((currentEdges) =>
        reconnectEdge(oldEdge, newConnection, currentEdges, { shouldReplaceId: false })
      );
      onReconnectEdge(oldEdge.id, newConnection);
    },
    [onReconnectEdge]
  );
  const handleReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: WorkflowFlowEdge,
      _handleType: HandleType,
      connectionState: FinalConnectionState
    ) => {
      if (!reconnectSucceededRef.current && connectionState.isValid !== true) {
        setFlowEdges((currentEdges) => currentEdges.filter((item) => item.id !== edge.id));
        onRemoveEdge(edge.id);
      }
      reconnectSucceededRef.current = false;
      reconnectingEdgeIdRef.current = undefined;
    },
    [onRemoveEdge]
  );
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectSucceededRef.current) {
        connectSucceededRef.current = false;
        setConnectionStart(null);
        return;
      }
      const sourceNodeId = connectionStart?.nodeId ?? connectionState.fromNode?.id ?? null;
      if (!sourceNodeId) {
        setConnectionStart(null);
        return;
      }
      const dropTarget = getWorkflowConnectionDropTarget(event, connectionState);
      if (dropTarget && dropTarget.nodeId !== sourceNodeId) {
        onConnectNodes(
          sourceNodeId,
          dropTarget.nodeId,
          connectionStart?.handleId ?? 'output',
          dropTarget.handleId
        );
        onSelectionChange([dropTarget.nodeId], dropTarget.nodeId);
      }
      setConnectionStart(null);
    },
    [connectionStart, onConnectNodes, onSelectionChange]
  );
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(WORKFLOW_OPERATOR_MIME);
      if (!isWorkflowOperatorType(type)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNode(type, {
        x: position.x - WORKFLOW_NODE_WIDTH / 2,
        y: position.y - WORKFLOW_NODE_HEIGHT / 2,
      });
    },
    [onAddNode, screenToFlowPosition]
  );
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: WorkflowFlowNode) => {
      const currentNode = flowNodesRef.current.find((item) => item.id === node.id);
      const position = currentNode?.position ?? node.position;
      const snap = getWorkflowAlignmentSnap(node.id, position, flowNodesRef.current);
      setAlignmentGuides(EMPTY_WORKFLOW_ALIGNMENT_GUIDES);
      const nextNodes = flowNodesRef.current.map((item) =>
        item.id === node.id
          ? {
              ...item,
              position: snap.position,
            }
          : item
      );
      flowNodesRef.current = nextNodes;
      setFlowNodes(nextNodes);
      onMoveNode(node.id, snap.position.x, snap.position.y);
    },
    [onMoveNode]
  );

  return (
    <section className="flex min-h-0 flex-col overflow-hidden">
      <div className="glass-panel-header flex h-12 shrink-0 items-center gap-3 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="truncate text-[13px] font-medium text-text-secondary">
            {selectedNodes.length === 0
              ? t('data.workflow.noOperatorSelected')
              : selectedNodes.length === 1
                ? t('data.workflow.selectedOperator', {
                    count: 1,
                    name: (primaryNode ?? selectedNodes[0]).label,
                  })
                : t('data.workflow.selectedOperators', { count: selectedNodes.length })}
          </span>

          <div className="hidden h-5 w-px flex-shrink-0 bg-border-muted md:block" />
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <DataToolbarButton
              icon={<Copy className="h-3.5 w-3.5" />}
              label={t('data.workflow.copySelected')}
              disabled={!primaryNode}
              onClick={onDuplicateNode}
            />
            <DataToolbarButton
              icon={<Ban className="h-3.5 w-3.5" />}
              label={
                allSelectedDisabled
                  ? t('data.workflow.enableSelected')
                  : t('data.workflow.disableSelected')
              }
              disabled={selectedNodes.length === 0}
              onClick={onToggleNodeDisabled}
            />
            <DataToolbarButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={t('data.workflow.deleteSelected')}
              disabled={selectedNodes.length === 0}
              danger
              onClick={onDeleteNode}
            />
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1" onDragOver={handleDragOver} onDrop={handleDrop}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          edgeTypes={WORKFLOW_EDGE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onReconnectStart={handleReconnectStart}
          onReconnect={handleReconnect}
          onReconnectEnd={handleReconnectEnd}
          onNodeDragStop={handleNodeDragStop}
          multiSelectionKeyCode={['Shift']}
          // Deletion goes through the toolbar's confirm flow — RF's built-in
          // key delete would only ghost-remove nodes from local state.
          deleteKeyCode={null}
          defaultViewport={WORKFLOW_DEFAULT_VIEWPORT}
          nodesDraggable
          edgesReconnectable
          proOptions={WORKFLOW_PRO_OPTIONS}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={48}
          reconnectRadius={6}
          isValidConnection={isValidWorkflowConnection}
          defaultEdgeOptions={WORKFLOW_DEFAULT_EDGE_OPTIONS}
          colorMode={colorMode}
          className="workflow-react-flow bg-transparent"
        >
          <Background color="var(--workflow-canvas-dot)" gap={18} size={1.3} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={WORKFLOW_MINIMAP_STYLE}
            nodeColor={getWorkflowMinimapNodeColor}
            maskColor="var(--workflow-minimap-mask)"
          />
          <ViewportPortal>
            <WorkflowAlignmentGuidesOverlay guides={alignmentGuides} />
          </ViewportPortal>
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-text-muted">
            {t('data.workflow.emptyCanvas')}
          </div>
        )}
      </div>
    </section>
  );
}
