import { cloudSyncSchema } from '../../../../shared/automation/cloud-sync';
import { getAgentModelLabel } from '../../AgentModelSelector';
import type {
  Automation,
  AutomationActionGraph,
  AutomationActionNode,
  AutomationCreateInput,
  AutomationUpdateInput,
  AppConfig,
} from '../../../types';
import {
  CLOUD_TABLE_PROCESS_ACTION_TYPE,
  DEFAULT_TIME,
  SYSTEM_TIMEZONE,
  type AutomationDraft,
  type CloudAutomationWriteMode,
  type CloudTableAutomationConfig,
  type EditableAutomationTrigger,
  type PendingCloudAutomationTemplate,
  type TriggerMode,
  getOutputLocation,
  getSourceLocation,
  normalizeDataProcessLocation,
} from './types';

export function createEmptyDraft(name: string): AutomationDraft {
  const trigger: EditableAutomationTrigger = {
    kind: 'daily',
    times: ['09:00'],
    timezone: SYSTEM_TIMEZONE,
  };
  return {
    name,
    description: '',
    projectId: '',
    enabled: true,
    permissionPolicy: 'full_access',
    triggerMode: 'daily',
    trigger,
    actionGraph: {
      version: 1,
      nodes: [],
      edges: [],
    },
  };
}

export function createCloudTableAutomationDraft(
  template: PendingCloudAutomationTemplate,
  tr: (key: string, fallback: string) => string
): AutomationDraft {
  const trigger: EditableAutomationTrigger = {
    kind: 'daily',
    times: ['09:00'],
    timezone: SYSTEM_TIMEZONE,
  };
  const config: CloudTableAutomationConfig = {
    kind: 'cloud_table_auto_process',
    source: { ...template.source, location: 'cloud' },
    processRequirement: '',
    output: {
      location: 'local',
      writeMode: 'create',
      targetTableId: '',
      tableName: `${template.source.tableName || 'cloud_table'}_processed`,
      spaceId: template.source.spaceId,
      projectId: template.source.projectId,
      datasourceId: template.source.datasourceId,
      folderId: template.source.folderId,
    },
    accessModeLabel: template.accessModeLabel,
    connectionLabel: template.connectionLabel,
  };
  const tableName = template.source.tableName || tr('schedule.cloudTableFallbackName', '云表');
  return {
    name: tr('schedule.cloudAutomationDefaultName', '{{name}}自动处理').replace(
      '{{name}}',
      tableName
    ),
    description: tr('schedule.cloudAutomationDescription', '自动导入云空间表并保存数据处理结果'),
    projectId: '',
    enabled: true,
    permissionPolicy: 'full_access',
    triggerMode: 'daily',
    trigger,
    actionGraph: {
      version: 1,
      nodes: [
        {
          id: crypto.randomUUID(),
          type: 'conversation.run',
          label: tr('schedule.cloudAutoProcessTitle', '云表自动处理'),
          enabled: true,
          config: {
            prompt: buildCloudAutomationPrompt(config),
            selectedSkillNames: [],
            projectId: '',
            modelConfigSetId: null,
            model: null,
            completionMode: 'wait',
            timeoutMs: 30 * 60 * 1000,
            collectArtifacts: true,
            permissionPolicy: 'full_access',
            cloudAutomation: config,
          },
        },
      ],
      edges: [],
    },
  };
}

