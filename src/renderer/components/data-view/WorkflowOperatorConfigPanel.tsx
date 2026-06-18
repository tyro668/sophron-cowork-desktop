import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, ChevronDown, Code2, Copy, Maximize2, X } from 'lucide-react';
import type { DataWorkflowNode, DataWorkflowOperatorType } from '../../types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { OperatorFormWrapper } from '../workflow-forms/OperatorFormWrapper';
import { PrepDslEditor } from '../PrepDslEditor';

export interface WorkflowOperatorSummaryRow {
  label: string;
  value: string;
  mono?: boolean;
}

interface WorkflowOperatorConfigPanelProps {
  node: DataWorkflowNode;
  workflowNodes: DataWorkflowNode[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  fieldCompletions: string[];
  upstreamRowCount?: number;
  summaryRows: WorkflowOperatorSummaryRow[];
  summaryTitle: string;
  summaryEmptyText: string;
  operatorDsl: string;
  operatorDslStatus: string | null;
  operatorDslDiagnostics: PrepDiagnostic[];
  isEditingOperatorDsl: boolean;
  isRunningOperatorDsl: boolean;
  editorCompletionLabels: {
    keywords: string;
    snippets: string;
    types: string;
    fields: string;
  };
  formatEditorDiagnostic: (diagnostic: PrepDiagnostic) => string;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
  onDslChange: (value: string) => void;
  onDiagnosticsChange: (diagnostics: PrepDiagnostic[]) => void;
  onStartDslEdit: () => void;
  onCancelDslEdit: () => void;
  onFormatDsl: () => void;
  onApplyDsl: () => void;
}

const CONFIG_MIN_HEIGHT = 150;
const DSL_MIN_HEIGHT = 108;
const SPLIT_HANDLE_HEIGHT = 20;
const DEFAULT_SPLIT_RATIO = 0.72;
const PANEL_VERTICAL_PADDING = 16;

type OperatorPanelSplitMode = 'split' | 'dsl-only' | 'form-only';

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function WorkflowOperatorConfigPanel({
  node,
  workflowNodes,
  sourceNode,
  rightSourceNode,
  fieldCompletions,
  upstreamRowCount,
  summaryRows,
  summaryTitle,
  summaryEmptyText,
  operatorDsl,
  operatorDslStatus,
  operatorDslDiagnostics,
  isEditingOperatorDsl,
  isRunningOperatorDsl,
  editorCompletionLabels,
  formatEditorDiagnostic,
  onNodeChange,
  onDslChange,
  onDiagnosticsChange,
  onStartDslEdit,
  onCancelDslEdit,
  onFormatDsl,
  onApplyDsl,
}: WorkflowOperatorConfigPanelProps) {
  const { t } = useTranslation();
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [splitMode, setSplitMode] = useState<OperatorPanelSplitMode>('split');
  const [paneHeight, setPaneHeight] = useState(0);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const visibleDiagnostics = operatorDslDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const hasErrors = visibleDiagnostics.length > 0;

  useEffect(() => {
    setIsSummaryOpen(false);
    setSplitMode('split');
    cleanupDragRef.current?.();
    setIsDraggingSplit(false);
  }, [node.id]);

  useEffect(
    () => () => {
      cleanupDragRef.current?.();
    },
    []
  );

  useEffect(() => {
    const element = paneRef.current;
    if (!element) return undefined;

    const updatePaneHeight = () => {
      setPaneHeight(element.getBoundingClientRect().height);
    };

    updatePaneHeight();
    const observer = new ResizeObserver(updatePaneHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [node.id]);

  const splitLayout = useMemo(() => {
    if (splitMode !== 'split') {
      const availableHeight = Math.max(
        0,
        paneHeight - SPLIT_HANDLE_HEIGHT - PANEL_VERTICAL_PADDING
      );
      return {
        topHeight: splitMode === 'dsl-only' ? 0 : availableHeight,
        bottomHeight: splitMode === 'form-only' ? 0 : availableHeight,
        canDrag: false,
      };
    }

    const availableHeight = Math.max(0, paneHeight - SPLIT_HANDLE_HEIGHT - PANEL_VERTICAL_PADDING);
    const canDrag = availableHeight > CONFIG_MIN_HEIGHT + DSL_MIN_HEIGHT;
    const maxTopHeight = canDrag ? availableHeight - DSL_MIN_HEIGHT : availableHeight;
    const minTopHeight = canDrag ? CONFIG_MIN_HEIGHT : 0;
    const topHeight = clampNumber(availableHeight * splitRatio, minTopHeight, maxTopHeight);
    const bottomHeight = Math.max(0, availableHeight - topHeight);

    return {
      topHeight,
      bottomHeight,
      canDrag,
    };
  }, [paneHeight, splitRatio, splitMode]);

  const handleSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || splitMode !== 'split' || !splitLayout.canDrag) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Fallback to document-level listeners when pointer capture is unavailable.
      }
      const pane = paneRef.current;
      if (!pane) return;

      const paneRect = pane.getBoundingClientRect();
      const availableHeight = Math.max(
        0,
        paneRect.height - SPLIT_HANDLE_HEIGHT - PANEL_VERTICAL_PADDING
      );
      const maxTopHeight = availableHeight - DSL_MIN_HEIGHT;
      const minTopHeight = CONFIG_MIN_HEIGHT;

      const updateRatio = (clientY: number) => {
        const nextTopHeight = clampNumber(
          clientY - (paneRect.top + PANEL_VERTICAL_PADDING / 2),
          minTopHeight,
          maxTopHeight
        );
        setSplitRatio(availableHeight > 0 ? nextTopHeight / availableHeight : DEFAULT_SPLIT_RATIO);
      };

      updateRatio(event.clientY);
      setIsDraggingSplit(true);

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        updateRatio(moveEvent.clientY);
      };

