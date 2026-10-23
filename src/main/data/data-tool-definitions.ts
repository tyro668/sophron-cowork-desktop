import { Type } from 'typebox';
import { isAbsolute, join } from 'path';
import type {
  DataToolExecutionContext,
  DataToolPromptContext,
  DataToolDefinition,
} from './data-tool-types';
import type { DataToolService } from './data-tool-service';
import { DATA_TOOL_COPY, TOOL_SCHEMA_COPY } from '../prompts/tool-copy';

const SourceKindSchema = Type.Optional(
  Type.Union([
    Type.Literal('excel'),
    Type.Literal('csv'),
    Type.Literal('folder'),
    Type.Literal('cloud'),
  ])
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

import { AGENT_RESULT_PREVIEW_MAX_ROWS } from './data-tool-preview-format';
const PreviewRowsSchema = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));
const AgentResultPreviewRowsSchema = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: AGENT_RESULT_PREVIEW_MAX_ROWS,
    default: AGENT_RESULT_PREVIEW_MAX_ROWS,
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

/** Publish activity only on real model deltas; never expose internal reasoning
 * or manufacture heartbeat events while the provider is idle. */
function modelActivityUpdates(onUpdate: Parameters<DataToolDefinition['execute']>[3]): () => void {
  let lastSent: number | undefined;
  return () => {
    const now = Date.now();
    if (lastSent !== undefined && now - lastSent < 1_000) return;
    lastSent = now;
    onUpdate?.({ content: [], details: { activity: 'model' } });
  };
}