export function createGeneratedCloudTableProcessNode(
  baseNode: AutomationActionNode,
  config: CloudTableAutomationConfig,
  result: {
    pipelineId: string;
    pipelineName: string;
    resultTableId: string;
    requiredColumns: Array<{ name: string; type?: string }>;
    expectedOutputSchema?: Array<{ name: string; type?: string }>;
    lineage?: Array<{
      name: string;
      type?: string;
      sourceColumns: Array<{ name: string; type?: string }>;
      expression?: string;
    }>;
    columnsSnapshot: Array<{ name: string; type?: string }>;
    sourceSummaryHash: string;
    workflowHash: string;
    version: number;
    generatedAt: number;
  }
): AutomationActionNode {
  return {
    ...baseNode,
    type: CLOUD_TABLE_PROCESS_ACTION_TYPE,
    label: '',
    config: {
      pipelineId: result.pipelineId,
      pipelineName: result.pipelineName,
      source: {
        location: getSourceLocation(config),
        tableId: config.source.tableId,
        tableName: config.source.tableName,
        spaceId: config.source.spaceId,
        spaceName: config.source.spaceName,
        projectId: config.source.projectId,
        projectName: config.source.projectName,
        datasourceId: config.source.datasourceId,
        folderId: config.source.folderId,
        columnsSnapshot: result.columnsSnapshot,
        requiredColumns: result.requiredColumns,
        updatedAt: config.source.updatedAt,
        contentHash: config.source.contentHash,
      },
      output: {
        location: getOutputLocation(config),
        writeMode: config.output.writeMode,
        targetTableId: config.output.targetTableId || undefined,
        tableName: config.output.tableName,
        spaceId: config.output.spaceId || config.source.spaceId,
        projectId: config.output.projectId || config.source.projectId,
        datasourceId: config.output.datasourceId || config.source.datasourceId,
        folderId: config.output.folderId || config.source.folderId,
        localResultTableId: result.resultTableId,
      },
      requiredColumns: result.requiredColumns,
      expectedOutputSchema: result.expectedOutputSchema ?? [],
      lineage: result.lineage ?? [],
      columnsSnapshot: result.columnsSnapshot,
      sourceSummaryHash: result.sourceSummaryHash,
      workflowHash: result.workflowHash,
      generatedVersion: result.version,
      generatedAt: result.generatedAt,
      schemaPolicy: 'required_subset',
      outputMode: 'persisted',
    },
  };
}

export function parsePendingCloudAutomationTemplate(
  raw: string
): PendingCloudAutomationTemplate | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingCloudAutomationTemplate>;
    if (!value.source || typeof value.source.tableId !== 'string') return null;
    return {
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      source: {
        tableId: value.source.tableId,
        tableName:
          typeof value.source.tableName === 'string' && value.source.tableName.trim()
            ? value.source.tableName
            : value.source.tableId,
        spaceId: typeof value.source.spaceId === 'string' ? value.source.spaceId : undefined,
        spaceName: typeof value.source.spaceName === 'string' ? value.source.spaceName : undefined,
        projectId: typeof value.source.projectId === 'string' ? value.source.projectId : undefined,
        projectName:
          typeof value.source.projectName === 'string' ? value.source.projectName : undefined,
        datasourceId:
          typeof value.source.datasourceId === 'string' ? value.source.datasourceId : undefined,
        folderId: typeof value.source.folderId === 'string' ? value.source.folderId : undefined,
        rowCount:
          typeof value.source.rowCount === 'number' && Number.isFinite(value.source.rowCount)
            ? value.source.rowCount
            : null,
        columns: Array.isArray(value.source.columns) ? value.source.columns : [],
      },
      accessModeLabel:
        typeof value.accessModeLabel === 'string' ? value.accessModeLabel : undefined,
      connectionLabel:
        typeof value.connectionLabel === 'string' ? value.connectionLabel : undefined,
    };
  } catch {
    return null;
  }
}

