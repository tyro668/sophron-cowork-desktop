import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Code2, Copy, Maximize2, X } from 'lucide-react';
import type { DataWorkflowEdge, DataWorkflowNode, DataWorkflowOperatorType } from '../../types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';
import { OperatorFormWrapper } from '../workflow-forms/OperatorFormWrapper';
import { PrepDslEditor } from '../PrepDslEditor';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

interface WorkflowOperatorConfigPanelProps {
  mode: 'form' | 'dsl';
  node: DataWorkflowNode;
  workflowNodes: DataWorkflowNode[];
  workflowEdges?: DataWorkflowEdge[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  fieldCompletions: string[];
  fieldTypes?: DataColumnTypeInfo[];
  upstreamRowCount?: number;
  operatorDsl: string;
  operatorDslStatus: string | null;
  operatorDslDiagnostics: PrepDiagnostic[];
  isEditingOperatorDsl: boolean;
  isDslDialogOpen: boolean;
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
  mode,
  node,
  workflowNodes,
  workflowEdges,
  sourceNode,
  rightSourceNode,
  fieldCompletions,
  fieldTypes,
  upstreamRowCount,
  operatorDsl,
  operatorDslStatus,
  operatorDslDiagnostics,
  isEditingOperatorDsl,
  isDslDialogOpen,
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
  const visibleDiagnostics = operatorDslDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const hasErrors = visibleDiagnostics.length > 0;

  const copyDsl = useCallback(() => {
    void navigator.clipboard?.writeText(operatorDsl);
  }, [operatorDsl]);

  const dslDialog = isDslDialogOpen ? (
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
  ) : null;

  if (mode === 'form') {
    return (
      <>
        <div className="operator-ui h-full min-h-0 overflow-y-auto px-2 py-1">
          <OperatorFormWrapper
            key={`${node.id}-form`}
            node={node}
            pipelineId={node.pipelineId}
            fieldCompletions={fieldCompletions}
            fieldTypes={fieldTypes}
            otherNodes={workflowNodes}
            workflowEdges={workflowEdges}
            sourceNode={sourceNode}
            rightSourceNode={rightSourceNode}
            upstreamRowCount={upstreamRowCount}
            onNodeChange={onNodeChange}
          />
        </div>
        {dslDialog}
      </>
    );
  }

  return (
    <>
      <div className="operator-ui flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-2 py-2">
        <div className="flex h-8 shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
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
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('data.workflow.copyDsl', 'Copy DSL')}
            </button>
            <button
              type="button"
              onClick={onFormatDsl}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
            >
              <Code2 className="h-3.5 w-3.5" />
              {t('data.workflow.formatDsl', 'Format')}
            </button>
            <button
              type="button"
              onClick={onStartDslEdit}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {t('common.expand', 'Expand')}
            </button>
            {isEditingOperatorDsl && (
              <>
                <button
                  type="button"
                  onClick={onCancelDslEdit}
                  disabled={isRunningOperatorDsl}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={onApplyDsl}
                  disabled={isRunningOperatorDsl}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('data.workflow.applyOperatorDsl', 'Apply')}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 min-h-0 flex-1 overflow-hidden rounded-md border border-border-subtle bg-surface">
          <PrepDslEditor
            value={operatorDsl}
            operatorType={node.type}
            placeholderText={t('data.workflow.operatorDslPlaceholder')}
            completionLabels={editorCompletionLabels}
            formatDiagnostic={formatEditorDiagnostic}
            onChange={onDslChange}
            onDiagnosticsChange={onDiagnosticsChange}
            fieldCompletions={fieldCompletions}
            editable
            height="100%"
          />
        </div>
        {visibleDiagnostics.length > 0 && isEditingOperatorDsl && (
          <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs font-medium text-error">
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
      {dslDialog}
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

  // Escape cancels the DSL edit (same as the Cancel button); disabled while a
  // run is in progress, matching the dialog's action buttons. Escapes already
  // consumed by the editor (e.g. dismissing the autocomplete popup) must not
  // close the dialog.
  useEffect(() => {
    if (!isRunningOperatorDsl) {
      const handleKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isRunningOperatorDsl, onClose]);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      busy={isRunningOperatorDsl}
      closeOnEscape={false}
      ariaLabel={t('data.workflow.dslEditor', '结构化表达式编辑器')}
      overlayClassName="operator-ui bg-black/15 px-4 py-6 dark:bg-black/50"
      className="h-[42rem] w-[72rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl p-0 shadow-card"
    >
      <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-text-primary">
            {t('data.workflow.dslEditor', '结构化表达式编辑器')}
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
          <Button variant="secondary" size="sm" onClick={onCopy} className="text-[11px]">
            <Copy className="h-3.5 w-3.5" />
            {t('data.workflow.copyDsl', 'Copy DSL')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onFormat} className="text-[11px]">
            <Code2 className="h-3.5 w-3.5" />
            {t('data.workflow.formatDsl', 'Format')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isRunningOperatorDsl}
            className="text-[11px]"
          >
            <X className="h-3.5 w-3.5" />
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onApply}
            disabled={isRunningOperatorDsl}
            className="text-[11px]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('data.workflow.applyOperatorDsl', 'Apply')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-surface">
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
    </Dialog>
  );
}