export function createDataCustomTools(
  dataToolService: DataToolService,
  context?: DataToolPromptContext,
  executionContext?: DataToolExecutionContext
): DataToolDefinition[] {
  const rememberResources = (tool: DataToolDefinition): DataToolDefinition => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      dataToolService.rememberResolvedResources(
        executionContext?.sessionId ?? context?.sessionId,
        tool.name,
        params,
        (result as { details?: unknown } | undefined)?.details
      );
      return result;
    },
  });
  const toolDefinitions: DataToolDefinition[] = [
    {
      name: 'data_list_raw_tables',
      ...DATA_TOOL_COPY.data_list_raw_tables,
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
      execute: async (_toolCallId, params) => dataToolService.listRawTables(params as never),
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
        rawTableId: Type.Optional(Type.String({ minLength: 1 })),
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
      execute: async (_toolCallId, params) => dataToolService.importCloudRawTable(params as never),
    },
    {
      name: 'data_upload_table_to_cloud',
      ...DATA_TOOL_COPY.data_upload_table_to_cloud,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        tableKind: Type.Union([Type.Literal('raw'), Type.Literal('result')]),
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
      name: 'data_create_raw_table',
      ...DATA_TOOL_COPY.data_create_raw_table,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFilePath })
        ),
        folderPath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFolderPath })
        ),
        sheetName: Type.Optional(
          Type.String({ minLength: 1, description: TOOL_SCHEMA_COPY.data.sheetName })
        ),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.createRawTable(resolveLocalSourcePathParams(params, context) as never),
    },
    {
      name: 'data_create_raw_table_with_processing_strategy',
      ...DATA_TOOL_COPY.data_create_raw_table_with_processing_strategy,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFilePath })
        ),
        folderPath: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.authorizedFolderPath })
        ),
        sheetName: Type.Optional(
          Type.String({ minLength: 1, description: TOOL_SCHEMA_COPY.data.sheetName })
        ),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
        processingStrategy: ProcessingStrategySchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.createRawTableWithProcessingStrategy(
          normalizeProcessingStrategyParams(resolveLocalSourcePathParams(params, context)) as never
        ),
    },
    {
      name: 'data_update_raw_table',
      ...DATA_TOOL_COPY.data_update_raw_table,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(Type.String()),
        folderPath: Type.Optional(Type.String()),
        sheetName: Type.Optional(
          Type.String({ minLength: 1, description: TOOL_SCHEMA_COPY.data.sheetName })
        ),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.updateRawTable(resolveLocalSourcePathParams(params, context) as never),
    },
    {
      name: 'data_delete_raw_table',
      ...DATA_TOOL_COPY.data_delete_raw_table,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        reason: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.data.deleteReason })),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.deleteRawTableCreatedInSession(
          executionContext?.sessionId ?? context?.sessionId,
          params as { id: string; reason?: string }
        ),
    },
    {
      name: 'data_summarize_raw_table_source',
      ...DATA_TOOL_COPY.data_summarize_raw_table_source,
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
        dataToolService.summarizeRawTableSource(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_generate_raw_table_normalizer_draft',
      ...DATA_TOOL_COPY.data_generate_raw_table_normalizer_draft,
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
        dataToolService.generateRawTableNormalizerDraft(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_preview_raw_table_normalizer_version',
      ...DATA_TOOL_COPY.data_preview_raw_table_normalizer_version,
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
        dataToolService.previewRawTableNormalizerVersion(
          resolveLocalSourcePathParams(params, context) as never
        ),
    },
    {
      name: 'data_publish_raw_table_normalizer_version',
      ...DATA_TOOL_COPY.data_publish_raw_table_normalizer_version,
      parameters: Type.Object({
        versionId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.publishRawTableNormalizerVersion(params as never),
    },
    {
      name: 'data_list_raw_table_normalizer_versions',
      ...DATA_TOOL_COPY.data_list_raw_table_normalizer_versions,
      parameters: Type.Object({
        artifactId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.listRawTableNormalizerVersions(params as never),
    },
    {
      name: 'data_list_result_tables',
      ...DATA_TOOL_COPY.data_list_result_tables,
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listResultTables(params as never),
    },
    {
      name: 'data_create_result_table',
      ...DATA_TOOL_COPY.data_create_result_table,
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceRawTableId: Type.Optional(
          Type.String({ description: TOOL_SCHEMA_COPY.data.sourceRawTableId })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.createResultTable(params as never),
    },
    {
      name: 'data_update_result_table',
      ...DATA_TOOL_COPY.data_update_result_table,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceRawTableId: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => dataToolService.updateResultTable(params as never),
    },
    {
      name: 'data_preview_table',
      ...DATA_TOOL_COPY.data_preview_table,
      parameters: Type.Object({
        tableKind: Type.Union([Type.Literal('raw'), Type.Literal('result')]),
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
      name: 'data_list_pipelines',
      ...DATA_TOOL_COPY.data_list_pipelines,
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listPipelines(params as never),
    },
    {
      name: 'data_analyze_pipeline_requirement',
      ...DATA_TOOL_COPY.data_analyze_pipeline_requirement,
      parameters: Type.Object(
        {
          rawTableId: Type.String({
            minLength: 1,
            description: TOOL_SCHEMA_COPY.data.requirementRawTableId,
          }),
          processRequirement: Type.String({
            minLength: 1,
            maxLength: 10_000,
            description: TOOL_SCHEMA_COPY.data.processRequirement,
          }),
          reusePipelineId: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                'Existing pipeline to edit; generation updates this pipeline after confirmation.',
            })
          ),
          startFromNodeId: Type.Optional(
            Type.String({
              minLength: 1,
              description: 'Continue after this saved workflow node. Requires reusePipelineId.',
            })
          ),
        },
        { additionalProperties: false }
      ),
      execute: async (toolCallId, params, signal, onUpdate) =>
        dataToolService.analyzePipelineRequirement(params as never, {
          ...(executionContext
            ? { ...executionContext, toolCallId, signal }
            : dataToolService.resolveExecutionContext(
                context?.sessionId ?? '',
                toolCallId,
                signal
              )),
          onActivity: modelActivityUpdates(onUpdate),
        }),
    },
    {
      name: 'data_generate_pipeline_from_requirement',
      ...DATA_TOOL_COPY.data_generate_pipeline_from_requirement,
      parameters: Type.Object(
        {
          analysisId: Type.String({
            minLength: 1,
            description: TOOL_SCHEMA_COPY.data.analysisId,
          }),
          confirmed: Type.Literal(true, {
            description: TOOL_SCHEMA_COPY.data.analysisConfirmed,
          }),
          pipelineName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          outputMode: Type.Union([Type.Literal('create'), Type.Literal('replace')], {
            description: TOOL_SCHEMA_COPY.data.outputMode,
          }),
          resultTableName: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 200,
              description: TOOL_SCHEMA_COPY.data.resultTableName,
            })
          ),
          resultTableId: Type.Optional(
            Type.String({
              minLength: 1,
              description: TOOL_SCHEMA_COPY.data.resultTableId,
            })
          ),
        },
        { additionalProperties: false }
      ),
      execute: async (toolCallId, params, signal, onUpdate) =>
        dataToolService.generatePipelineFromAnalysis(params as never, {
          ...(executionContext
            ? { ...executionContext, toolCallId, signal }
            : dataToolService.resolveExecutionContext(
                context?.sessionId ?? '',
                toolCallId,
                signal
              )),
          onActivity: modelActivityUpdates(onUpdate),
        }),
    },
    {
      name: 'data_create_pipeline',
      ...DATA_TOOL_COPY.data_create_pipeline,
      parameters: Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 200 }),
          sourceRawTableId: Type.Optional(Type.String({ minLength: 1 })),
          resultTableId: Type.Optional(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false }
      ),
      execute: async (_toolCallId, params) => dataToolService.createPipeline(params as never),
    },
    {
      name: 'data_update_pipeline',
      ...DATA_TOOL_COPY.data_update_pipeline,
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params) => dataToolService.updatePipeline(params as never),
    },
    {
      name: 'data_get_pipeline_workflow',
      ...DATA_TOOL_COPY.data_get_pipeline_workflow,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        view: Type.Optional(
          Type.Union([Type.Literal('summary'), Type.Literal('graph'), Type.Literal('node')], {
            description:
              'summary (default): pipeline meta + node types. graph: full editable node configs and edges. node: one node config + touching edges (requires nodeId).',
          })
        ),
        nodeId: Type.Optional(
          Type.String({ minLength: 1, description: 'Required when view="node"' })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.getPipelineWorkflow(params as never),
    },
    {
      name: 'data_get_workflow_dsl_reference',
      ...DATA_TOOL_COPY.data_get_workflow_dsl_reference,
      parameters: Type.Object({
        topic: Type.Optional(
          Type.Union([
            Type.Literal('overview'),
            Type.Literal('workflow'),
            Type.Literal('operators'),
            Type.Literal('derive_window'),
            Type.Literal('reshape'),
            Type.Literal('examples'),
            Type.Literal('all'),
          ])
        ),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.getWorkflowDslReference(params as never),
    },
    {
      name: 'data_get_workflow_capability_manifest',
      ...DATA_TOOL_COPY.data_get_workflow_capability_manifest,
      parameters: Type.Object({
        rawTableIds: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description: 'Input table ids to include real column snapshots for',
          })
        ),
        resultTableIds: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description: 'Output table ids to include real column snapshots for',
          })
        ),
        operatorTypes: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description:
              'Operator types whose config JSON Schemas to include (e.g. ["join","aggregate"]). Requires the operators section.',
          })
        ),
        sections: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal('plan'),
              Type.Literal('operators'),
              Type.Literal('runtime'),
              Type.Literal('bindings'),
            ]),
            {
              description:
                'Manifest sections to return. Default: plan+runtime+bindings without per-operator schemas.',
            }
          )
        ),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.getWorkflowCapabilityManifest(params as never),
    },
    {
      name: 'data_apply_workflow_plan',
      ...DATA_TOOL_COPY.data_apply_workflow_plan,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        plan: Type.Unsafe<Record<string, unknown>>({
          type: 'object',
          description:
            'Constrained plan {version: "workflow-plan/v1", nodes, edges}; node configs must satisfy the per-type schemas from data_get_workflow_capability_manifest',
        }),
        inputResources: Type.Optional(
          Type.Unsafe<Record<string, string>>({
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'alias -> rawTableId binding for each input node',
          })
        ),
        resultTableId: Type.Optional(
          Type.String({ description: 'Real output table id binding the first output sink' })
        ),
        dryRun: Type.Optional(
          Type.Boolean({ description: 'Validate only; do not save the workflow' })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.applyWorkflowPlan(params as never),
    },
    {
      name: 'data_apply_workflow_dsl',
      ...DATA_TOOL_COPY.data_apply_workflow_dsl,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        dsl: Type.String({ minLength: 1 }),
        rawTableId: Type.Optional(
          Type.String({ description: 'Single-source binding: first (or inputAlias) input node' })
        ),
        inputAlias: Type.Optional(Type.String()),
        inputResources: Type.Optional(
          Type.Unsafe<Record<string, string>>({
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'alias -> rawTableId binding for multi-source workflows',
          })
        ),
        resultTableId: Type.Optional(
          Type.String({ description: 'Real output table id binding the first output sink' })
        ),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => dataToolService.applyWorkflowDsl(params as never),
    },
    {
      name: 'data_configure_input_operator',
      ...DATA_TOOL_COPY.data_configure_input_operator,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        rawTableId: Type.String({ minLength: 1 }),
        alias: Type.Optional(Type.String()),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.configureInputOperator(params as never),
    },
    {
      name: 'data_configure_output_operator',
      ...DATA_TOOL_COPY.data_configure_output_operator,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        resultTableId: Type.Optional(Type.String()),
        resultTableName: Type.Optional(Type.String()),
        outputStrategy: Type.Optional(Type.Union([Type.Literal('existing'), Type.Literal('auto')])),
        mode: Type.Optional(
          Type.Union([
            Type.Literal('replace'),
            Type.Literal('append'),
            Type.Literal('error_if_exists'),
            Type.Literal('merge'),
          ])
        ),
        mergeKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        schemaPolicy: Type.Optional(
          Type.Union([Type.Literal('extend'), Type.Literal('strict'), Type.Literal('ignore')])
        ),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.configureOutputOperator(params as never),
    },
    {
      name: 'data_apply_operator_dsl',
      ...DATA_TOOL_COPY.data_apply_operator_dsl,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        operatorType: Type.Optional(Type.String()),
        dsl: Type.String({ minLength: 1 }),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => dataToolService.applyOperatorDsl(params as never),
    },
    {
      name: 'data_export_workflow_dsl',
      ...DATA_TOOL_COPY.data_export_workflow_dsl,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.exportWorkflowDsl(params as never),
    },
    {
      name: 'data_run_pipeline',
      ...DATA_TOOL_COPY.data_run_pipeline,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        mode: Type.Optional(Type.Union([Type.Literal('temporary'), Type.Literal('persisted')])),
        workflowDsl: Type.Optional(
          Type.String({ description: 'One-off DSL override for this run (not saved)' })
        ),
        saveWorkflow: Type.Optional(
          Type.Boolean({ description: 'Persist the workflowDsl override after a successful run' })
        ),
        inputResources: Type.Optional(
          Type.Unsafe<Record<string, string>>({
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'alias -> rawTableId binding applied to the workflowDsl override',
          })
        ),
        rawTableId: Type.Optional(Type.String()),
        inputAlias: Type.Optional(Type.String()),
        resultTableId: Type.Optional(Type.String()),
        previewRows: AgentResultPreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.runPipeline(params as never),
    },
    {
      name: 'data_get_run_result',
      ...DATA_TOOL_COPY.data_get_run_result,
      parameters: Type.Object({
        pipelineId: Type.String({ minLength: 1 }),
        previewRows: AgentResultPreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      execute: async (_toolCallId, params) => dataToolService.getRunResult(params as never),
    },
  ];
  return toolDefinitions.map(rememberResources);
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
