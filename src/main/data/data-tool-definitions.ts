import { Type } from '@sinclair/typebox';
import { isAbsolute, join } from 'path';
import type {
  DataToolExecutionContext,
  DataToolPromptContext,
  DataToolDefinition,
} from './data-tool-types';
import type { DataToolService } from './data-tool-service';
import { DATA_TOOL_COPY, TOOL_SCHEMA_COPY } from '../prompts/tool-copy';

const SourceKindSchema = Type.Optional(
  Type.Union([Type.Literal('excel'), Type.Literal('csv'), Type.Literal('folder')])
);

const ConfigSchema = Type.Optional(
  Type.Unsafe<Record<string, unknown>>({
    type: 'object',
    additionalProperties: true,
    description: TOOL_SCHEMA_COPY.data.inputConfig,
  })
);

const ListSchema = Type.Object({
  query: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.data.resourceQuery })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const PreviewRowsSchema = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));
const AgentResultPreviewRowsSchema = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: 5,
    default: 5,
    description: TOOL_SCHEMA_COPY.data.resultPreviewRows,
  })
);

const CloudConnectionProperties = {
  apiOrigin: Type.Optional(
    Type.String({
      description: TOOL_SCHEMA_COPY.data.apiOrigin,
    })
  ),
  apiKey: Type.Optional(
    Type.String({
      description: TOOL_SCHEMA_COPY.data.apiKey,
    })
  ),
  accessToken: Type.Optional(
    Type.String({
      description: TOOL_SCHEMA_COPY.data.accessToken,
    })
  ),
  connectionMode: Type.Optional(
    Type.Union([Type.Literal('account'), Type.Literal('apiKey')], {
      description: TOOL_SCHEMA_COPY.data.connectionMode,
    })
  ),
};

const ProcessingStrategySchema = Type.Union([
  Type.Object({
    strategy: Type.Literal('auto'),
  }),
  Type.Object({
    strategy: Type.Literal('customize'),
    rulePrompt: Type.String({
      minLength: 1,
      description: TOOL_SCHEMA_COPY.data.normalizerRule,
    }),
    artifactId: Type.Optional(Type.String()),
    artifactName: Type.Optional(Type.String()),
    artifactDescription: Type.Optional(Type.String()),
    primaryLanguage: Type.Optional(Type.Union([Type.Literal('python'), Type.Literal('node')])),
    prepareDependencies: Type.Optional(Type.Boolean()),
  }),
  Type.String({
    description: TOOL_SCHEMA_COPY.data.serializedProcessingStrategy,
  }),
]);