      const handlePointerUp = () => {
        setIsDraggingSplit(false);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
        cleanupDragRef.current = null;
      };

      cleanupDragRef.current = handlePointerUp;
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [splitLayout.canDrag, splitMode]
  );

  const handleUpperTriangleClick = useCallback(() => {
    setSplitMode((prev) => (prev === 'dsl-only' ? 'split' : 'dsl-only'));
  }, []);

  const handleLowerTriangleClick = useCallback(() => {
    setSplitMode((prev) => (prev === 'form-only' ? 'split' : 'form-only'));
  }, []);

  const copyDsl = useCallback(() => {
    void navigator.clipboard?.writeText(operatorDsl);
  }, [operatorDsl]);

  return (
    <>
      <div
        ref={paneRef}
        className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-2 py-2 ${
          isDraggingSplit ? 'select-none' : ''
        }`}
        style={
          splitMode === 'split'
            ? {
                minHeight:
                  CONFIG_MIN_HEIGHT + DSL_MIN_HEIGHT + SPLIT_HANDLE_HEIGHT + PANEL_VERTICAL_PADDING,
              }
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => setIsSummaryOpen((current) => !current)}
          className="absolute right-2 top-2 z-20 inline-flex h-8 items-center gap-1.5 rounded-none border border-border-muted bg-[var(--glass-card-strong)] px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          aria-expanded={isSummaryOpen}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${isSummaryOpen ? 'rotate-180' : ''}`}
          />
          {summaryTitle}
        </button>

        {isSummaryOpen && (
          <div className="absolute right-2 top-10 z-20 w-[19rem] max-w-[calc(100%-1rem)] border border-border-muted bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
            <div className="flex h-8 items-center justify-between border-b border-border-muted px-2.5 text-xs font-medium text-text-secondary">
              <span>{summaryTitle}</span>
              <button
                type="button"
                onClick={() => setIsSummaryOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                title={t('common.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto text-xs">
              {summaryRows.length > 0 ? (
                summaryRows.map((row) => (
                  <div
                    key={`${row.label}-${row.value}`}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-border-muted last:border-b-0"
                  >
                    <div className="bg-background/72 px-2 py-1.5 text-text-muted">{row.label}</div>
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
                <div className="px-2.5 py-2 text-text-muted">{summaryEmptyText}</div>
              )}
            </div>
          </div>
        )}

        {/* Form pane */}
        {splitMode !== 'dsl-only' && (
          <div
            className="min-h-0 overflow-y-auto pr-1"
            style={{
              flexBasis: splitMode === 'split' ? splitLayout.topHeight : 'auto',
              height: splitMode === 'split' ? splitLayout.topHeight : undefined,
              flex: splitMode === 'form-only' ? 1 : undefined,
              minHeight: splitMode === 'split' ? CONFIG_MIN_HEIGHT : undefined,
            }}
          >
            <OperatorFormWrapper
              key={`${node.id}-form`}
              node={node}
              taskId={node.taskId}
              fieldCompletions={fieldCompletions}
              otherNodes={workflowNodes}
              sourceNode={sourceNode}
              rightSourceNode={rightSourceNode}
              upstreamRowCount={upstreamRowCount}
              onNodeChange={onNodeChange}
            />
          </div>
        )}

        {/* Separator / mode-switch bar */}
        <div
          className={`group relative z-10 -mx-2 flex h-6 shrink-0 items-center justify-center px-2 ${
            isDraggingSplit ? 'text-accent' : 'text-border-muted'
          }`}
          style={{ touchAction: 'none', userSelect: 'none' }}
        >
          {/* Background line */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors ${
              isDraggingSplit ? 'bg-accent/60' : 'bg-border-muted/70 group-hover:bg-accent/35'
            }`}
          />

          {/* Upper triangle button: toggle to DSL-only / restore split */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleUpperTriangleClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={
              splitMode === 'dsl-only'
                ? t('data.workflow.restoreSplitView', 'Restore split view')
                : t('data.workflow.showDslOnly', 'Show DSL only')
            }
            aria-pressed={splitMode === 'dsl-only'}
            className="relative z-20 flex h-5 w-5 items-start justify-center pt-[5px]"
          >
            <span
              className={`border-x-[7px] border-b-[5px] border-x-transparent transition-colors ${
                splitMode === 'dsl-only'
                  ? 'border-b-accent'
                  : isDraggingSplit
                    ? 'border-b-accent'
                    : 'border-b-border-muted/80 group-hover:border-b-accent/70'
              }`}
            />
          </button>

          {/* Drag handle (center zone) */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={
              splitMode === 'split'
                ? t('data.workflow.resizeOperatorDslSplit', 'Drag to resize')
                : t('data.workflow.splitModeSwitchBar', 'Split mode switch bar')
            }
            onPointerDown={handleSplitPointerDown}
            className={`mx-1 h-full flex-1 ${
              splitMode === 'split' && splitLayout.canDrag ? 'cursor-ns-resize' : 'cursor-default'
            }`}
            style={{ touchAction: splitMode === 'split' ? 'none' : undefined, userSelect: 'none' }}
          />

          {/* Lower triangle button: toggle to form-only / restore split */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLowerTriangleClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={
              splitMode === 'form-only'
                ? t('data.workflow.restoreSplitView', 'Restore split view')
                : t('data.workflow.showFormOnly', 'Show form only')
            }
            aria-pressed={splitMode === 'form-only'}
            className="relative z-20 flex h-5 w-5 items-end justify-center pb-[5px]"
          >
            <span
              className={`border-x-[7px] border-t-[5px] border-x-transparent transition-colors ${
                splitMode === 'form-only'
                  ? 'border-t-accent'
                  : isDraggingSplit
                    ? 'border-t-accent'
                    : 'border-t-border-muted/80 group-hover:border-t-accent/70'
              }`}
            />
          </button>
        </div>

        {/* DSL pane */}
        {splitMode !== 'form-only' && (
          <section
            className="min-h-0 pb-3"
            style={{
              flexBasis: splitMode === 'split' ? splitLayout.bottomHeight : undefined,
              height: splitMode === 'split' ? splitLayout.bottomHeight : undefined,
              flex: splitMode === 'dsl-only' ? 1 : undefined,
              minHeight: splitMode === 'split' ? DSL_MIN_HEIGHT : undefined,
            }}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-8 shrink-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[13px] font-medium text-text-secondary">DSL</span>
                  {operatorDslStatus && (
                    <span className="inline-flex h-6 min-w-0 items-center rounded-full border border-success/20 bg-success/5 px-2 text-[11px] text-success">
                      <CheckCircle2 className="mr-1 h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{operatorDslStatus}</span>
                    </span>
                  )}
                  {hasErrors && !isEditingOperatorDsl && (
                    <span className="inline-flex h-6 min-w-0 items-center rounded-full border border-error/20 bg-error/5 px-2 text-[11px] text-error">
                      <AlertCircle className="mr-1 h-3 w-3 flex-shrink-0" />
                      <span>{t('data.workflow.syntaxInvalid')}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={copyDsl}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('data.workflow.copyDsl', 'Copy DSL')}
                  </button>
                  <button
                    type="button"
                    onClick={onStartDslEdit}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    {t('common.expand', 'Expand')}
                  </button>
                </div>
              </div>
              <div className="mt-2 min-h-[52px] flex-1 overflow-hidden rounded-lg border border-border-muted/80 bg-[var(--glass-card-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_0_rgba(15,23,42,0.03)]">
                <PrepDslEditor
                  value={operatorDsl}
                  operatorType={node.type}
                  placeholderText={t('data.workflow.operatorDslPlaceholder')}
                  completionLabels={editorCompletionLabels}
                  formatDiagnostic={formatEditorDiagnostic}
                  onChange={onDslChange}
                  onDiagnosticsChange={onDiagnosticsChange}
                  onRequestEdit={onStartDslEdit}
                  fieldCompletions={fieldCompletions}
                  editable={false}
                  height="100%"
                />
              </div>
            </div>
          </section>
        )}
      </div>

      {isEditingOperatorDsl && (
        <WorkflowOperatorDslDialog
          nodeLabel={node.label}
          operatorType={node.type}
          operatorDsl={operatorDsl}
          operatorDslStatus={operatorDslStatus}
          operatorDslDiagnostics={operatorDslDiagnostics}
          editorCompletionLabels={editorCompletionLabels}
          fieldCompletions={fieldCompletions}
          formatEditorDiagnostic={formatEditorDiagnostic}
          isRunningOperatorDsl={isRunningOperatorDsl}
          onChange={onDslChange}
          onDiagnosticsChange={onDiagnosticsChange}
          onClose={onCancelDslEdit}
          onCopy={copyDsl}
          onFormat={onFormatDsl}
          onApply={onApplyDsl}
        />
      )}
    </>
  );
}

function WorkflowOperatorDslDialog({
  nodeLabel,
  operatorType,
  operatorDsl,
  operatorDslStatus,
  operatorDslDiagnostics,
  editorCompletionLabels,
  fieldCompletions,
  formatEditorDiagnostic,
  isRunningOperatorDsl,
  onChange,
  onDiagnosticsChange,
  onClose,
  onCopy,
  onFormat,
  onApply,
}: {
  nodeLabel: string;
  operatorType: DataWorkflowOperatorType;
  operatorDsl: string;
  operatorDslStatus: string | null;
  operatorDslDiagnostics: PrepDiagnostic[];
  editorCompletionLabels: {
    keywords: string;
    snippets: string;
    types: string;
    fields: string;
  };
  fieldCompletions: string[];
  formatEditorDiagnostic: (diagnostic: PrepDiagnostic) => string;
  isRunningOperatorDsl: boolean;
  onChange: (value: string) => void;
  onDiagnosticsChange: (diagnostics: PrepDiagnostic[]) => void;
  onClose: () => void;
  onCopy: () => void;
  onFormat: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const visibleDiagnostics = operatorDslDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.workflow.dslEditor', 'DSL 编辑器')}
            </div>
            <div className="truncate text-[11px] text-text-muted">{nodeLabel}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {operatorDslStatus && (
              <div className="flex h-6 min-w-0 items-center rounded-full border border-success/20 bg-success/5 px-2 text-[11px] text-success">
                <CheckCircle2 className="mr-1 h-3 w-3 flex-shrink-0" />
                <span className="truncate">{operatorDslStatus}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('data.workflow.copyDsl', 'Copy DSL')}
            </button>
            <button
              type="button"
              onClick={onFormat}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
            >
              <Code2 className="h-3.5 w-3.5" />
              {t('data.workflow.formatDsl', 'Format')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isRunningOperatorDsl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
            >
              <X className="h-3.5 w-3.5" />
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={isRunningOperatorDsl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('data.workflow.applyOperatorDsl', 'Apply')}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-muted/80 bg-[var(--glass-card-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_0_rgba(15,23,42,0.03)]">
            <PrepDslEditor
              value={operatorDsl}
              operatorType={operatorType}
              placeholderText={t('data.workflow.operatorDslPlaceholder')}
              completionLabels={editorCompletionLabels}
              formatDiagnostic={formatEditorDiagnostic}
              onChange={onChange}
              onDiagnosticsChange={onDiagnosticsChange}
              fieldCompletions={fieldCompletions}
              editable
              height="100%"
            />
          </div>
          {visibleDiagnostics.length > 0 && (
            <div className="max-h-24 overflow-y-auto rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs font-medium text-error">
              <div className="mb-1 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{t('data.workflow.syntaxInvalid')}</span>
              </div>
              <div className="space-y-1">
                {visibleDiagnostics.map((diagnostic, index) => (
                  <div key={`${diagnostic.code ?? diagnostic.message}-${index}`}>
                    {formatEditorDiagnostic(diagnostic)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
