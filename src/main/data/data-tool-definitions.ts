import { Type } from '@sinclair/typebox';
import { isAbsolute, join } from 'path';
import type { DataToolPromptContext, DataToolDefinition } from './data-tool-types';
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
  context?: DataToolPromptContext
): DataToolDefinition[] {
  return [
    {
      name: 'data_get_workflow_dsl_reference',
      label: 'Get workflow DSL reference',
      description:
        'Read the embedded workflow DSL reference. Use this instead of reading source-tree design docs, because packaged apps may not include source docs.',
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
        keyword: Type.Optional(Type.String({ description: 'Search by cloud table name or id.' })),
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
        'Export a cowork input/output table to CSV, upload it to personal analysis cloud/mock storage, and submit an import with CREATE or REPLACE mode.' +
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
        maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
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
      description: 'Preview a bounded number of rows from an input or output table.',
      parameters: Type.Object({
        tableKind: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        id: Type.String({ minLength: 1 }),
        limit: PreviewRowsSchema,
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
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
      name: 'data_create_task',
      label: 'Create data task',
      description: 'Create a reusable data processing task.',
      parameters: Type.Object({
        name: Type.String({ minLength: 1 }),
        sourcePath: Type.Optional(
          Type.String({ description: 'Optional authorized local source file path.' })
        ),
        sourceInputTableId: Type.Optional(
          Type.String({
            description:
              'Optional input table id this task will read from. Pass this when creating a task for a known input table.',
          })
        ),
        outputTableId: Type.Optional(
          Type.String({
            description:
              'Optional output table id this task will write to. Pass this when creating a task for a known output table.',
          })
        ),
      }),
      execute: async (_toolCallId, params) => dataToolService.createTask(params as never),
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
      name: 'data_apply_workflow_dsl',
      label: 'Apply workflow DSL',
      description:
        'Validate or save a full reusable data workflow text DSL to a data task. Do not pass JSON nodes/edges. Use dryRun first. Pass inputTableId/outputTableId to bind resources without guessing node IDs.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        dsl: Type.String({
          minLength: 1,
          description:
            'Text prep DSL, for example: input source dataset "<inputTableId>" as src\\n  | derive [new_field] = expression\\n  | output table "Result" mode replace. Do not pass JSON.',
        }),
        inputTableId: Type.Optional(
          Type.String({
            description:
              'Optional input table id to bind the first input_source node. Prefer this when a task reads a created input table.',
          })
        ),
        inputAlias: Type.Optional(
          Type.String({
            description: 'Optional alias for inputTableId binding, for example src.',
          })
        ),
        outputTableId: Type.Optional(
          Type.String({
            description:
              'Optional output table id to bind the output node. Prefer this when writing to a reusable output table.',
          })
        ),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => dataToolService.applyWorkflowDsl(params as never),
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
      name: 'data_configure_input_operator',
      label: 'Configure input operator',
      description: 'Bind an input_source workflow node to a real input table id.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        inputTableId: Type.String({ minLength: 1 }),
        alias: Type.Optional(Type.String()),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.configureInputOperator(params as never),
    },
    {
      name: 'data_apply_operator_dsl',
      label: 'Apply operator DSL',
      description:
        'Validate or save a single non-input/non-output operator DSL for an existing workflow node.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        operatorType: Type.Optional(
          Type.Union([
            Type.Literal('filter'),
            Type.Literal('field_select'),
            Type.Literal('deduplicate'),
            Type.Literal('missing_value'),
            Type.Literal('type_convert'),
            Type.Literal('sort'),
            Type.Literal('join'),
            Type.Literal('aggregate'),
            Type.Literal('calculate_field'),
            Type.Literal('field_mapping'),
            Type.Literal('limit'),
            Type.Literal('pivot'),
            Type.Literal('unpivot'),
            Type.Literal('set_op'),
            Type.Literal('unnest'),
          ])
        ),
        dsl: Type.String({ minLength: 1 }),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => dataToolService.applyOperatorDsl(params as never),
    },
    {
      name: 'data_configure_output_operator',
      label: 'Configure output operator',
      description: 'Bind an output workflow node to an output table or auto output name.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        nodeId: Type.String({ minLength: 1 }),
        outputTableId: Type.Optional(Type.String()),
        outputTableName: Type.Optional(Type.String()),
        outputStrategy: Type.Optional(Type.Union([Type.Literal('existing'), Type.Literal('auto')])),
        mode: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('append')])),
        dryRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) =>
        dataToolService.configureOutputOperator(params as never),
    },
    {
      name: 'data_run_task',
      label: 'Run data task',
      description:
        'Run a data task. Use mode=temporary for validation before mode=persisted writes formal outputs. If workflowDsl is provided, inputTableId/outputTableId can bind resources without guessing node IDs.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        mode: Type.Optional(Type.Union([Type.Literal('temporary'), Type.Literal('persisted')])),
        workflowDsl: Type.Optional(Type.String()),
        saveWorkflow: Type.Optional(Type.Boolean()),
        inputTableId: Type.Optional(Type.String()),
        inputAlias: Type.Optional(Type.String()),
        outputTableId: Type.Optional(Type.String()),
        previewRows: PreviewRowsSchema,
      }),
      execute: async (_toolCallId, params) => dataToolService.runTask(params as never),
    },
    {
      name: 'data_get_run_result',
      label: 'Get run result',
      description: 'Read the latest bounded preview for a completed data task.',
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1 }),
        previewRows: PreviewRowsSchema,
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
