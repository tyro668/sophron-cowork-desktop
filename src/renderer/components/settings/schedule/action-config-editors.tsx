import { useDataPipelineAuthoringCompletion } from '../../../features/data/hooks/use-data-pipeline-authoring';
import { Button } from '../../ui/button';
import { CloudSyncEditor } from './cloud-sync-editor';
import { ScriptRunEditor } from './script-run-editor';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Database,
  FolderCode,
  Loader2,
  MessagesSquare,
  Plus,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type {
  AutomationActionDefinitionSummary,
  AutomationActionNode,
  AppConfig,
  DataPipeline,
  DataDashboard,
} from '../../../types';
import { exportWorkflowJflow } from '../../../../shared/jflow';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import { GlassSelect } from '../../GlassSelect';
import {
  ACTION_MENU_TYPES,
  CLOUD_TABLE_PROCESS_ACTION_TYPE,
  DATA_ACTION_TYPES,
  DATA_PREVIEW_ACTION_TYPES,
  type AutomationDraft,
} from './types';
import {
  createGeneratedCloudTableProcessNode,
  parseCloudAutomationConfig,
  defaultConfigForAction,
  relinkLinearGraph,
} from './model';
import {
  AutomationPromptPermissionFields,
  ConfigRow,
  FormRow,
  LocalTableSelect,
  SelectLine,
} from './editor-controls';
import { DataPipelineAiGenerateDialog } from '../../data-view/data-pipelines/DataPipelineAiGenerateDialog';
import { dataClient } from '../../../features/data/api/data-client';
import { ArrowLeftRight, CalendarClock, CloudUpload, CloudDownload } from 'lucide-react';