export function parseCloudAutomationConfig(value: unknown): CloudTableAutomationConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Partial<CloudTableAutomationConfig>;
  if (config.kind !== 'cloud_table_auto_process') return null;
  const source = config.source;
  if (!source || typeof source.tableId !== 'string') return null;
  const output = config.output ?? {
    writeMode: 'create' as const,
    targetTableId: '',
    tableName: `${source.tableName || source.tableId}_processed`,
  };
  const writeMode: CloudAutomationWriteMode = output.writeMode === 'replace' ? 'replace' : 'create';
  const sourceLocation = normalizeDataProcessLocation(source.location);
  const outputLocation = normalizeDataProcessLocation(output.location);
  return {
    kind: 'cloud_table_auto_process',
    source: {
      ...source,
      location: sourceLocation,
      tableName:
        typeof source.tableName === 'string' && source.tableName.trim()
          ? source.tableName
          : source.tableId,
      columns: Array.isArray(source.columns) ? source.columns : [],
    },
    processRequirement:
      typeof config.processRequirement === 'string' ? config.processRequirement : '',
    output: {
      location: outputLocation,
      writeMode,
      // Only cloud "replace" falls back to the source table id (overwrite the same cloud
      // table). For local, never default the target to the input — that would overwrite the
      // source rawTable; require an explicit target instead.
      targetTableId:
        typeof output.targetTableId === 'string' && output.targetTableId.trim()
          ? output.targetTableId
          : writeMode === 'replace' && outputLocation === 'cloud'
            ? source.tableId
            : '',
      tableName:
        typeof output.tableName === 'string' && output.tableName.trim()
          ? output.tableName
          : `${source.tableName || source.tableId}_processed`,
      spaceId: typeof output.spaceId === 'string' ? output.spaceId : source.spaceId,
      projectId: typeof output.projectId === 'string' ? output.projectId : source.projectId,
      datasourceId:
        typeof output.datasourceId === 'string' ? output.datasourceId : source.datasourceId,
      folderId: typeof output.folderId === 'string' ? output.folderId : source.folderId,
    },
    accessModeLabel:
      typeof config.accessModeLabel === 'string' ? config.accessModeLabel : undefined,
    connectionLabel:
      typeof config.connectionLabel === 'string' ? config.connectionLabel : undefined,
  };
}

export function getCloudAutomationConfigsFromDraft(
  draft: AutomationDraft
): CloudTableAutomationConfig[] {
  return draft.actionGraph.nodes
    .map((node) => parseCloudAutomationConfig(node.config.cloudAutomation))
    .filter((config): config is CloudTableAutomationConfig => Boolean(config));
}

export function validateEnabledActionNodes(
  draft: AutomationDraft,
  tr: (key: string, fallback: string) => string
): string | null {
  const enabledNodes = draft.actionGraph.nodes.filter((node) => node.enabled !== false);
  if (enabledNodes.length === 0) {
    return tr('schedule.enabledActionRequired', '请至少启用一个动作');
  }
  for (const node of enabledNodes) {
    if (
      node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE &&
      (node.config.output as { location?: string } | undefined)?.location !== 'local'
    )
      return tr(
        'schedule.cloudSync.useOutputAction',
        '数据处理结果请保存到本地结果表，再添加写入网盘文件动作。'
      );
    if (node.type === 'cloud.sync' && !cloudSyncSchema.safeParse(node.config).success) {
      if (node.config.direction === 'input')
        return tr('schedule.cloudInput.invalid', '请选择分析空间、项目、来源表和目标原始表');
      if (node.config.direction === 'output')
        return tr('schedule.cloudSync.invalid', '请选择结果表、云空间、项目和同步目标');
      return tr('schedule.cloudSync.selectDirection', '选择同步方向');
    }
    const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
    if (cloudAutomation) {
      return tr('schedule.generatedPipelineRequired', '请先生成并确认数据加工');
    }
    if (
      node.type === 'conversation.run' &&
      !cloudAutomation &&
      !String(node.config.prompt ?? '').trim()
    ) {
      return tr('schedule.promptRequired', '请输入要执行的 Prompt');
    }
    if (node.type === 'data.pipeline.run' && !String(node.config.pipelineId ?? '').trim()) {
      return tr('schedule.dataPipelineRequired', '请选择要执行的数据加工');
    }
    if (
      node.type === CLOUD_TABLE_PROCESS_ACTION_TYPE &&
      !String(node.config.pipelineId ?? '').trim()
    ) {
      return tr('schedule.generatedPipelineRequired', '请先生成并确认数据加工');
    }
  }
  return null;
}

