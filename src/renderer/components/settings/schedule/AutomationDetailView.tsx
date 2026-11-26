import type {
  AppConfig,
  Automation,
  AutomationActionDefinitionSummary,
  DataPipeline,
  DataRawTable,
  DataResultTable,
  Project,
} from '../../../types';
import {
  ActionChainSection,
  EditorHeader,
  ExecutionProjectPanel,
  TriggerConditionPanel,
} from './editorPanels';
import { automationToDraft } from './model';
import type { AutomationDraft, TranslateFn } from './types';

interface AutomationDetailViewProps {
  selectedAutomation: Automation | null;
  draft: AutomationDraft;
  projects: Project[];
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataPipelines: DataPipeline[];
  rawTables: DataRawTable[];
  resultTables: DataResultTable[];
  appConfig: AppConfig | null;
  isSaving: boolean;
  isDraftDirty: boolean;
  unsavedParts: string[];
  onDraftChange: (next: AutomationDraft) => void;
  onActionDraftChange: (next: AutomationDraft) => void;
  onEnabledChange: (enabled: boolean) => void;
  onDiscardChanges: () => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
  onGeneratedPipelineSuccess: (workflowDslAvailable: boolean) => void;
  tr: TranslateFn;
}

export function AutomationDetailView({
  selectedAutomation,
  draft,
  projects,
  actionDefinitions,
  dataPipelines,
  rawTables,
  resultTables,
  appConfig,
  isSaving,
  isDraftDirty,
  unsavedParts,
  onDraftChange,
  onActionDraftChange,
  onEnabledChange,
  onDiscardChanges,
  onSave,
  onRun,
  onBack,
  onGeneratedPipelineSuccess,
  tr,
}: AutomationDetailViewProps) {
  const savedDraft = selectedAutomation ? automationToDraft(selectedAutomation) : null;
  const triggerDirty =
    !savedDraft ||
    savedDraft.triggerMode !== draft.triggerMode ||
    JSON.stringify(savedDraft.trigger) !== JSON.stringify(draft.trigger);

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-text-primary">
      <EditorHeader
        selectedAutomation={selectedAutomation}
        draft={draft}
        isSaving={isSaving}
        isDirty={isDraftDirty}
        onDraftChange={onDraftChange}
        onEnabledChange={onEnabledChange}
        onSave={onSave}
        onRun={onRun}
        onBack={onBack}
        tr={tr}
      />
      {isDraftDirty && selectedAutomation && (
        <div className="flex h-9 flex-shrink-0 items-center justify-between gap-3 border-b border-warning/20 bg-warning/8 px-4 text-[12.5px] text-text-primary">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warning" />
            <span className="truncate">
              {tr('schedule.unsavedChanges')}
              {unsavedParts.length > 0 && `：${unsavedParts.join('、')}`}
            </span>
          </span>
          <button
            type="button"
            className="flex-shrink-0 text-xs text-text-secondary hover:text-text-primary"
            onClick={onDiscardChanges}
          >
            {tr('schedule.discardChanges')}
          </button>
        </div>
      )}

      <div className="ui-config-flush min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:overflow-hidden">
        <div className="min-h-0 border-b border-border-subtle md:overflow-y-auto md:border-b-0 md:border-r">
          <div>
            <ExecutionProjectPanel
              draft={draft}
              projects={projects}
              onDraftChange={onDraftChange}
              tr={tr}
            />
            <TriggerConditionPanel
              draft={draft}
              projects={projects}
              nextRunAt={selectedAutomation?.nextRunAt ?? null}
              triggerDirty={triggerDirty}
              onDraftChange={onDraftChange}
              tr={tr}
            />
          </div>
        </div>
        <ActionChainSection
          baselineNodes={savedDraft?.actionGraph.nodes}
          workingDirectory={projects.find((project) => project.id === draft.projectId)?.cwd}
          draft={draft}
          actionDefinitions={actionDefinitions}
          dataPipelines={dataPipelines}
          rawTables={rawTables}
          resultTables={resultTables}
          appConfig={appConfig}
          onDraftChange={onActionDraftChange}
          onGeneratedPipelineSuccess={onGeneratedPipelineSuccess}
          tr={tr}
        />
      </div>
    </div>
  );
}
