import { useDataTaskAuthoringCompletion } from '../../../features/data/hooks/use-data-task-authoring';
import { Button } from '../../ui/button';
import { CloudSyncEditor } from './cloud-sync-editor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Database,
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
  DataCleaningTask,
  DataDashboard,
} from '../../../types';
import { exportPrepWorkflowDsl } from '../../../../shared/prep-dsl';
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
  FieldStack,
  LocalTableSelect,
  MiniIcon,
  SelectLine,
} from './editor-controls';
import { DataTaskAiGenerateDialog } from '../../data-view/data-tasks/DataTaskAiGenerateDialog';
import { dataClient } from '../../../features/data/api/data-client';
import { flatToolbarRowClass } from '../../data-view/shared';
import { ArrowLeftRight, CalendarClock, CloudUpload, CloudDownload } from 'lucide-react';

export function ActionChainSection({
  draft,
  actionDefinitions,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onDraftChange,
  onGeneratedTaskSuccess,
  workingDirectory,
  tr,
}: {
  draft: AutomationDraft;
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onDraftChange: (draft: AutomationDraft) => void;
  onGeneratedTaskSuccess: (workflowDslAvailable: boolean) => void;
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
        <button className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-muted px-2.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15">
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
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <h2 className="min-w-0 text-[13px] font-semibold text-text-secondary">
          {tr('schedule.actionsTitle', '执行动作')}
        </h2>
        {addActionButton}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="flex h-full min-h-24 items-center justify-center px-4 text-xs text-text-muted">
            {tr('schedule.noActions', '还没有动作，点击右上角「添加动作」。')}
          </div>
        ) : (
          nodes.map((node, index) => (
            <ActionStepCard
              key={node.id}
              node={node}
              index={index}
              dataTasks={dataTasks}
              inputTables={inputTables}
              outputTables={outputTables}
              appConfig={appConfig}
              onGeneratedTaskSuccess={onGeneratedTaskSuccess}
              workingDirectory={workingDirectory}
              onRemove={() => updateNodes(nodes.filter((item) => item.id !== node.id))}
              onChange={(next) =>
                updateNodes(nodes.map((item) => (item.id === next.id ? next : item)))
              }
              tr={tr}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function ActionStepCard({
  node,
  index,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  workingDirectory,
  onRemove,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  index: number;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onGeneratedTaskSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  onRemove: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const Icon = getActionIcon(node.type, node);
  return (
    <div className="border-b border-border-muted px-4 py-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-text-secondary">
          {index + 1}
        </span>
        <Icon className="h-4 w-4 flex-shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
          {getNodeLabel(node, tr)}
        </div>
        <MiniIcon
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </MiniIcon>
      </div>
      <ActionConfigEditor
        node={node}
        dataTasks={dataTasks}
        inputTables={inputTables}
        outputTables={outputTables}
        appConfig={appConfig}
        onGeneratedTaskSuccess={onGeneratedTaskSuccess}
        workingDirectory={workingDirectory}
        onChange={onChange}
        tr={tr}
      />
    </div>
  );
}

export function DataProcessActionEditor({
  node,
  dataTasks,
  inputTables,
  onGeneratedTaskSuccess,
  workingDirectory,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  onGeneratedTaskSuccess: (workflowDslAvailable: boolean) => void;
  workingDirectory?: string;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [generateOpen, setGenerateOpen] = useState(false);
  const generationSessionId = String(node.config.generationSessionId ?? '');
  const generationRequestId = String(node.config.generationRequestId ?? '');
  useDataTaskAuthoringCompletion(
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
                tableName: completion.result.outputTableName,
              },
            },
            completion.result
          )
        );
      } else
        onChange({
          ...node,
          type: 'data.task.run',
          label: '',
          config: {
            taskId: completion.result.taskId,
            taskName: completion.result.taskName,
            outputMode: node.config.outputMode ?? 'persisted',
          },
        });
      onGeneratedTaskSuccess(completion.result.workflowDslAvailable);
    }
  );
  // Legacy drafts can supply a selected cloud/local source to the shared task
  // authoring dialog. New actions simply reference an existing data task.
  const legacyDraft = parseCloudAutomationConfig(node.config.cloudAutomation);
  const selectedTaskId = String(node.config.taskId ?? '');
  const selectedTask = dataTasks.find((task) => task.id === selectedTaskId);
  const selectedInput = inputTables.find((table) => table.id === selectedTask?.sourceDatasetId);
  const taskOptions =
    selectedTaskId && !selectedTask
      ? [{ id: selectedTaskId, name: String(node.config.taskName || selectedTaskId) }, ...dataTasks]
      : dataTasks;
  const selectTask = (taskId: string, taskName?: string) =>
    onChange({
      ...node,
      type: 'data.task.run',
      label: '',
      // Replacing the selected task also removes stale generated source/schema bindings.
      config: {
        taskId,
        taskName: taskName || dataTasks.find((task) => task.id === taskId)?.name,
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
  return (
    <div className="space-y-3">
      <FieldStack label={tr('schedule.dataTaskLabel', '数据任务')}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LocalTableSelect
              value={selectedTaskId}
              tables={taskOptions}
              placeholder={tr('schedule.dataTaskPlaceholder', '选择数据任务')}
              searchPlaceholder={tr('schedule.dataTaskSearchPlaceholder', '搜索数据任务')}
              onChange={(value) => selectTask(value)}
            />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="shrink-0"
            onClick={() => setGenerateOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {tr('data.aiTaskGenerate', 'AI 生成数据任务')}
          </Button>
        </div>
      </FieldStack>
      {selectedTaskId && (
        <FieldStack label={tr('schedule.executionMode', '执行方式')}>
          <GlassSelect
            value={String(node.config.outputMode ?? 'persisted')}
            options={[
              { value: 'persisted', label: tr('schedule.executionFormal', '正式执行') },
              { value: 'temporary', label: tr('schedule.executionTemporary', '临时执行') },
            ]}
            onValueChange={(outputMode) =>
              onChange({ ...node, config: { ...node.config, outputMode } })
            }
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </FieldStack>
      )}
      {node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE &&
        (node.config.output as { location?: string } | undefined)?.location !== 'local' && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-warning">
              {tr(
                'schedule.cloudSync.useOutputAction',
                '数据处理结果请保存到本地输出表，再添加写入网盘文件动作。'
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
                      targetTableId: output.localOutputTableId,
                    },
                  },
                });
              }}
            >
              {tr('schedule.cloudSync.useLocalOutput', '改为本地输出表')}
            </Button>
          </div>
        )}
      {selectedTaskId && <GeneratedTaskReviewCard node={node} tr={tr} />}
      <DataTaskAiGenerateDialog
        open={generateOpen}
        workingDirectory={workingDirectory}
        boundInputTable={selectedInput ? { id: selectedInput.id, name: selectedInput.name } : null}
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

export function GeneratedTaskReviewCard({
  node,
  tr,
}: {
  node: AutomationActionNode;
  tr: (key: string, fallback: string) => string;
}) {
  const taskId = String(node.config.taskId ?? '').trim();
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
    if (!taskId || !dataClient.has('getTaskWorkflow')) return;
    const requestId = ++workflowRequestSeq.current;
    setIsLoadingWorkflowDsl(true);
    setWorkflowDslLoadFailed(false);
    try {
      const workflow = await dataClient.getTaskWorkflow(taskId);
      if (requestId !== workflowRequestSeq.current) return;
      setWorkflowDsl(exportPrepWorkflowDsl(workflow.nodes, workflow.edges));
    } catch {
      if (requestId !== workflowRequestSeq.current) return;
      setWorkflowDsl('');
      setWorkflowDslLoadFailed(true);
    } finally {
      if (requestId === workflowRequestSeq.current) setIsLoadingWorkflowDsl(false);
    }
  }, [taskId]);

  useEffect(() => {
    setWorkflowOpen(false);
    setWorkflowDsl('');
    setWorkflowDslLoadFailed(false);
    return () => {
      workflowRequestSeq.current += 1;
    };
  }, [loadCurrentWorkflowDsl]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-text-muted">
          {tr('schedule.dataTaskLogic', '任务逻辑')}
        </span>
        {taskId && (
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-medium text-accent"
            onClick={() => {
              const next = !workflowOpen;
              setWorkflowOpen(next);
              if (next) void loadCurrentWorkflowDsl();
            }}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${workflowOpen ? 'rotate-90' : ''}`}
            />
            {tr('schedule.currentWorkflowDslPreview', '查看当前任务逻辑')}
          </button>
        )}
      </div>
      {requiredColumns.length > 0 && (
        <div className="text-[12px] leading-5 text-text-muted">
          {tr('schedule.requiredColumnsValue', '所需字段：{{columns}}').replace(
            '{{columns}}',
            requiredColumns.join(', ')
          )}
        </div>
      )}
      {workflowOpen &&
        taskId &&
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
            {workflowDsl || tr('schedule.workflowDslEmpty', '当前数据任务没有可展示的处理逻辑')}
          </pre>
        ))}
    </div>
  );
}

export function ActionConfigEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  workingDirectory,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onGeneratedTaskSuccess: (workflowDslAvailable: boolean) => void;
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
    <div className="space-y-4">
      {isDataProcessNode(node) && (
        <DataProcessActionEditor
          node={node}
          dataTasks={dataTasks}
          inputTables={inputTables}
          onGeneratedTaskSuccess={onGeneratedTaskSuccess}
          workingDirectory={workingDirectory}
          onChange={onChange}
          tr={tr}
        />
      )}
      {node.type === 'cloud.sync' && (
        <CloudSyncEditor
          node={node}
          inputTables={inputTables}
          outputTables={outputTables}
          onChange={onChange}
        />
      )}
      {node.type === 'data.input.preview' && (
        <ConfigRow label={tr('schedule.inputDataLabel', '输入数据')}>
          <SelectLine
            value={String(node.config.inputTableId ?? '')}
            options={inputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
            onChange={(value) => setConfig({ ...node.config, inputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'data.output.preview' && (
        <ConfigRow label={tr('schedule.outputDataLabel', '输出表')}>
          <SelectLine
            value={String(node.config.outputTableId ?? '')}
            options={outputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
            onChange={(value) => setConfig({ ...node.config, outputTableId: value, limit: 20 })}
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
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE || type === 'data.task.run') {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (type === 'conversation.run') {
    return tr('schedule.actionTypes.conversationRun.title', fallback);
  }
  if (type === 'data.task.run') {
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
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE || type === 'data.task.run') {
    return tr(
      'schedule.dataProcessActionDescription',
      '执行已有数据任务，或调用数据任务的 AI 生成功能创建任务'
    );
  }
  if (type === 'cloud.sync') {
    return tr('schedule.cloudSync.menuDescription', '在云空间与本地数据表之间同步数据');
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
  if (node && isDataProcessNode(node)) return Database;
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return Database;
  if (type === 'conversation.run') return MessagesSquare;
  if (isDataActionType(type)) return Database;
  return CalendarClock;
}

// A node belongs to the unified "数据处理" action when it either runs a saved data task
// (复用数据任务) or is a cloud-table conversation carrying a cloudAutomation config (AI 描述).
export function isDataProcessNode(node: AutomationActionNode): boolean {
  if (node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE) return true;
  if (node.type === 'data.task.run') return true;
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
      return tr('schedule.cloudInput.title', '云端表同步到输入表');
    if (node.config.direction === 'output')
      return tr('schedule.cloudSync.title', '输出表写入网盘文件');
  }
  const fallback = getActionTitle(node.type, node.type, tr);
  if (!node.label || node.label === node.type) return fallback;
  if (node.type === 'conversation.run' && node.label === 'Conversation') return fallback;
  if (node.type === 'data.task.run' && node.label === 'Data task') return fallback;
  return node.label;
}

export function isDataActionType(type: string): boolean {
  return DATA_ACTION_TYPES.includes(type) || DATA_PREVIEW_ACTION_TYPES.includes(type);
}