export function buildCloudAutomationPrompt(config: CloudTableAutomationConfig): string {
  const source = config.source;
  const sourceLocation = getSourceLocation(config);
  const outputLocation = getOutputLocation(config);
  const spacePath = [source.spaceName || source.spaceId, source.projectName || source.projectId]
    .filter(Boolean)
    .join(' / ');
  const columns =
    source.columns && source.columns.length > 0
      ? source.columns
          .slice(0, 20)
          .map((column) => (typeof column === 'string' ? column : column.name))
          .filter(Boolean)
          .join(', ')
      : '未知';

  const isLocalSource = sourceLocation === 'local';
  const isLocalOutput = outputLocation === 'local';

  const sourceLines = isLocalSource
    ? [
        '输入数据表（本地）：',
        `- 表名：${source.tableName || '（待选择）'}`,
        `- 原始表 ID：${source.tableId || '（待选择）'}`,
        typeof source.rowCount === 'number' ? `- 行数：${source.rowCount}` : '',
        `- 字段：${columns}`,
      ]
    : [
        '输入云表：',
        `- 表名：${source.tableName}`,
        `- 表 ID：${source.tableId}`,
        spacePath ? `- 空间/项目：${spacePath}` : '',
        typeof source.rowCount === 'number' ? `- 行数：${source.rowCount}` : '',
        `- 字段：${columns}`,
      ];

  const outputInstruction = isLocalOutput
    ? config.output.writeMode === 'replace'
      ? `将处理后的结果覆盖写入本地结果表 ${config.output.targetTableId || '（待填写）'}。`
      : `将处理后的结果保存为新的本地结果表，建议表名为 ${config.output.tableName || '处理结果表'}。`
    : config.output.writeMode === 'replace'
      ? `将处理后的结果表覆盖上传到云表 ${config.output.targetTableId || '（待填写）'}。`
      : `将处理后的结果表上传为新的云表，建议表名为 ${config.output.tableName || '处理结果表'}。`;
  const requirement =
    config.processRequirement.trim() ||
    (isLocalSource
      ? '请根据原始表字段与业务含义生成合理的数据清洗流程。'
      : '请根据云表字段与业务含义生成合理的数据清洗流程。');

  const sourceStep = isLocalSource
    ? '- 直接读取上述本地原始表。'
    : '- 先将上述云表导入为本地原始表。';
  const executionLines = [
    '执行要求：',
    isLocalSource && isLocalOutput
      ? '- 完成本地数据处理并产出结果表，除非遇到会破坏数据的覆盖风险。'
      : '- 自动完成数据导入、本地数据处理、结果输出，除非遇到会破坏数据的覆盖风险。',
    '- 每个关键步骤完成后说明原始表、数据加工、结果表或云表的名称与 ID。',
    '- 如果字段结构不匹配、权限不足或目标表不可覆盖，请停止并说明具体原因。',
  ];

  return [
    isLocalSource ? '请执行一个数据表自动处理流程。' : '请执行一个云空间表自动处理流程。',
    '',
    ...sourceLines,
    '',
    '处理方式：',
    sourceStep,
    '- 根据处理要求创建或更新一个数据加工，在数据加工中完成筛选、字段选择、去重、缺失值处理、汇总统计等步骤。',
    `- 处理要求：${requirement}`,
    '',
    '输出方式：',
    `- ${outputInstruction}`,
    '',
    ...executionLines,
  ]
    .filter(Boolean)
    .join('\n');
}

export function automationToDraft(automation: Automation): AutomationDraft {
  const trigger = automation.trigger as EditableAutomationTrigger;
  return {
    name: automation.name,
    outputBindings: automation.outputBindings ?? [],
    tableBindings: automation.tableBindings,
    description: automation.description ?? '',
    projectId: automation.projectId ?? '',
    enabled: automation.enabled && automation.status !== 'paused',
    permissionPolicy: 'full_access',
    triggerMode: trigger.kind,
    trigger,
    actionGraph: automation.actionGraph.nodes.length
      ? automation.actionGraph
      : createEmptyDraft(automation.name).actionGraph,
  };
}

export function draftToPayload(
  draft: AutomationDraft,
  appConfig: AppConfig | null
): AutomationCreateInput | AutomationUpdateInput {
  return {
    name: draft.name,
    outputBindings: draft.outputBindings ?? [],
    tableBindings: draft.tableBindings,
    description: draft.description || null,
    projectId: draft.projectId || null,
    enabled: draft.enabled,
    trigger: normalizeDraftTrigger(draft.triggerMode, draft.trigger),
    actionGraph: relinkLinearGraph(enrichActionGraphDefaults(draft.actionGraph, appConfig)),
  };
}