export function createDataCustomTools(
  dataToolService: DataToolService,
  context?: DataToolPromptContext,
  executionContext?: DataToolExecutionContext
): DataToolDefinition[] {
  return [
    {
      name: 'data_list_input_tables',
      ...DATA_TOOL_COPY.data_list_input_tables,
      parameters: Type.Object({
        ...ListSchema.properties,
        sourceKind: Type.Optional(
          Type.Union([
            Type.Literal('all'),
            Type.Literal('excel'),
            Type.Literal('csv'),
            Type.Literal('folder'),
          ])
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.listInputTables(params as never),
    },
    {
      name: 'data_list_cloud_spaces',
      ...DATA_TOOL_COPY.data_list_cloud_spaces,
      parameters: Type.Object({
        ...CloudConnectionProperties,
      }),
      execute: async (_toolCallId, params) => dataToolService.listCloudSpaces(params as never),
    },
    {
      name: 'data_list_cloud_projects',
      ...DATA_TOOL_COPY.data_list_cloud_projects,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        spaceId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.listCloudProjects(params as never),
    },
    {
      name: 'data_list_cloud_tables',
      ...DATA_TOOL_COPY.data_list_cloud_tables,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        spaceId: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        keyword: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.data.cloudTableQuery })),
        page: Type.Optional(Type.Integer({ minimum: 1 })),
        pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        sortBy: Type.Optional(
          Type.Union([
            Type.Literal('tableName'),
            Type.Literal('updatedAt'),
            Type.Literal('rowCount'),
          ])
        ),
        sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
      }),
      execute: async (_toolCallId, params) => dataToolService.listCloudTables(params as never),
    },
    {
      name: 'data_import_cloud_table',
      ...DATA_TOOL_COPY.data_import_cloud_table,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        tableId: Type.String({ minLength: 1 }),
        spaceId: Type.Optional(
          Type.String({
            description: TOOL_SCHEMA_COPY.data.cloudSpaceId,
          })
        ),
        projectId: Type.Optional(
          Type.String({
            description: TOOL_SCHEMA_COPY.data.cloudProjectId,
          })
        ),
        name: Type.Optional(Type.String({ minLength: 1 })),
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.importCloudTable(params as never),
    },
    {
      name: 'data_upload_table_to_cloud',
      ...DATA_TOOL_COPY.data_upload_table_to_cloud,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        tableKind: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        id: Type.String({ minLength: 1 }),
        writeMode: Type.Union([Type.Literal('CREATE'), Type.Literal('REPLACE')]),
        datasourceId: Type.Optional(
          Type.String({
            description: TOOL_SCHEMA_COPY.data.datasourceId,
          })
        ),
        folderId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        spaceId: Type.Optional(Type.String()),
        tableId: Type.Optional(
          Type.String({
            description: TOOL_SCHEMA_COPY.data.replaceTableId,
          })
        ),
        tableName: Type.Optional(Type.String({ minLength: 1 })),
        fileName: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.data.uploadFileName })),
        maxRows: Type.Optional(Type.Integer({ minimum: 1 })),
        waitForDone: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.uploadDataTableToCloud(params as never),
    },
    {
      name: 'data_create_input_table',
      ...DATA_TOOL_COPY.data_create_input_table,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFilePath })
        ),
        folderPath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFolderPath })
        ),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.createInputTable(resolveLocalSourcePathParams(params, context) as never),
    },
    {
      name: 'data_create_input_table_with_processing_strategy',
      ...DATA_TOOL_COPY.data_create_input_table_with_processing_strategy,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFilePath })
        ),
        folderPath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFolderPath })
        ),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
        processingStrategy: ProcessingStrategySchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.createInputTableWithProcessingStrategy(
          normalizeProcessingStrategyParams(resolveLocalSourcePathParams(params, context)) as never
        ),
    },
    {
      name: 'data_update_input_table',
      ...DATA_TOOL_COPY.data_update_input_table,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(Type.String()),
        folderPath: Type.Optional(Type.String()),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.updateInputTable(resolveLocalSourcePathParams(params, context) as never),
    },
    {
      name: 'data_summarize_input_table_source',
      ...DATA_TOOL_COPY.data_summarize_input_table_source,
      parameters: Type.Object({
        sourcePath: Type.String({ minLength: 1 }),
        sourceKind: SourceKindSchema,
        config: ConfigSchema,
        maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        maxSheetsPerFile: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
        maxRowsPerSheet: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        maxColumnsPerRow: Type.Optional(Type.Integer({ minimum: 1, maximum: 80 })),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.summarizeInputTableSource(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_generate_input_table_normalizer_draft',
      ...DATA_TOOL_COPY.data_generate_input_table_normalizer_draft,
      parameters: Type.Object({
        artifactId: Type.Optional(Type.String()),
        name: Type.String({ minLength: 1 }),
        description: Type.Optional(Type.String()),
        sourcePath: Type.String({ minLength: 1 }),
        sourceKind: SourceKindSchema,
        config: ConfigSchema,
        rulePrompt: Type.String({ minLength: 1 }),
        primaryLanguage: Type.Optional(Type.Union([Type.Literal('python'), Type.Literal('node')])),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.generateInputTableNormalizerDraft(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_preview_input_table_normalizer_version',
      ...DATA_TOOL_COPY.data_preview_input_table_normalizer_version,
      parameters: Type.Object({
        versionId: Type.String({ minLength: 1 }),
        sourcePath: Type.String({ minLength: 1 }),
        sourceKind: SourceKindSchema,
        config: ConfigSchema,
        prepareDependencies: Type.Optional(Type.Boolean()),
        limit: PreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.previewInputTableNormalizerVersion(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_publish_input_table_normalizer_version',
      ...DATA_TOOL_COPY.data_publish_input_table_normalizer_version,
      parameters: Type.Object({
        versionId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.publishInputTableNormalizerVersion(params as never),
    },
    {
      name: 'data_list_input_table_normalizer_versions',
      ...DATA_TOOL_COPY.data_list_input_table_normalizer_versions,
      parameters: Type.Object({
        artifactId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.listInputTableNormalizerVersions(params as never),
    },
    {
      name: 'data_list_output_tables',
      ...DATA_TOOL_COPY.data_list_output_tables,
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listOutputTables(params as never),
    },
    {
      name: 'data_create_output_table',
      ...DATA_TOOL_COPY.data_create_output_table,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceInputTableId: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.sourceInputTableId })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.createOutputTable(params as never),
    },
    {
      name: 'data_update_output_table',
      ...DATA_TOOL_COPY.data_update_output_table,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceInputTableId: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => dataToolService.updateOutputTable(params as never),
    },
    {
      name: 'data_preview_table',
      ...DATA_TOOL_COPY.data_preview_table,
      parameters: Type.Object({
        tableKind: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        id: Type.String({ minLength: 1 }),
        limit: PreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        includeRows: Type.Optional(
          Type.Boolean({
            default: false,
            description: TOOL_SCHEMA_COPY.data.includeRows,
          })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.previewTable(params as never),
    },
    {
      name: 'data_list_tasks',
      ...DATA_TOOL_COPY.data_list_tasks,
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listTasks(params as never),
    },
    {
      name: 'data_analyze_task_requirement',
      ...DATA_TOOL_COPY.data_analyze_task_requirement,
      parameters: Type.Object(
        {
          inputTableId: Type.String({
            minLength: 1,
            description: TOOL_SCHEMA_COPY.data.requirementInputTableId,
          }),
          processRequirement: Type.String({
            minLength: 1,
            maxLength: 10_000,
            description: TOOL_SCHEMA_COPY.data.processRequirement,
          }),
        },
        { additionalProperties: false }
      ),
      execute: async (toolCallId, params, signal) =>
        dataToolService.analyzeTaskRequirement(
          params as never,
          executionContext
            ? { ...executionContext, toolCallId, signal }
            : dataToolService.resolveExecutionContext(context?.sessionId ?? '', toolCallId, signal)
        ),
    },
    {
      name: 'data_generate_task_from_requirement',
      ...DATA_TOOL_COPY.data_generate_task_from_requirement,
      parameters: Type.Object(
        {
          analysisId: Type.String({
            minLength: 1,
            description: TOOL_SCHEMA_COPY.data.analysisId,
          }),
          confirmed: Type.Literal(true, {
            description: TOOL_SCHEMA_COPY.data.analysisConfirmed,
          }),
          taskName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          outputMode: Type.Union([Type.Literal('create'), Type.Literal('replace')], {
            description: TOOL_SCHEMA_COPY.data.outputMode,
          }),
          outputTableName: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 200,
              description: TOOL_SCHEMA_COPY.data.outputTableName,
            })
          ),
          outputTableId: Type.Optional(
            Type.String({
              minLength: 1,
              description: TOOL_SCHEMA_COPY.data.outputTableId,
            })
          ),
        },
        { additionalProperties: false }
      ),
      execute: async (toolCallId, params, signal) =>
        dataToolService.generateTaskFromAnalysis(
          params as never,
          executionContext
            ? { ...executionContext, toolCallId, signal }
            : dataToolService.resolveExecutionContext(context?.sessionId ?? '', toolCallId, signal)
        ),
    },
    {
      name: 'data_update_task',
      ...DATA_TOOL_COPY.data_update_task,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params) => dataToolService.updateTask(params as never),
    },
    {
      name: 'data_get_task_workflow',
      ...DATA_TOOL_COPY.data_get_task_workflow,
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.getTaskWorkflow(params as never),
    },
    {
      name: 'data_export_workflow_dsl',
      ...DATA_TOOL_COPY.data_export_workflow_dsl,
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.exportWorkflowDsl(params as never),
    },
    {
      name: 'data_run_task',
      ...DATA_TOOL_COPY.data_run_task,
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        mode: Type.Optional(Type.Union([Type.Literal('temporary'), Type.Literal('persisted')])),
        previewRows: AgentResultPreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.runTask(params as never),
    },
    {
      name: 'data_get_run_result',
      ...DATA_TOOL_COPY.data_get_run_result,
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        previewRows: AgentResultPreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      execute: async (_toolCallId, params) => dataToolService.getRunResult(params as never),
    },
  ];
}

function resolveLocalSourcePathParams(
  params: unknown,
  context: DataToolPromptContext | undefined
): unknown {
  if (!params || typeof params !== 'object') {
    return params;
  }
  const record = { ...(params as Record<string, unknown>) };
  for (const key of ['filePath', 'folderPath', 'sourcePath'] as const) {
    if (typeof record[key] === 'string') {
      record[key] = resolveWorkspaceRelativePath(record[key], context?.workspacePath);
    }
  }
  return record;
}

function resolveWorkspaceRelativePath(value: string, workspacePath: string | undefined): string {
  const trimmed = value.trim();
  if (!trimmed || isAbsolute(trimmed) || !workspacePath?.trim()) {
    return trimmed;
  }
  return join(workspacePath.trim(), trimmed);
}

function normalizeProcessingStrategyParams(params: unknown): unknown {
  if (!params || typeof params !== 'object') {
    return params;
  }
  const record = { ...(params as Record<string, unknown>) };
  if (typeof record.processingStrategy === 'string') {
    try {
      record.processingStrategy = JSON.parse(record.processingStrategy);
    } catch {
      throw new Error('processingStrategy must be an object or a valid JSON object string');
    }
  }
  return record;
}
