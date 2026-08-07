import { Type } from '@sinclair/typebox';
import { isAbsolute, join } from 'path';
import type {
  DataToolExecutionContext,
  DataToolPromptContext,
  DataToolDefinition,
} from './data-tool-types';
import type { DataToolService } from './data-tool-service';

const SourceKindSchema = Type.Optional(
  Type.Union([Type.Literal('excel'), Type.Literal('csv'), Type.Literal('folder')])
);

const ConfigSchema = Type.Optional(
  Type.Unsafe<Record<string, unknown>>({
    type: 'object',
    additionalProperties: true,
    description: 'Input table configuration. Use the data page config shape when known.',
  })
);

const ListSchema = Type.Object({
  query: Type.Optional(Type.String({ description: 'Search by resource name.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const PreviewRowsSchema = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));
const AgentResultPreviewRowsSchema = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: 5,
    default: 5,
    description:
      'Number of result rows returned to the conversation. Defaults to 5 and is capped at 5; use data_preview_table only when the user explicitly requests more row values.',
  })
);

const CloudConnectionProperties = {
  apiOrigin: Type.Optional(
    Type.String({
      description:
        'Personal analysis API origin. If omitted, the saved Personal Analysis setting is used.',
    })
  ),
  apiKey: Type.Optional(
    Type.String({
      description:
        'Personal analysis API key used to exchange an access token. If omitted, the saved Personal Analysis setting is used.',
    })
  ),
  accessToken: Type.Optional(
    Type.String({
      description: 'Optional Bearer token. If omitted, the tool exchanges apiKey for a token.',
    })
  ),
  connectionMode: Type.Optional(
    Type.Union([Type.Literal('account'), Type.Literal('apiKey')], {
      description:
        'Explicit credential mode. account uses the signed-in desktop account token only; apiKey uses the provided or saved API key only. If omitted, legacy fallback rules apply.',
    })
  ),
};

const CLOUD_CONNECTION_RETRY_GUIDANCE =
  ' If a previous Personal Analysis authentication or connection error appears in the conversation, do not assume it is still current after the user updates Personal Analysis settings; retry this cloud tool for the new request.';

const ProcessingStrategySchema = Type.Union([
  Type.Object({
    strategy: Type.Literal('auto'),
  }),
  Type.Object({
    strategy: Type.Literal('customize'),
    rulePrompt: Type.String({
      minLength: 1,
      description:
        'User rule prompt describing how to transform the authorized source into a standard two-dimensional table.',
    }),
    artifactId: Type.Optional(Type.String()),
    artifactName: Type.Optional(Type.String()),
    artifactDescription: Type.Optional(Type.String()),
    primaryLanguage: Type.Optional(Type.Union([Type.Literal('python'), Type.Literal('node')])),
    prepareDependencies: Type.Optional(Type.Boolean()),
  }),
  Type.String({
    description:
      'Compatibility fallback for models that accidentally serialize processingStrategy as a JSON string. Prefer passing an object.',
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
      label: 'List input tables',
      description: 'List local data input tables. Use before referencing an input table by name.',
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
      label: 'List cloud spaces',
      description:
        'List personal analysis cloud/mock spaces through the configured API. Use before selecting cloud projects.' +
        CLOUD_CONNECTION_RETRY_GUIDANCE,
      parameters: Type.Object({
        ...CloudConnectionProperties,
      }),
      execute: async (_toolCallId, params) => dataToolService.listCloudSpaces(params as never),
    },
    {
      name: 'data_list_cloud_projects',
      label: 'List cloud projects',
      description:
        'List personal analysis cloud/mock projects under a cloud space. Use before selecting cloud tables.' +
        CLOUD_CONNECTION_RETRY_GUIDANCE,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        spaceId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.listCloudProjects(params as never),
    },
    {
      name: 'data_list_cloud_tables',
      label: 'List cloud tables',
      description:
        'List personal analysis cloud/mock tables under a cloud project. Use before importing a cloud table into cowork.' +
        CLOUD_CONNECTION_RETRY_GUIDANCE,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        spaceId: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        keyword: Type.Optional(Type.String({ description: 'Search by cloud table name.' })),
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
      label: 'Import cloud table',
      description:
        'Export a personal analysis cloud/mock table as CSV, download it locally, and create a cowork input table from it.' +
        CLOUD_CONNECTION_RETRY_GUIDANCE,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        tableId: Type.String({ minLength: 1 }),
        spaceId: Type.Optional(
          Type.String({
            description:
              'Optional cloud space id. Pass with projectId to resolve the cloud table name.',
          })
        ),
        projectId: Type.Optional(
          Type.String({
            description:
              'Optional cloud project id. Pass with spaceId to resolve the cloud table name.',
          })
        ),
        name: Type.Optional(Type.String({ minLength: 1 })),
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.importCloudTable(params as never),
    },
    {
      name: 'data_upload_table_to_cloud',
      label: 'Upload table to cloud',
      description:
        'Export a cowork input/output table to CSV, upload it to personal analysis cloud/mock storage, and submit an import with CREATE or REPLACE mode. For workflow outputs, only upload after a mode=persisted run and an output-table preview confirms the final rows.' +
        CLOUD_CONNECTION_RETRY_GUIDANCE,
      parameters: Type.Object({
        ...CloudConnectionProperties,
        tableKind: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        id: Type.String({ minLength: 1 }),
        writeMode: Type.Union([Type.Literal('CREATE'), Type.Literal('REPLACE')]),
        datasourceId: Type.Optional(
          Type.String({
            description:
              'Personal analysis datasource id used for this upload. If omitted, the tool uses the only available datasource; when multiple datasources are available, ask the user to choose one.',
          })
        ),
        folderId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        spaceId: Type.Optional(Type.String()),
        tableId: Type.Optional(
          Type.String({
            description: 'Required when writeMode=REPLACE. Must be omitted for CREATE.',
          })
        ),
        tableName: Type.Optional(Type.String({ minLength: 1 })),
        fileName: Type.Optional(
          Type.String({ description: 'CSV file name sent to the upload API.' })
        ),
        maxRows: Type.Optional(Type.Integer({ minimum: 1 })),
        waitForDone: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.uploadDataTableToCloud(params as never),
    },
    {
      name: 'data_create_input_table',
      label: 'Create input table',
      description:
        'Create an input table from a user-selected or explicitly authorized local file/folder.',
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(Type.String({ description: 'Authorized local file path.' })),
        folderPath: Type.Optional(Type.String({ description: 'Authorized local folder path.' })),
        config: ConfigSchema,
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.createInputTable(resolveLocalSourcePathParams(params, context) as never),
    },
    {
      name: 'data_create_input_table_with_processing_strategy',
      label: 'Create input table with processing strategy',
      description:
        'Create an input table using an explicit data-processing strategy. Use strategy=auto for built-in import. Use strategy=customize for complex Excel/CSV/folder standardization: the app samples the source, generates a normalizer project through the configured LLM, previews it, publishes the version, then imports the input table bound to that published strategy.',
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceKind: SourceKindSchema,
        filePath: Type.Optional(Type.String({ description: 'Authorized local file path.' })),
        folderPath: Type.Optional(Type.String({ description: 'Authorized local folder path.' })),
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
      label: 'Update input table',
      description: 'Rename or re-import an existing input table.',
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
      label: 'Summarize input table source',
      description:
        'Use built-in Node readers to create a bounded structural summary for an authorized input file/folder, including Excel sheet samples and merged-cell metadata.',
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
      label: 'Generate input table normalizer draft',
      description:
        'Generate and save a draft Python or Node.js normalizer project. The app first samples the real source with built-in Node readers, asks the LLM to analyze that structure, then generates final processing code from the analysis and rule prompt.',
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
      label: 'Preview input table normalizer version',
      description:
        'Run a saved normalizer artifact version against an authorized input source and return a bounded preview of the normalized table.',
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
      label: 'Publish input table normalizer version',
      description:
        'Publish a previewed normalizer artifact version. This archives the previously published version for the same artifact.',
      parameters: Type.Object({
        versionId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.publishInputTableNormalizerVersion(params as never),
    },
    {
      name: 'data_list_input_table_normalizer_versions',
      label: 'List input table normalizer versions',
      description: 'List draft, published, and archived versions for a normalizer artifact.',
      parameters: Type.Object({
        artifactId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.listInputTableNormalizerVersions(params as never),
    },
    {
      name: 'data_list_output_tables',
      label: 'List output tables',
      description: 'List reusable output tables. Use before referencing an output table by name.',
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listOutputTables(params as never),
    },
    {
      name: 'data_create_output_table',
      label: 'Create output table',
      description:
        'Create reusable output table metadata. For workflow outputs, usually pass only name and bind it later with data_apply_workflow_dsl outputTableId. Physical data is written when a data task runs.',
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceInputTableId: Type.Optional(
          Type.String({ description: 'Optional input table id to initialize the output table.' })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.createOutputTable(params as never),
    },
    {
      name: 'data_update_output_table',
      label: 'Update output table',
      description: 'Rename an output table or refresh it from an input table.',
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        sourceInputTableId: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => dataToolService.updateOutputTable(params as never),
    },
    {
      name: 'data_preview_table',
      label: 'Preview data table',
      description:
        'Inspect a table schema, or bounded row values when the user explicitly asks to see data. Do not call this before data_analyze_task_requirement merely to discover columns; the analyzer resolves the input schema internally. Rows are omitted unless includeRows=true.',
      parameters: Type.Object({
        tableKind: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        id: Type.String({ minLength: 1 }),
        limit: PreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        includeRows: Type.Optional(
          Type.Boolean({
            default: false,
            description:
              'Set true only when the user explicitly asks to inspect row values. Defaults to schema-only output.',
          })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.previewTable(params as never),
    },
    {
      name: 'data_list_tasks',
      label: 'List data tasks',
      description: 'List reusable data tasks. Use before referencing a task by name.',
      parameters: ListSchema,
      execute: async (_toolCallId, params) => dataToolService.listTasks(params as never),
    },
    {
      name: 'data_analyze_task_requirement',
      label: 'Analyze data task requirement',
      description:
        'Analyze a natural-language requirement against the registered single-input data-task capabilities. Always call this before generating a task. Show the result to the user and wait for a new user message with explicit confirmation. Ambiguous or unsupported requirements must be revised and analyzed again.',
      parameters: Type.Object(
        {
          inputTableId: Type.String({
            minLength: 1,
            description: 'Existing input table id returned by data_list_input_tables.',
          }),
          processRequirement: Type.String({
            minLength: 1,
            maxLength: 10_000,
            description: 'The user requirement exactly as agreed so far.',
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
      label: 'Generate data task from requirement',
      description:
        'Generate, compile, temporarily execute, validate, and save a reusable native-node data task from a supported analysis receipt. Call only after showing the analysis to the user and receiving explicit confirmation in a new user message. Pass outputMode, outputTableName, and outputTableId as flat fields; never serialize nested JSON into a string. Never provide or generate workflow DSL.',
      parameters: Type.Object(
        {
          analysisId: Type.String({
            minLength: 1,
            description: 'Opaque id returned by data_analyze_task_requirement.',
          }),
          confirmed: Type.Literal(true, {
            description: 'Pass true only after the user explicitly confirms the analysis.',
          }),
          taskName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          outputMode: Type.Union([Type.Literal('create'), Type.Literal('replace')], {
            description:
              'Use create for a new output table or replace for an existing output table selected by the user.',
          }),
          outputTableName: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 200,
              description: 'New output table name. Use only when outputMode=create.',
            })
          ),
          outputTableId: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                'Existing output table id explicitly selected by the user. Required when outputMode=replace.',
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
      label: 'Update data task',
      description: 'Rename an existing data task.',
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params) => dataToolService.updateTask(params as never),
    },
    {
      name: 'data_get_task_workflow',
      label: 'Get task workflow',
      description: 'Read the saved workflow nodes and edges for a data task.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.getTaskWorkflow(params as never),
    },
    {
      name: 'data_export_workflow_dsl',
      label: 'Export workflow DSL',
      description: 'Export a data task workflow back to DSL.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => dataToolService.exportWorkflowDsl(params as never),
    },
    {
      name: 'data_run_task',
      label: 'Run data task',
      description:
        'Run a saved data task. mode=temporary only validates a preview and does not update reusable output tables; mode=persisted writes formal outputs.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        mode: Type.Optional(Type.Union([Type.Literal('temporary'), Type.Literal('persisted')])),
        previewRows: AgentResultPreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.runTask(params as never),
    },
    {
      name: 'data_get_run_result',
      label: 'Get run result',
      description: 'Read the latest bounded preview for a completed data task.',
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