export function ActionChainSection({
  draft,
  actionDefinitions,
  dataPipelines,
  rawTables,
  resultTables,
  appConfig,
  onDraftChange,
  onGeneratedPipelineSuccess,
  workingDirectory,
  baselineNodes,
  tr,
}: {
  draft: AutomationDraft;
  /** Saved nodes, used to flag per-action "已修改". */
  baselineNodes?: AutomationActionNode[];
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataPipelines: DataPipeline[];
  rawTables: DataDashboard['rawTables'];
  resultTables: DataDashboard['resultTables'];
  appConfig: AppConfig | null;
  onDraftChange: (draft: AutomationDraft) => void;
  onGeneratedPipelineSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  tr: (key: string, fallback: string) => string;
}) {
  const nodes = draft.actionGraph.nodes;
  const updateNodes = (nextNodes: AutomationActionNode[]) =>
    onDraftChange({
      ...draft,
      actionGraph: relinkLinearGraph({ version: 1, nodes: nextNodes, edges: [] }),
    });
  const availableActionTypes = new Set(actionDefinitions.map((definition) => definition.type));
  const menuActionTypes = ACTION_MENU_TYPES.filter((type) => availableActionTypes.has(type));
  const addNode = (type: string) => {
    updateNodes([
      ...nodes,
      {
        id: crypto.randomUUID(),
        type,
        label: '',
        enabled: true,
        config: defaultConfigForAction(type),
      },
    ]);
  };
  const addActionButton = (
    <GlassDropdownMenu
      trigger={
        <button
          type="button"
          data-testid="automation-add-action"
          className="ui-accent-cell h-full w-[120px] flex-shrink-0 border-l border-border-subtle"
        >
          <Plus size={13} />
          {tr('schedule.addAction', '添加动作')}
        </button>
      }
    >
      {menuActionTypes.map((type) => (
        <GlassMenuItem
          key={type}
          onSelect={() => addNode(type)}
          description={getActionMenuDescription(type, tr)}
        >
          {getActionTitle(type, type, tr)}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
  return (
    <div className="min-h-0 min-w-0 overflow-y-auto">
      <section
        className="ui-group ui-form-flush flex min-w-0 flex-col bg-surface"
        data-testid="automation-actions-group"
      >
        <div className="flex h-[30px] flex-shrink-0 items-stretch border-b border-border-subtle bg-surface-muted">
          <h2 className="flex min-w-0 flex-1 items-center px-3 text-[12px] font-semibold text-text-primary">
            {tr('schedule.actionsCount', '执行动作 · {{count}}').replace(
              '{{count}}',
              String(nodes.length)
            )}
          </h2>
          {addActionButton}
        </div>
        {nodes.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center px-4 text-xs text-text-muted">
            {tr('schedule.noActions', '还没有动作，点击右上角「添加动作」。')}
          </div>
        ) : (
          nodes.map((node, index) => (
            <Fragment key={node.id}>
              {index > 0 && (
                <ActionDependencyConnector
                  previous={nodes[index - 1]}
                  onChange={(previous) =>
                    updateNodes(nodes.map((item) => (item.id === previous.id ? previous : item)))
                  }
                  tr={tr}
                />
              )}
              <ActionStepCard
                node={node}
                index={index}
                modified={
                  baselineNodes !== undefined &&
                  JSON.stringify(baselineNodes.find((item) => item.id === node.id) ?? null) !==
                    JSON.stringify(node)
                }
                onMove={(delta) => {
                  const target = index + delta;
                  if (target < 0 || target >= nodes.length) return;
                  const next = [...nodes];
                  [next[index], next[target]] = [next[target], next[index]];
                  updateNodes(next);
                }}
                isFirst={index === 0}
                isLast={index === nodes.length - 1}
                dataPipelines={dataPipelines}
                rawTables={rawTables}
                resultTables={resultTables}
                appConfig={appConfig}
                onGeneratedPipelineSuccess={onGeneratedPipelineSuccess}
                workingDirectory={workingDirectory}
                onRemove={() => updateNodes(nodes.filter((item) => item.id !== node.id))}
                onChange={(next) =>
                  updateNodes(nodes.map((item) => (item.id === next.id ? next : item)))
                }
                tr={tr}
              />
            </Fragment>
          ))
        )}
      </section>
    </div>
  );
}

/** "上一步成功后执行" (default, stop on failure) vs "总是执行" (continue). */
function ActionDependencyConnector({
  previous,
  onChange,
  tr,
}: {
  previous: AutomationActionNode;
  onChange: (previous: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const always = previous.failurePolicy?.onFailure === 'continue';
  const setAlways = (value: boolean) =>
    onChange(withActionOnFailure(previous, value ? 'continue' : 'stop'));
  return (
    <div
      className="flex h-[30px] items-center justify-center border-b border-border-subtle bg-surface"
      data-testid="automation-action-connector"
    >
      <GlassDropdownMenu
        trigger={
          <button
            type="button"
            className="inline-flex h-full items-center gap-1 px-3 text-[12px] text-text-muted transition-colors hover:text-text-secondary"
          >
            {always
              ? tr('schedule.dependencyAlways', '总是执行')
              : tr('schedule.dependencyOnSuccess', '上一步成功后执行')}
            <ChevronDown size={12} />
          </button>
        }
      >
        <GlassMenuItem selected={!always} onSelect={() => setAlways(false)}>
          {tr('schedule.dependencyOnSuccess', '上一步成功后执行')}
        </GlassMenuItem>
        <GlassMenuItem selected={always} onSelect={() => setAlways(true)}>
          {tr('schedule.dependencyAlways', '总是执行')}
        </GlassMenuItem>
      </GlassDropdownMenu>
    </div>
  );
}

export function ActionStepCard({
  node,
  index,
  dataPipelines,
  rawTables,
  resultTables,
  appConfig,
  onGeneratedPipelineSuccess,
  workingDirectory,
  onRemove,
  onChange,
  modified = false,
  onMove,
  isFirst = true,
  isLast = true,
  tr,
}: {
  node: AutomationActionNode;
  index: number;
  modified?: boolean;
  onMove?: (delta: -1 | 1) => void;
  isFirst?: boolean;
  isLast?: boolean;
  dataPipelines: DataPipeline[];
  rawTables: DataDashboard['rawTables'];
  resultTables: DataDashboard['resultTables'];
  appConfig: AppConfig | null;
  onGeneratedPipelineSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  onRemove: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const Icon = getActionIcon(node.type, node);
  const cellButton =
    'flex w-10 flex-shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    <div
      className="border-b border-border-subtle last:border-b-0"
      data-testid="automation-action-step"
      data-step-index={index}
    >
      <div className="min-w-0">
        <div className="flex h-9 items-stretch border-b border-border-subtle">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[12.5px] font-medium text-text-primary">
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            <span className="truncate">{getNodeLabel(node, tr)}</span>
            {modified && (
              <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                {tr('schedule.actionModified', '已修改')}
              </span>
            )}
          </div>
          {onMove && (
            <>
              <button
                type="button"
                disabled={isFirst}
                title={tr('schedule.moveUp', '上移')}
                aria-label={tr('schedule.moveUp', '上移')}
                className={cellButton}
                onClick={() => onMove(-1)}
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                disabled={isLast}
                title={tr('schedule.moveDown', '下移')}
                aria-label={tr('schedule.moveDown', '下移')}
                className={cellButton}
                onClick={() => onMove(1)}
              >
                <ChevronDown size={13} />
              </button>
            </>
          )}
          <button
            type="button"
            title={tr('common.delete', '删除')}
            aria-label={tr('common.delete', '删除')}
            className={cellButton}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <ActionConfigEditor
          node={node}
          dataPipelines={dataPipelines}
          rawTables={rawTables}
          resultTables={resultTables}
          appConfig={appConfig}
          onGeneratedPipelineSuccess={onGeneratedPipelineSuccess}
          workingDirectory={workingDirectory}
          onChange={onChange}
          tr={tr}
        />
        <div className="border-t border-border-subtle">
          <FormRow label={tr('schedule.onFailureLabel', '失败时')}>
            <GlassSelect
              value={node.failurePolicy?.onFailure === 'continue' ? 'continue' : 'stop'}
              ariaLabel={tr('schedule.onFailureLabel', '失败时')}
              options={[
                { value: 'stop', label: tr('schedule.onFailureStop', '停止后续动作') },
                {
                  value: 'continue',
                  label: tr('schedule.onFailureContinue', '继续（总是执行）'),
                },
              ]}
              onValueChange={(value: string) =>
                onChange(withActionOnFailure(node, value === 'continue' ? 'continue' : 'stop'))
              }
              triggerClassName="w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </FormRow>
        </div>
      </div>
    </div>
  );
}

/**
 * Single source of truth for an action's failure behaviour. The "总是执行" connector
 * between steps and the per-action 「失败时」 row both edit this one field.
 */
export function withActionOnFailure(
  node: AutomationActionNode,
  onFailure: 'stop' | 'continue'
): AutomationActionNode {
  return {
    ...node,
    failurePolicy:
      onFailure === 'continue' ? { onFailure: 'continue', emitErrorArtifact: false } : undefined,
  };
}

export function DataProcessActionEditor({
  node,
  dataPipelines,
  rawTables,
  onGeneratedPipelineSuccess,
  workingDirectory,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataPipelines: DataPipeline[];
  rawTables: DataDashboard['rawTables'];
  onGeneratedPipelineSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [processModeOverride, setProcessModeOverride] = useState<'pipeline' | 'ai' | null>(null);
  const generationSessionId = String(node.config.generationSessionId ?? '');
  const generationRequestId = String(node.config.generationRequestId ?? '');
  useDataPipelineAuthoringCompletion(
    generationSessionId && generationRequestId
      ? { sessionId: generationSessionId, requestId: generationRequestId }
      : null,
    (completion) => {
      const legacy = parseCloudAutomationConfig(node.config.cloudAutomation);
      if (legacy && legacy.source.location !== 'local') {
        onChange(
          createGeneratedCloudTableProcessNode(
            node,
            {
              ...legacy,
              output: {
                ...legacy.output,
                location: 'local',
                tableName: completion.result.resultTableName,
              },
            },
            completion.result
          )
        );
      } else
        onChange({
          ...node,
          type: 'data.pipeline.run',
          label: '',
          config: {
            pipelineId: completion.result.pipelineId,
            pipelineName: completion.result.pipelineName,
            outputMode: node.config.outputMode ?? 'persisted',
          },
        });
      setProcessModeOverride('pipeline');
      onGeneratedPipelineSuccess(completion.result.workflowDslAvailable);
    }
  );
  // Legacy drafts can supply a selected cloud/local source to the shared pipeline
  // authoring dialog. New actions simply reference an existing data pipeline.
  const legacyDraft = parseCloudAutomationConfig(node.config.cloudAutomation);
  const selectedPipelineId = String(node.config.pipelineId ?? '');
  const selectedPipeline = dataPipelines.find((pipeline) => pipeline.id === selectedPipelineId);
  const selectedInput = rawTables.find((table) => table.id === selectedPipeline?.sourceRawTableId);
  const pipelineOptions =
    selectedPipelineId && !selectedPipeline
      ? [
          { id: selectedPipelineId, name: String(node.config.pipelineName || selectedPipelineId) },
          ...dataPipelines,
        ]
      : dataPipelines;
  const selectPipeline = (pipelineId: string, pipelineName?: string) =>
    onChange({
      ...node,
      type: 'data.pipeline.run',
      label: '',
      // Replacing the selected pipeline also removes stale generated source/schema bindings.
      config: {
        pipelineId,
        pipelineName:
          pipelineName || dataPipelines.find((pipeline) => pipeline.id === pipelineId)?.name,
        outputMode: 'persisted',
      },
    });
  const legacySource = legacyDraft?.source.tableId
    ? {
        ...legacyDraft.source,
        location: legacyDraft.source.location === 'local' ? ('local' as const) : ('cloud' as const),
        columnsSnapshot: (legacyDraft.source.columns ?? [])
          .map((column) =>
            typeof column === 'string'
              ? { name: column }
              : { name: column.name ?? '', type: column.type }
          )
          .filter((column) => column.name),
      }
    : null;
  const processMode = processModeOverride ?? 'pipeline';
  return (
    <div>
      <FormRow label={tr('schedule.dataProcessModeLabel', '处理方式')}>
        <GlassSelect
          value={processMode}
          ariaLabel={tr('schedule.dataProcessModeLabel', '处理方式')}
          options={[
            { value: 'pipeline', label: tr('schedule.dataProcessModePipeline', '复用数据加工') },
            { value: 'ai', label: tr('schedule.dataProcessModeAi', 'AI 生成加工') },
          ]}
          onValueChange={(value: string) =>
            setProcessModeOverride(value === 'ai' ? 'ai' : 'pipeline')
          }
          triggerClassName="w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </FormRow>
      {processMode === 'ai' ? (
        <FormRow label={tr('schedule.dataPipelineLabel', '数据加工')}>
          <button
            type="button"
            data-testid="automation-ai-generate"
            className="ui-accent-cell ui-flush-control !justify-start"
            onClick={() => setGenerateOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {tr('data.aiPipelineGenerate', 'AI 生成数据加工')}
          </button>
        </FormRow>
      ) : (
        <FormRow label={tr('schedule.dataPipelineLabel', '数据加工')}>
          <LocalTableSelect
            value={selectedPipelineId}
            tables={pipelineOptions}
            placeholder={tr('schedule.dataPipelinePlaceholder', '选择数据加工')}
            searchPlaceholder={tr('schedule.dataPipelineSearchPlaceholder', '搜索数据加工')}
            onChange={(value) => selectPipeline(value)}
          />
        </FormRow>
      )}
      {selectedPipelineId && processMode === 'pipeline' && (
        <FormRow label={tr('schedule.executionMode', '执行方式')}>
          <GlassSelect
            value={String(node.config.outputMode ?? 'persisted')}
            options={[
              { value: 'persisted', label: tr('schedule.executionFormal', '正式执行') },
              { value: 'temporary', label: tr('schedule.executionTemporary', '临时执行') },
            ]}
            onValueChange={(outputMode) =>
              onChange({ ...node, config: { ...node.config, outputMode } })
            }
            triggerClassName="w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </FormRow>
      )}
      {node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE &&
        (node.config.output as { location?: string } | undefined)?.location !== 'local' && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-warning">
              {tr(
                'schedule.cloudSync.useOutputAction',
                '数据处理结果请保存到本地结果表，再添加写入网盘文件动作。'
              )}
            </p>
            <Button
              size="sm"
              onClick={() => {
                const output = (node.config.output ?? {}) as Record<string, unknown>;
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    output: {
                      ...output,
                      location: 'local',
                      writeMode: 'replace',
                      targetTableId: output.localResultTableId,
                    },
                  },
                });
              }}
            >
              {tr('schedule.cloudSync.useLocalOutput', '改为本地结果表')}
            </Button>
          </div>
        )}
      {selectedPipelineId && processMode === 'pipeline' && (
        <GeneratedPipelineReviewCard node={node} tr={tr} />
      )}
      <DataPipelineAiGenerateDialog
        open={generateOpen}
        workingDirectory={workingDirectory}
        boundRawTable={selectedInput ? { id: selectedInput.id, name: selectedInput.name } : null}
        initialSource={legacySource}
        initialRequirement={legacyDraft?.processRequirement}
        initialOutput={legacyDraft ? { ...legacyDraft.output, location: 'local' } : undefined}
        onOpenChange={setGenerateOpen}
        onStarted={(sessionId, request) =>
          onChange({
            ...node,
            config: {
              ...node.config,
              generationSessionId: sessionId,
              generationRequestId: request.id,
            },
          })
        }
      />
    </div>
  );
}

export function GeneratedPipelineReviewCard({
  node,
  tr,
}: {
  node: AutomationActionNode;
  tr: (key: string, fallback: string) => string;
}) {
  const pipelineId = String(node.config.pipelineId ?? '').trim();
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowDsl, setWorkflowDsl] = useState('');
  const workflowRequestSeq = useRef(0);
  const [isLoadingWorkflowDsl, setIsLoadingWorkflowDsl] = useState(false);
  const [workflowDslLoadFailed, setWorkflowDslLoadFailed] = useState(false);
  const requiredColumns = Array.isArray(node.config.requiredColumns)
    ? node.config.requiredColumns
        .map((column) =>
          column && typeof column === 'object' && 'name' in column
            ? String((column as { name?: unknown }).name ?? '')
            : ''
        )
        .filter(Boolean)
    : [];
  const loadCurrentWorkflowDsl = useCallback(async () => {
    if (!pipelineId || !dataClient.has('getPipelineWorkflow')) return;
    const requestId = ++workflowRequestSeq.current;
    setIsLoadingWorkflowDsl(true);
    setWorkflowDslLoadFailed(false);
    try {
      const workflow = await dataClient.getPipelineWorkflow(pipelineId);
      if (requestId !== workflowRequestSeq.current) return;
      setWorkflowDsl(exportWorkflowJflow(workflow.nodes, workflow.edges).text);
    } catch {
      if (requestId !== workflowRequestSeq.current) return;
      setWorkflowDsl('');
      setWorkflowDslLoadFailed(true);
    } finally {
      if (requestId === workflowRequestSeq.current) setIsLoadingWorkflowDsl(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    setWorkflowOpen(false);
    setWorkflowDsl('');
    setWorkflowDslLoadFailed(false);
    return () => {
      workflowRequestSeq.current += 1;
    };
  }, [loadCurrentWorkflowDsl]);

  return (
    <div className="border-t border-border-subtle">
      <FormRow label={tr('schedule.dataPipelineLogic', '任务逻辑')}>
        {pipelineId ? (
          <button
            type="button"
            className="ui-flush-control flex items-center gap-1.5 text-left text-[12.5px] font-medium text-accent-text"
            onClick={() => {
              const next = !workflowOpen;
              setWorkflowOpen(next);
              if (next) void loadCurrentWorkflowDsl();
            }}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${workflowOpen ? 'rotate-90' : ''}`}
            />
            {tr('schedule.currentWorkflowDslPreview', '查看当前任务逻辑')}
          </button>
        ) : (
          <span className="ui-flush-text">—</span>
        )}
      </FormRow>
      <div
        className={
          requiredColumns.length > 0 || workflowOpen
            ? 'space-y-2 border-t border-border-subtle px-3 py-2'
            : 'hidden'
        }
      >
        {requiredColumns.length > 0 && (
          <div className="text-[12px] leading-5 text-text-muted">
            {tr('schedule.requiredColumnsValue', '所需字段：{{columns}}').replace(
              '{{columns}}',
              requiredColumns.join(', ')
            )}
          </div>
        )}
        {workflowOpen &&
          pipelineId &&
          (isLoadingWorkflowDsl ? (
            <div
              className="flex items-center gap-2 text-[12px] text-text-muted"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tr('schedule.loadingWorkflowDsl', '正在读取任务逻辑…')}
            </div>
          ) : workflowDslLoadFailed ? (
            <div
              className="rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-[12px] leading-5 text-warning"
              role="alert"
            >
              {tr('schedule.workflowDslLoadFailed', '读取当前任务逻辑失败')}
            </div>
          ) : (
            <pre className="max-h-48 overflow-auto rounded-md border border-border-muted bg-surface p-2 text-[11px] leading-5 text-text-secondary">
              {workflowDsl || tr('schedule.workflowDslEmpty', '当前数据加工没有可展示的处理逻辑')}
            </pre>
          ))}
      </div>
    </div>
  );
}

export function ActionConfigEditor({
  node,
  dataPipelines,
  rawTables,
  resultTables,
  appConfig,
  onGeneratedPipelineSuccess,
  workingDirectory,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataPipelines: DataPipeline[];
  rawTables: DataDashboard['rawTables'];
  resultTables: DataDashboard['resultTables'];
  appConfig: AppConfig | null;
  onGeneratedPipelineSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const configRef = useRef(node.config);
  useEffect(() => {
    configRef.current = node.config;
  }, [node.config]);
  const setConfig = (config: Record<string, unknown>) => {
    configRef.current = config;
    onChange({ ...node, config });
  };
  const conversationPrompt = String(node.config.prompt ?? '');
  const conversationSelectedSkillNames = useMemo(
    () =>
      Array.isArray(node.config.selectedSkillNames)
        ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
        : [],
    [node.config.selectedSkillNames]
  );
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
  return (
    <div
      className={
        isDataProcessNode(node) ||
        node.type === 'cloud.sync' ||
        node.type === 'script.run' ||
        (node.type === 'conversation.run' && !cloudAutomation)
          ? ''
          : 'space-y-4 p-3'
      }
    >
      {isDataProcessNode(node) && (
        <DataProcessActionEditor
          node={node}
          dataPipelines={dataPipelines}
          rawTables={rawTables}
          onGeneratedPipelineSuccess={onGeneratedPipelineSuccess}
          workingDirectory={workingDirectory}
          onChange={onChange}
          tr={tr}
        />
      )}
      {node.type === 'cloud.sync' && (
        <CloudSyncEditor
          node={node}
          rawTables={rawTables}
          resultTables={resultTables}
          onChange={onChange}
        />
      )}
      {node.type === 'script.run' && (
        <ScriptRunEditor node={node} rawTables={rawTables} onChange={onChange} />
      )}
      {node.type === 'data.raw.preview' && (
        <ConfigRow label={tr('schedule.inputDataLabel', '输入数据')}>
          <SelectLine
            value={String(node.config.rawTableId ?? '')}
            options={rawTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.rawTablePlaceholder', '选择原始表')}
            onChange={(value) => setConfig({ ...node.config, rawTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'data.result.preview' && (
        <ConfigRow label={tr('schedule.outputDataLabel', '结果表')}>
          <SelectLine
            value={String(node.config.resultTableId ?? '')}
            options={resultTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.resultTablePlaceholder', '选择结果表')}
            onChange={(value) => setConfig({ ...node.config, resultTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'conversation.run' && !cloudAutomation && (
        <AutomationPromptPermissionFields
          value={conversationPrompt}
          onChange={(prompt) => setConfig({ ...node.config, prompt })}
          selectedSkillNames={conversationSelectedSkillNames}
          onSelectedSkillNamesChange={(selectedSkillNames) =>
            setConfig({ ...node.config, selectedSkillNames })
          }
          onSkillSelectionCommit={({ value, selectedSkillNames }) =>
            setConfig({ ...node.config, prompt: value, selectedSkillNames })
          }
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          onModelSelect={({ configSetId, model }) =>
            setConfig({
              ...node.config,
              modelConfigSetId: configSetId,
              model,
            })
          }
          placeholder={tr('schedule.promptPlaceholder', '输入任务对话要执行的内容')}
          tr={tr}
        />
      )}
    </div>
  );
}

export function getActionTitle(
  type: string,
  fallback: string,
  tr: (key: string, fallback: string) => string
): string {
  if (type === 'cloud.sync') return tr('schedule.cloudSync.menuTitle', '云空间同步');
  if (type === 'script.run') return tr('schedule.script.title', '执行脚本');
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE || type === 'data.pipeline.run') {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (type === 'conversation.run') {
    return tr('schedule.actionTypes.conversationRun.title', fallback);
  }
  if (type === 'data.pipeline.run') {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (isDataActionType(type)) {
    return tr('schedule.actionTypes.data.title', fallback);
  }
  return fallback;
}

export function getActionMenuDescription(
  type: string,
  tr: (key: string, fallback: string) => string
): string | undefined {
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE || type === 'data.pipeline.run') {
    return tr(
      'schedule.dataProcessActionDescription',
      '执行已有数据加工，或调用数据加工的 AI 生成功能创建任务'
    );
  }
  if (type === 'cloud.sync') {
    return tr('schedule.cloudSync.menuDescription', '在云空间与本地数据表之间同步数据');
  }
  if (type === 'script.run') {
    return tr('schedule.script.menuDescription', '运行已保存的脚本，不调用 AI');
  }
  if (type === 'conversation.run') {
    return tr(
      'schedule.actionTypes.conversationRun.description',
      '用自然语言下达开放式指令，由 AI 自主完成'
    );
  }
  return undefined;
}

export function getActionIcon(type: string, node?: AutomationActionNode): LucideIcon {
  if (type === 'cloud.sync') {
    if (node?.config.direction === 'input') return CloudDownload;
    if (node?.config.direction === 'output') return CloudUpload;
    return ArrowLeftRight;
  }
  if (type === 'script.run') return FolderCode;
  if (node && isDataProcessNode(node)) return Database;
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return Database;
  if (type === 'conversation.run') return MessagesSquare;
  if (isDataActionType(type)) return Database;
  return CalendarClock;
}

// A node belongs to the unified "数据处理" action when it either runs a saved data pipeline
// (复用数据加工) or is a cloud-table conversation carrying a cloudAutomation config (AI 描述).
export function isDataProcessNode(node: AutomationActionNode): boolean {
  if (node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return true;
  if (node.type === 'data.pipeline.run') return true;
  return (
    node.type === 'conversation.run' &&
    Boolean(parseCloudAutomationConfig(node.config.cloudAutomation))
  );
}

export function getNodeLabel(
  node: AutomationActionNode,
  tr: (key: string, fallback: string) => string
): string {
  if (isDataProcessNode(node)) {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (node.type === 'cloud.sync' && (!node.label || node.label === node.type)) {
    if (node.config.direction === 'input')
      return tr('schedule.cloudInput.title', '云端表同步到原始表');
    if (node.config.direction === 'output')
      return tr('schedule.cloudSync.title', '结果表写入网盘文件');
  }
  const fallback = getActionTitle(node.type, node.type, tr);
  if (!node.label || node.label === node.type) return fallback;
  if (node.type === 'conversation.run' && node.label === 'Conversation') return fallback;
  if (node.type === 'data.pipeline.run' && node.label === 'Data pipeline') return fallback;
  return node.label;
}

export function isDataActionType(type: string): boolean {
  return DATA_ACTION_TYPES.includes(type) || DATA_PREVIEW_ACTION_TYPES.includes(type);
}