export function enrichActionGraphDefaults(
  actionGraph: AutomationActionGraph,
  appConfig: AppConfig | null
): AutomationActionGraph {
  return {
    ...actionGraph,
    nodes: actionGraph.nodes.map((node) => {
      if (node.type !== 'conversation.run') return node;
      const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
      const modelConfigSetId =
        typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
          ? node.config.modelConfigSetId
          : appConfig?.activeConfigSetId;
      const nextConfig = {
        ...node.config,
        permissionPolicy: 'full_access',
        ...(cloudAutomation ? { prompt: buildCloudAutomationPrompt(cloudAutomation) } : {}),
      };
      if (!modelConfigSetId) return { ...node, config: nextConfig };
      return {
        ...node,
        config: {
          ...nextConfig,
          modelConfigSetId,
          model: getAgentModelLabel(appConfig, '', modelConfigSetId) || node.config.model || null,
        },
      };
    }),
  };
}

export function normalizeDraftTrigger(
  mode: TriggerMode,
  trigger: EditableAutomationTrigger
): EditableAutomationTrigger {
  const timezone = trigger.timezone || SYSTEM_TIMEZONE;
  if (mode === 'manual') return { kind: 'manual', timezone };
  if (mode === 'file_change') {
    const source = trigger.kind === 'file_change' ? trigger : null;
    return {
      kind: 'file_change',
      projectId: source?.projectId ?? null,
      patterns: source?.patterns?.length ? source.patterns : ['**/*'],
      debounceMs: source?.debounceMs ?? 30_000,
      timezone,
    };
  }
  if (mode === 'interval') {
    const source = trigger.kind === 'interval' ? trigger : null;
    return {
      kind: 'interval',
      every: source?.every ?? 1,
      unit: source?.unit ?? 'day',
      startAt: source?.startAt ?? Date.now(),
      endAt: source?.endAt ?? null,
      timezone,
    };
  }
  if (mode === 'daily') {
    return {
      kind: 'daily',
      times: trigger.kind === 'daily' && trigger.times.length ? trigger.times : [DEFAULT_TIME],
      timezone,
    };
  }
  if (mode === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: trigger.kind === 'weekly' ? trigger.weekdays : [1],
      times: trigger.kind === 'weekly' && trigger.times.length ? trigger.times : [DEFAULT_TIME],
      timezone,
    };
  }
  if (mode === 'monthly') {
    const includeLastDay = trigger.kind === 'monthly' ? trigger.includeLastDay === true : false;
    return {
      kind: 'monthly',
      daysOfMonth:
        trigger.kind === 'monthly' && (trigger.daysOfMonth.length || includeLastDay)
          ? trigger.daysOfMonth
          : [1],
      includeLastDay,
      times: trigger.kind === 'monthly' && trigger.times.length ? trigger.times : [DEFAULT_TIME],
      timezone,
    };
  }
  return {
    kind: 'once',
    runAt: trigger.kind === 'once' ? trigger.runAt : Date.now() + 5 * 60 * 1000,
    timezone,
  };
}

export function relinkLinearGraph(graph: AutomationActionGraph): AutomationActionGraph {
  return {
    version: 1,
    nodes: graph.nodes,
    edges: graph.nodes.slice(1).map((node, index) => ({
      id: graph.edges[index]?.id ?? crypto.randomUUID(),
      sourceNodeId: graph.nodes[index].id,
      targetNodeId: node.id,
    })),
  };
}

export function defaultConfigForAction(type: string): Record<string, unknown> {
  if (type === 'cloud.sync') return { direction: '', spaceId: '', projectId: '' };
  if (type === 'conversation.run') {
    return {
      prompt: '',
      selectedSkillNames: [],
      projectId: '',
      modelConfigSetId: null,
      model: null,
      completionMode: 'wait',
      timeoutMs: 30 * 60 * 1000,
      collectArtifacts: true,
      permissionPolicy: 'full_access',
    };
  }
  if (type === 'data.pipeline.run') return { pipelineId: '', outputMode: 'persisted' };
  if (type === 'data.raw.preview') return { rawTableId: '', limit: 20 };
  if (type === 'data.result.preview') return { resultTableId: '', limit: 20 };
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
    return {
      pipelineId: '',
      source: null,
      output: null,
      requiredColumns: [],
      columnsSnapshot: [],
      schemaPolicy: 'required_subset',
      outputMode: 'persisted',
    };
  }
  return {};
}
