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
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type NodeChange,
  type OnConnectStartParams,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Ban, ChevronDown, Copy, Trash2, Workflow } from 'lucide-react';
import type {
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
} from '../../../../types';
import { DataToolbarButton } from '../../shared';
import { getWorkflowAlignmentSnap, getWorkflowConnectionDropTarget } from './canvas-utils';
import { getOperatorCatalog, isWorkflowOperatorType } from './operator-catalog';
import { WorkflowAlignmentGuidesOverlay, WorkflowOperatorNode } from './WorkflowUi';
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

export function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
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
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasContent
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onDuplicateNode={onDuplicateNode}
        onToggleNodeDisabled={onToggleNodeDisabled}
        onDeleteNode={onDeleteNode}
        onAddNode={onAddNode}
        onMoveNode={onMoveNode}
        onConnectNodes={onConnectNodes}
        onReconnectEdge={onReconnectEdge}
        onRemoveEdge={onRemoveEdge}
      />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasContent({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
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
}) {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const [connectionStart, setConnectionStart] = useState<OnConnectStartParams | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const selectedNodeCatalog = selectedNode ? getOperatorCatalog(selectedNode.type) : null;
  const SelectedNodeIcon = selectedNodeCatalog?.Icon;
  const selectedNodeDisabled = selectedNode?.config.disabled === true;
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
        dragHandle: '.workflow-node-drag-handle',
        draggable: true,
        selectable: true,
        selected: node.id === selectedNodeId,
        data: { workflowNode: node },
      })),
    [nodes, selectedNodeId]
  );
  const mappedFlowEdges = useMemo<WorkflowFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        type: 'smoothstep',
        reconnectable: true,
        interactionWidth: 18,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: 'rgba(100, 116, 139, 0.82)',
        },
        style: {
          stroke: 'rgba(100, 116, 139, 0.68)',
          strokeWidth: 1.8,
        },
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

  useEffect(() => {
    flowNodesRef.current = mappedFlowNodes;
    setFlowNodes(mappedFlowNodes);
  }, [mappedFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedFlowEdges);
  }, [mappedFlowEdges]);

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
      setFlowNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(snappedChanges, currentNodes);
        flowNodesRef.current = nextNodes;
        for (const change of snappedChanges) {
          if (change.type === 'select' && change.selected) {
            onSelectNode(change.id);
          }
        }
        return nextNodes;
      });
    },
    [onSelectNode]
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
      onSelectNode(connection.target);
    },
    [onConnectNodes, onSelectNode]
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
      Boolean(connection.source && connection.target && connection.source !== connection.target),
    []
  );
  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, _edge: WorkflowFlowEdge, _handleType: HandleType) => {
      reconnectSucceededRef.current = false;
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
        onSelectNode(dropTarget.nodeId);
      }
      setConnectionStart(null);
    },
    [connectionStart, onConnectNodes, onSelectNode]
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
    (_event: ReactMouseEvent, node: WorkflowFlowNode) => {
      const currentNode = flowNodesRef.current.find((item) => item.id === node.id);
      const position = currentNode?.position ?? node.position;
      const snap = getWorkflowAlignmentSnap(node.id, position, flowNodesRef.current);
      setAlignmentGuides(EMPTY_WORKFLOW_ALIGNMENT_GUIDES);
      setFlowNodes((currentNodes) => {
        const nextNodes = currentNodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                position: snap.position,
              }
            : item
        );
        flowNodesRef.current = nextNodes;
        return nextNodes;
      });
      onMoveNode(node.id, snap.position.x, snap.position.y);
    },
    [onMoveNode]
  );

  return (
    <section className="glass-card flex min-h-0 flex-col overflow-hidden rounded-xl">
      <div className="glass-panel-header flex h-12 shrink-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {selectedNodeCatalog && SelectedNodeIcon ? (
              <span
                className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${selectedNodeCatalog.colorClassName}`}
              >
                <SelectedNodeIcon className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-surface-active text-text-muted">
                <Workflow className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="truncate text-[13px] font-medium text-text-secondary">
              {selectedNode
                ? t('data.workflow.selectedOperator', { count: 1, name: selectedNode.label })
                : t('data.workflow.noOperatorSelected')}
            </span>
            {selectedNode && <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
          </div>

          {!toolbarCollapsed && (
            <>
              <div className="hidden h-5 w-px flex-shrink-0 bg-border-muted md:block" />
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <DataToolbarButton
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label={t('data.workflow.copySelected')}
                  disabled={!selectedNode}
                  onClick={onDuplicateNode}
                />
                <DataToolbarButton
                  icon={<Ban className="h-3.5 w-3.5" />}
                  label={
                    selectedNodeDisabled
                      ? t('data.workflow.enableSelected')
                      : t('data.workflow.disableSelected')
                  }
                  disabled={!selectedNode}
                  onClick={onToggleNodeDisabled}
                />
                <DataToolbarButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label={t('data.workflow.deleteSelected')}
                  disabled={!selectedNode}
                  danger
                  onClick={onDeleteNode}
                />
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setToolbarCollapsed((current) => !current)}
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          title={
            toolbarCollapsed
              ? t('data.workflow.expandCanvasToolbar')
              : t('data.workflow.collapseCanvasToolbar')
          }
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${toolbarCollapsed ? '' : 'rotate-180'}`}
          />
        </button>
      </div>
      <div className="relative min-h-0 flex-1" onDragOver={handleDragOver} onDrop={handleDrop}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onReconnectStart={handleReconnectStart}
          onReconnect={handleReconnect}
          onReconnectEnd={handleReconnectEnd}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable
          edgesReconnectable
          proOptions={{ hideAttribution: true }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={48}
          reconnectRadius={12}
          isValidConnection={isValidWorkflowConnection}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: 'var(--workflow-edge)',
            },
            style: {
              stroke: 'var(--workflow-edge)',
              strokeWidth: 1.8,
            },
          }}
          className="workflow-react-flow bg-transparent"
        >
          <Background color="var(--workflow-canvas-dot)" gap={18} size={1.3} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={{ width: 100, height: 75 }}
            nodeColor={() => 'var(--workflow-minimap-node)'}
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
