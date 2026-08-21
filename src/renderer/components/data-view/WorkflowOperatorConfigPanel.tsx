import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Code2, Copy, GripHorizontal, Maximize2, X } from 'lucide-react';
import type { DataWorkflowNode, DataWorkflowOperatorType } from '../../types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { OperatorFormWrapper } from '../workflow-forms/OperatorFormWrapper';
import { PrepDslEditor } from '../PrepDslEditor';
import {
  CONFIG_MIN_HEIGHT,
  DEFAULT_SPLIT_RATIO,
  DSL_MIN_HEIGHT,
  PANEL_BOTTOM_PADDING,
  PANEL_TOP_PADDING,
  SPLIT_HANDLE_HEIGHT,
  calculateOperatorPanelHeightBounds,
  calculateOperatorPanelSplitLayout,
  clampNumber,
} from './operator-panel-layout';

interface WorkflowOperatorConfigPanelProps {
  node: DataWorkflowNode;
  workflowNodes: DataWorkflowNode[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  fieldCompletions: string[];
  upstreamRowCount?: number;
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

export function WorkflowOperatorConfigPanel({
  node,
  workflowNodes,
  sourceNode,
  rightSourceNode,
  fieldCompletions,
  upstreamRowCount,
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
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [paneHeight, setPaneHeight] = useState(0);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const visibleDiagnostics = operatorDslDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const hasErrors = visibleDiagnostics.length > 0;

  useEffect(() => {
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

  const splitLayout = useMemo(
    () => calculateOperatorPanelSplitLayout(paneHeight, splitRatio),
    [paneHeight, splitRatio]
  );
  const isSplitAdjustable = splitLayout.canDrag && !splitLayout.isDslCollapsed;

  const handleSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isSplitAdjustable) return;
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
      const { availableHeight, maxVisibleTopHeight } = calculateOperatorPanelHeightBounds(
        paneRect.height
      );
      const maxTopHeight = availableHeight;
      const minTopHeight = CONFIG_MIN_HEIGHT;

      const updateRatio = (clientY: number) => {
        const nextTopHeight = clampNumber(
          clientY - (paneRect.top + PANEL_TOP_PADDING),
          minTopHeight,
          maxTopHeight
        );
        if (nextTopHeight > maxVisibleTopHeight) {
          setSplitRatio(1);
          return;
        }
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
    [isSplitAdjustable]
  );

  const handleSplitKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isSplitAdjustable) return;

      const { availableHeight, maxVisibleTopHeight } =
        calculateOperatorPanelHeightBounds(paneHeight);
      if (availableHeight <= 0) return;
      let nextTopHeight: number | null = null;

      if (event.key === 'ArrowUp') nextTopHeight = splitLayout.topHeight - 16;
      if (event.key === 'ArrowDown') nextTopHeight = splitLayout.topHeight + 16;
      if (event.key === 'Home') nextTopHeight = CONFIG_MIN_HEIGHT;
      if (event.key === 'End') {
        event.preventDefault();
        setSplitRatio(1);
        return;
      }
      if (nextTopHeight === null) return;

      event.preventDefault();
      if (nextTopHeight > maxVisibleTopHeight) {
        setSplitRatio(1);
        return;
      }
      setSplitRatio(
        clampNumber(nextTopHeight, CONFIG_MIN_HEIGHT, maxVisibleTopHeight) / availableHeight
      );
    },
    [isSplitAdjustable, paneHeight, splitLayout.topHeight]
  );

  const copyDsl = useCallback(() => {
    void navigator.clipboard?.writeText(operatorDsl);
  }, [operatorDsl]);

  const handleRestoreDslPreview = useCallback(() => {
    setSplitRatio(DEFAULT_SPLIT_RATIO);
  }, []);

  return (
    <>
      <div
        ref={paneRef}
        className={`operator-ui relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-2 pt-2 ${
          splitLayout.isDslCollapsed ? 'pb-0' : 'pb-2'
        } ${isDraggingSplit ? 'select-none' : ''}`}
        style={{
          minHeight: splitLayout.isDslCollapsed
            ? CONFIG_MIN_HEIGHT + SPLIT_HANDLE_HEIGHT + PANEL_TOP_PADDING
            : CONFIG_MIN_HEIGHT +
              DSL_MIN_HEIGHT +
              SPLIT_HANDLE_HEIGHT +
              PANEL_TOP_PADDING +
              PANEL_BOTTOM_PADDING,
        }}
      >
        {/* Form pane */}
        <div
          className="min-h-0 overflow-y-auto pr-1"
          style={{
            flexBasis: splitLayout.topHeight,
            height: splitLayout.topHeight,
            minHeight: CONFIG_MIN_HEIGHT,
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

        <div
          role={isSplitAdjustable ? 'separator' : undefined}
          aria-orientation={isSplitAdjustable ? 'horizontal' : undefined}
          aria-label={
            isSplitAdjustable
              ? t('data.workflow.resizeOperatorDslSplit', 'Drag to resize')
              : undefined
          }
          aria-valuemin={isSplitAdjustable ? CONFIG_MIN_HEIGHT : undefined}
          aria-valuemax={
            isSplitAdjustable
              ? Math.max(CONFIG_MIN_HEIGHT, splitLayout.topHeight + splitLayout.bottomHeight)
              : undefined
          }
          aria-valuenow={isSplitAdjustable ? Math.round(splitLayout.topHeight) : undefined}
          tabIndex={isSplitAdjustable ? 0 : -1}
          onPointerDown={handleSplitPointerDown}
          onKeyDown={handleSplitKeyDown}
          className={`group relative z-10 -mx-2 flex h-5 shrink-0 items-center justify-center px-2 outline-none ${
            isSplitAdjustable ? 'cursor-ns-resize' : 'cursor-default'
          }`}
          style={{ touchAction: 'none', userSelect: 'none' }}
        >
          <span
            className={`w-full transition-colors ${
              splitLayout.isDslCollapsed ? 'absolute bottom-0 h-px' : 'h-px'
            } ${
              isDraggingSplit
                ? 'bg-accent/70'
                : 'bg-border-muted/70 group-hover:bg-accent/40 group-focus-visible:bg-accent/70'
            }`}
          />
          {isSplitAdjustable && (
            <span className="absolute inline-flex h-5 w-9 items-center justify-center rounded-full border border-border-subtle bg-background text-text-muted shadow-sm transition-colors group-hover:border-accent/30 group-hover:text-accent group-focus-visible:border-accent/50 group-focus-visible:text-accent group-focus-visible:ring-2 group-focus-visible:ring-accent/30 group-focus-visible:ring-offset-1">
              <GripHorizontal className="h-4 w-4" strokeWidth={2.25} />
            </span>
          )}
        </div>

        {splitLayout.isDslCollapsed && (
          <button
            type="button"
            onClick={handleRestoreDslPreview}
            aria-label={t('data.workflow.expandDslPreview', 'Expand DSL preview')}
            title={t('data.workflow.expandDslPreview', 'Expand DSL preview')}
            className="group absolute bottom-0 left-1/2 z-20 h-7 w-9 -translate-x-1/2 text-accent outline-none"
          >
            <svg
              viewBox="0 0 36 20"
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-5 w-9 overflow-visible"
            >
              <path
                d="M1 19.5V10C1 5 5 1 10 1H26C31 1 35 5 35 10V19.5H1Z"
                className="fill-background stroke-border-subtle transition-colors group-hover:fill-accent/10 group-hover:stroke-accent/40 group-focus-visible:fill-accent/10 group-focus-visible:stroke-accent"
                strokeLinejoin="round"
              />
              <path
                d="M1 19.5V10C1 5 5 1 10 1H26C31 1 35 5 35 10V19.5H1Z"
                fill="none"
                className="stroke-accent opacity-0 transition-opacity group-focus-visible:opacity-100"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <path
                d="M13 13L18 8.5L23 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        {/* DSL pane */}
        {!splitLayout.isDslCollapsed && (
          <section
            className="min-h-0 pb-1"
            style={{
              flexBasis: splitLayout.bottomHeight,
              height: splitLayout.bottomHeight,
              minHeight: DSL_MIN_HEIGHT,
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
              <div className="mt-1 min-h-[32px] flex-1 overflow-hidden rounded-md border border-border-subtle bg-background/34">
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
    <div className="operator-ui fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
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
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-background/34">
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
