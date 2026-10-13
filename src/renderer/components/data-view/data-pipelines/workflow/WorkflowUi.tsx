import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import { AlertCircle, Copy, Upload, Workflow, X } from 'lucide-react';
import type { DataRawTablePreview } from '../../../../types';
import { GlassDataGridPreview } from '../../../GlassDataGridPreview';
import { Button } from '../../../ui/button';
import { Dialog } from '../../../ui/dialog';
export { WorkflowOperatorPalette } from './WorkflowOperatorPalette';
import { getOperatorCatalog } from './operator-catalog';
import { getOperatorDefinition } from '../../../../../shared/operators';
import type { WorkflowSummaryRow } from './workflow-summary';
import {
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  type WorkflowAlignmentGuides,
  type WorkflowAlignmentLine,
  type WorkflowFlowNode,
} from './workflow-model';

interface WorkflowDslDialogProps {
  mode: 'import' | 'export';
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onApply: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function WorkflowDslDialog({
  mode,
  value,
  error,
  onChange,
  onApply,
  onCopy,
  onClose,
}: WorkflowDslDialogProps) {
  const { t } = useTranslation();
  const isImport = mode === 'import';

  return (
    <Dialog
      open
      onOpenChange={onClose}
      ariaLabel={isImport ? t('data.workflow.importDsl') : t('data.workflow.viewExportDsl')}
      overlayClassName="bg-black/28 px-4 py-6"
      className="h-[34rem] w-[54rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl border-border-muted p-0 shadow-card"
    >
      <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
            {isImport ? <Upload className="h-3.5 w-3.5" /> : <Workflow className="h-3.5 w-3.5" />}
          </span>
          <div className="truncate text-[14px] font-semibold text-text-primary">
            {isImport ? t('data.workflow.importDsl') : t('data.workflow.viewExportDsl')}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-text-muted hover:bg-accent-muted hover:text-accent"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-surface p-3">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={!isImport}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-lg border border-border-muted bg-surface px-3 py-2.5 font-mono text-[12px] leading-5 text-text-secondary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 read-only:bg-surface-active"
          placeholder={t('data.workflow.dslPlaceholder')}
        />
        {error && (
          <div className="max-h-24 overflow-y-auto whitespace-pre-line rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs font-medium text-error">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-muted px-4">
        <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
          {isImport ? t('common.cancel') : t('common.close')}
        </Button>
        {isImport ? (
          <Button variant="primary" size="sm" onClick={onApply} className="text-xs">
            <Workflow className="h-3.5 w-3.5" />
            {t('data.workflow.applyDsl')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={onCopy}
            disabled={!value}
            className="text-xs"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('data.workflow.copyDsl')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

export const WorkflowOperatorNode = memo(function WorkflowOperatorNode({
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  const node = data.workflowNode;
  const catalog = getOperatorCatalog(node.type);
  // Edge endpoints declared by the operator registry (empty => no handles).
  const ports = getOperatorDefinition(node.type)?.ports ?? { inputs: [], outputs: [] };
  const Icon = catalog.Icon;
  const disabled = node.config.disabled === true;
  const invalid = data.invalid === true;
  return (
    <div
      data-node-id={node.id}
      style={{ width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT }}
      className={`workflow-node-drag-handle relative flex items-center gap-2 rounded-lg border bg-surface px-2.5 text-left shadow-soft transition-colors ${
        invalid
          ? 'border-error/60 text-error ring-2 ring-error/15'
          : selected
            ? 'border-accent text-accent ring-2 ring-accent/15'
            : catalog.nodeClassName
      } ${disabled ? 'opacity-45 grayscale' : ''}`}
    >
      {ports.inputs.length === 0
        ? null
        : ports.inputs.length > 1
          ? ports.inputs.map((handle, index) => (
              <Handle
                key={handle}
                id={handle}
                type="target"
                position={Position.Left}
                style={{ top: index === 0 ? '30%' : '70%' }}
                className="workflow-node-handle !h-2.5 !w-2.5 !rounded-full !border-2 !border-current !bg-background !opacity-100"
              />
            ))
          : ports.inputs.map((handle) => (
              <Handle
                key={handle}
                id={handle}
                type="target"
                position={Position.Left}
                className="workflow-node-handle !h-2.5 !w-2.5 !rounded-full !border-2 !border-current !bg-background !opacity-100"
              />
            ))}
      {ports.outputs.length === 0
        ? null
        : ports.outputs.length > 1
          ? ports.outputs.map((handle, index) => (
              <Handle
                key={handle}
                id={handle}
                type="source"
                position={Position.Right}
                style={{ top: index === 0 ? '30%' : '70%' }}
                className={`workflow-node-handle !h-2.5 !w-2.5 !rounded-full !border-2 !bg-background !opacity-100 ${
                  handle === 'reject' ? '!border-error' : '!border-current'
                }`}
              />
            ))
          : ports.outputs.map((handle) => (
              <Handle
                key={handle}
                id={handle}
                type="source"
                position={Position.Right}
                className="workflow-node-handle !h-2.5 !w-2.5 !rounded-full !border-2 !border-current !bg-background !opacity-100"
              />
            ))}
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className={`truncate text-xs font-medium ${invalid ? 'text-error' : 'text-text-secondary'}`}
        >
          {node.label}
        </span>
      </span>
    </div>
  );
});

const EDGE_ARROW_ROTATION: Record<Position, number> = {
  [Position.Left]: 0,
  [Position.Top]: 90,
  [Position.Right]: 180,
  [Position.Bottom]: 270,
};

export const WorkflowEdge = memo(function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  interactionWidth,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const color = selected ? 'var(--color-accent)' : 'var(--workflow-edge)';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={typeof interactionWidth === 'number' ? interactionWidth : 18}
        style={{ stroke: color, strokeWidth: selected ? 2.2 : 1.8 }}
      />
      <path
        d="M0,0 L-6,-3.5 L-6,3.5 Z"
        fill={color}
        transform={`translate(${targetX},${targetY}) rotate(${EDGE_ARROW_ROTATION[targetPosition] ?? 0})`}
      />
    </>
  );
});

export function WorkflowAlignmentGuidesOverlay({ guides }: { guides: WorkflowAlignmentGuides }) {
  const lines = [guides.horizontal, guides.vertical].filter((line): line is WorkflowAlignmentLine =>
    Boolean(line)
  );
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute left-0 top-0">
      {lines.map((line) =>
        line.orientation === 'vertical' ? (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-l border-dashed border-accent/75 shadow-[0_0_0_1px_rgb(var(--color-accent-rgb)/0.16)]"
            style={{
              left: line.x,
              top: line.y1,
              height: Math.max(1, line.y2 - line.y1),
            }}
          />
        ) : (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-t border-dashed border-accent/75 shadow-[0_0_0_1px_rgb(var(--color-accent-rgb)/0.16)]"
            style={{
              left: line.x1,
              top: line.y,
              width: Math.max(1, line.x2 - line.x1),
            }}
          />
        )
      )}
    </div>
  );
}

export function WorkflowNodeDataPreview({
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  footerLeading,
  footerTrailing,
}: {
  preview: DataRawTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  footerLeading?: ReactNode;
  footerTrailing?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <GlassDataGridPreview
      preview={preview}
      isLoading={isLoading}
      error={error}
      currentPage={currentPage}
      onPageChange={onPageChange}
      footerLeading={footerLeading}
      footerTrailing={footerTrailing}
      edgeToEdge
      labels={{
        loading: t('data.workflow.nodeDataLoading'),
        empty: t('data.workflow.nodeDataEmpty'),
        total: (count) => t('data.workflow.nodeDataTotal', { count }),
        pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
      }}
      rowHeight={32}
      headerHeight={34}
    />
  );
}

export function WorkflowSummaryPanel({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: WorkflowSummaryRow[];
  emptyText: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-medium text-text-secondary">{title}</div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted text-xs">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-border-muted last:border-b-0"
            >
              <div className="bg-background px-2 py-1.5 text-text-muted">{row.label}</div>
              <div
                className={`min-w-0 break-words px-2 py-1.5 text-text-secondary ${
                  row.mono ? 'font-mono text-[10.5px]' : ''
                }`}
              >
                {row.value}
              </div>
            </div>
          ))
        ) : (
          <div className="px-2 py-2 text-text-muted">{emptyText}</div>
        )}
      </div>
    </div>
  );
}
