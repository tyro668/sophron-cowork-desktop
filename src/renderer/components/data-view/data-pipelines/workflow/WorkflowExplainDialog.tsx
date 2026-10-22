/**
 * "Explain this flow" view: walks the graph from sources to sinks and renders
 * each node's localized config summary, with the canonical DSL export at the
 * bottom for SQL review. Deterministic — no model call needed.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Copy, X } from 'lucide-react';
import type { DataWorkflowEdge, DataWorkflowNode } from '../../../../types';
import { exportWorkflowJflow } from '../../../../../shared/jflow';
import { Dialog, DialogBody, DialogHeader, DialogTitle } from '../../../ui/dialog';
import { Button } from '../../../ui/button';
import { getOperatorCatalog } from './operator-catalog';

/** Source-to-sink traversal order: edge-connected sources first, then BFS. */
export function orderWorkflowNodes(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): DataWorkflowNode[] {
  const incoming = new Set(edges.map((edge) => edge.targetNodeId));
  const connected = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    connected.add(edge.sourceNodeId).add(edge.targetNodeId);
    const list = adjacency.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, list);
  }
  const ordered: DataWorkflowNode[] = [];
  const seen = new Set<string>();
  const queue = nodes
    .filter((node) => connected.has(node.id) && !incoming.has(node.id))
    .map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    seen.add(id);
    ordered.push(node);
    queue.push(...(adjacency.get(id) ?? []));
  }
  // Isolated nodes and edge-disconnected remnants keep visual order last.
  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}

export function WorkflowExplainDialog({
  open,
  nodes,
  edges,
  onOpenChange,
}: {
  open: boolean;
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const orderedNodes = useMemo(() => orderWorkflowNodes(nodes, edges), [nodes, edges]);
  const dslText = useMemo(() => {
    if (!open || nodes.length === 0) return '';
    try {
      return exportWorkflowJflow(nodes, edges).text;
    } catch {
      // Partially configured graphs can be inexpressible — the step list
      // still explains the flow, the DSL block just stays hidden.
      return '';
    }
  }, [open, nodes, edges]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel={t('data.workflow.explainTitle')}
      className="w-full max-w-xl p-5"
    >
      <DialogHeader className="items-center">
        <DialogTitle className="text-sm font-semibold text-text-secondary">
          {t('data.workflow.explainTitle')}
        </DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          className="text-text-muted hover:bg-accent-muted hover:text-accent"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </Button>
      </DialogHeader>
      <DialogBody className="mt-3 flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        <ol className="flex flex-col gap-2">
          {orderedNodes.map((node, index) => {
            const catalog = getOperatorCatalog(node.type);
            const Icon = catalog.Icon;
            const summary = catalog.summarize(node.config ?? {}, t);
            const disabled = node.config?.disabled === true;
            return (
              <li
                key={node.id}
                className="flex items-start gap-3 rounded-lg border border-border-muted bg-surface px-3 py-2.5"
              >
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-bg-secondary text-[11px] font-medium text-text-muted">
                  {index + 1}
                </span>
                <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary">
                    <span className="truncate">{node.label || t(catalog.labelKey)}</span>
                    {disabled && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-normal text-text-muted">
                        <Ban className="h-3 w-3" />
                        {t('data.workflow.explainDisabled')}
                      </span>
                    )}
                  </div>
                  {summary.primary.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-muted">
                      {summary.primary.map((row) => (
                        <span key={row.label} className="inline-flex gap-1">
                          <span>{row.label}</span>
                          <span
                            className={`text-text-secondary ${row.mono ? 'font-mono' : ''}`}
                            title={row.value}
                          >
                            {row.value}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {dslText && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-text-secondary">
                {t('data.workflow.explainDsl')}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => void navigator.clipboard?.writeText(dslText)}
              >
                <Copy className="h-3 w-3" />
                {t('data.workflow.copyDsl')}
              </Button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-lg border border-border-muted bg-bg-secondary/60 p-3 font-mono text-[11px] leading-5 text-text-secondary">
              {dslText}
            </pre>
          </div>
        )}
      </DialogBody>
    </Dialog>
  );
}
