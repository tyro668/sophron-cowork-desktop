import type { RefObject } from 'react';
import {
  ArrowLeft,
  FileText,
  LoaderCircle,
  MoreVertical,
  PencilLine,
  Play,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Upload,
  Waypoints,
  Workflow,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassDropdownMenu, GlassMenuItem } from '../../../GlassDropdownMenu';
import { Button } from '../../../ui/button';

interface PipelineHeaderProps {
  pipelineTitle: string;
  isEditingPipelineTitle: boolean;
  pipelineTitleInputRef: RefObject<HTMLInputElement>;
  isBusy: boolean;
  hasWorkflow: boolean;
  isWorkflowDirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  nodeCount: number;
  runningKind: 'trial' | 'run' | null;
  workflowMenuOpen: boolean;
  onBack: () => void;
  onTitleChange: (title: string) => void;
  onTitleBlur: () => void;
  onTitleCancel: () => void;
  onStartEditTitle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenAiDialog: () => void;
  onTidyCanvas: () => void;
  onSaveWorkflow: () => void;
  onTrialRun: () => void;
  onSaveAndRun: () => void;
  onWorkflowMenuOpenChange: (open: boolean) => void;
  onOpenExplainDialog: () => void;
  onOpenImportDsl: () => void;
  onOpenExportDsl: () => void;
}

export function PipelineHeader({
  pipelineTitle,
  isEditingPipelineTitle,
  pipelineTitleInputRef,
  isBusy,
  hasWorkflow,
  isWorkflowDirty,
  saving,
  canUndo,
  canRedo,
  nodeCount,
  runningKind,
  workflowMenuOpen,
  onBack,
  onTitleChange,
  onTitleBlur,
  onTitleCancel,
  onStartEditTitle,
  onUndo,
  onRedo,
  onOpenAiDialog,
  onTidyCanvas,
  onSaveWorkflow,
  onTrialRun,
  onSaveAndRun,
  onWorkflowMenuOpenChange,
  onOpenExplainDialog,
  onOpenImportDsl,
  onOpenExportDsl,
}: PipelineHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
      <div className="flex min-w-0 items-stretch">
        <button
          onClick={onBack}
          className="inline-flex w-[232px] flex-shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          data-testid="pipeline-back-cell"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('data.editor.back')}
        </button>
        <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
          {isEditingPipelineTitle ? (
            <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-surface px-2.5 shadow-soft ring-2 ring-accent/15">
              <input
                ref={pipelineTitleInputRef}
                value={pipelineTitle}
                maxLength={80}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={onTitleBlur}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    onTitleCancel();
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
              />
            </span>
          ) : (
            <h1 className="truncate text-[15px] font-medium text-text-secondary">
              {pipelineTitle}
            </h1>
          )}
          {!isEditingPipelineTitle && (
            <button
              onClick={onStartEditTitle}
              disabled={isBusy}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{t('common.edit')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-stretch">
        <div className="flex items-stretch">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={isBusy || !canUndo}
            className="h-full w-10 rounded-none border-l border-border-subtle"
            title={t('data.workflow.undo')}
            aria-label={t('data.workflow.undo')}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={isBusy || !canRedo}
            className="h-full w-10 rounded-none border-l border-border-subtle"
            title={t('data.workflow.redo')}
            aria-label={t('data.workflow.redo')}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          variant="secondary"
          onClick={onOpenAiDialog}
          disabled={isBusy || !hasWorkflow}
          className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t('data.workflow.aiGenerate')}
        </Button>
        <Button
          variant="secondary"
          onClick={onTidyCanvas}
          disabled={isBusy || nodeCount === 0}
          className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
          title={t('data.workflow.tidyLayoutHint')}
        >
          <Waypoints className="h-3.5 w-3.5" />
          {t('data.workflow.tidyLayout')}
        </Button>
        <Button
          variant="secondary"
          onClick={onSaveWorkflow}
          disabled={isBusy || !hasWorkflow || !isWorkflowDirty}
          className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <Button
          variant="secondary"
          onClick={onTrialRun}
          disabled={isBusy || !hasWorkflow}
          data-testid="pipeline-trial-run"
          className={`h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none ${
            runningKind === 'trial' ? 'bg-accent-muted/60 text-accent disabled:opacity-100' : ''
          }`}
        >
          {runningKind === 'trial' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {runningKind === 'trial' ? t('data.workflow.runningShort') : t('data.editor.trialRun')}
        </Button>
        <Button
          variant="ghost"
          onClick={onSaveAndRun}
          disabled={isBusy || !hasWorkflow}
          data-testid="pipeline-save-and-run"
          className={`h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs font-semibold text-accent shadow-none hover:bg-accent-muted/60 hover:text-accent ${
            runningKind === 'run' ? 'bg-accent-muted/60 disabled:opacity-100' : ''
          }`}
        >
          {runningKind === 'run' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {runningKind === 'run' ? t('data.workflow.runningShort') : t('data.editor.saveAndRun')}
        </Button>
        <GlassDropdownMenu
          open={workflowMenuOpen}
          onOpenChange={onWorkflowMenuOpenChange}
          align="end"
          contentClassName="w-40"
          trigger={
            <button
              type="button"
              disabled={isBusy || !hasWorkflow}
              className="inline-flex h-full w-10 items-center justify-center border-l border-border-subtle text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={t('data.actions.more')}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          }
        >
          <GlassMenuItem
            icon={<FileText className="h-3.5 w-3.5" />}
            onSelect={onOpenExplainDialog}
            disabled={nodeCount === 0}
          >
            {t('data.workflow.explainTitle')}
          </GlassMenuItem>
          <GlassMenuItem icon={<Upload className="h-3.5 w-3.5" />} onSelect={onOpenImportDsl}>
            {t('data.workflow.importDsl')}
          </GlassMenuItem>
          <GlassMenuItem icon={<Workflow className="h-3.5 w-3.5" />} onSelect={onOpenExportDsl}>
            {t('data.workflow.exportDsl')}
          </GlassMenuItem>
        </GlassDropdownMenu>
      </div>
    </div>
  );
}
