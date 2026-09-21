type ToolPromptCopy = Readonly<{ label: string; description: string }>;

const CLOUD_CONNECTION_RETRY_GUIDANCE =
  ' If a previous Cloud Space authentication or connection error appears in the conversation, do not assume it is still current after the user updates Cloud Space settings; retry this cloud tool for the new request.';

export const DATA_TOOL_COPY = {
  data_list_input_tables: {
    label: 'List input tables',
    description: 'List local data input tables. Use before referencing an input table by name.',
  },
  data_list_cloud_spaces: {
    label: 'List cloud spaces',
    description:
      'List personal analysis cloud/mock spaces through the configured API. Use before selecting cloud projects.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_list_cloud_projects: {
    label: 'List cloud projects',
    description:
      'List personal analysis cloud/mock projects under a cloud space. Use before selecting cloud tables.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_list_cloud_tables: {
    label: 'List cloud tables',
    description:
      'List personal analysis cloud/mock tables under a cloud project. Use before importing a cloud table into cowork.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_import_cloud_table: {
    label: 'Import cloud table',
    description:
      'Export a personal analysis cloud/mock table as CSV, download it locally, and create a cowork input table from it.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_upload_table_to_cloud: {
    label: 'Upload table to cloud',
    description:
      'Export a cowork input/output table to CSV, upload it to personal analysis cloud/mock storage, and submit an import with CREATE or REPLACE mode. For workflow outputs, only upload after a mode=persisted run and an output-table preview confirms the final rows.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_create_input_table: {
    label: 'Create input table',
    description:
      'Create an input table from a user-selected or explicitly authorized local file/folder.',
  },
  data_create_input_table_with_processing_strategy: {
    label: 'Create input table with processing strategy',
    description:
      'Create an input table using an explicit data-processing strategy. Use strategy=auto for built-in import. Use strategy=customize for complex Excel/CSV/folder standardization: the app samples the source, generates a normalizer project through the configured LLM, previews it, publishes the version, then imports the input table bound to that published strategy.',
  },
  data_update_input_table: {
    label: 'Update input table',
    description: 'Rename or re-import an existing input table.',
  },
  data_summarize_input_table_source: {
    label: 'Summarize input table source',
    description:
      'Use built-in Node readers to create a bounded structural summary for an authorized input file/folder, including Excel sheet samples and merged-cell metadata.',
  },
  data_generate_input_table_normalizer_draft: {
    label: 'Generate input table normalizer draft',
    description:
      'Generate and save a draft Python or Node.js normalizer project. The app first samples the real source with built-in Node readers, asks the LLM to analyze that structure, then generates final processing code from the analysis and rule prompt.',
  },
  data_preview_input_table_normalizer_version: {
    label: 'Preview input table normalizer version',
    description:
      'Run a saved normalizer artifact version against an authorized input source and return a bounded preview of the normalized table.',
  },
  data_publish_input_table_normalizer_version: {
    label: 'Publish input table normalizer version',
    description:
      'Publish a previewed normalizer artifact version. This archives the previously published version for the same artifact.',
  },
  data_list_input_table_normalizer_versions: {
    label: 'List input table normalizer versions',
    description: 'List draft, published, and archived versions for a normalizer artifact.',
  },
  data_list_output_tables: {
    label: 'List output tables',
    description: 'List reusable output tables. Use before referencing an output table by name.',
  },
  data_create_output_table: {
    label: 'Create output table',
    description:
      'Create reusable output table metadata. For workflow outputs, usually pass only name and bind it later with data_apply_workflow_dsl outputTableId. Physical data is written when a data task runs.',
  },
  data_update_output_table: {
    label: 'Update output table',
    description: 'Rename an output table or refresh it from an input table.',
  },
  data_preview_table: {
    label: 'Preview data table',
    description:
      'Inspect a table schema, or bounded row values when the user explicitly asks to see data. Do not call this before data_analyze_task_requirement merely to discover columns; the analyzer resolves the input schema internally. Rows are omitted unless includeRows=true.',
  },
  data_list_tasks: {
    label: 'List data tasks',
    description: 'List reusable data tasks. Use before referencing a task by name.',
  },
  data_analyze_task_requirement: {
    label: 'Analyze data task requirement',
    description:
      'Analyze a natural-language requirement against the registered single-input data-task capabilities. Always call this before generating a task. Show the result to the user and wait for a new user message with explicit confirmation. Ambiguous or unsupported requirements must be revised and analyzed again.',
  },
  data_generate_task_from_requirement: {
    label: 'Generate data task from requirement',
    description:
      'Generate, compile, temporarily execute, validate, and save a reusable native-node data task from a supported analysis receipt. Call only after showing the analysis to the user and receiving explicit confirmation in a new user message. Pass outputMode, outputTableName, and outputTableId as flat fields; never serialize nested JSON into a string. Never provide or generate workflow DSL.',
  },
  data_update_task: {
    label: 'Update data task',
    description: 'Rename an existing data task.',
  },
  data_get_task_workflow: {
    label: 'Get task workflow',
    description:
      'Read the saved workflow for a data task. view=summary (default) returns task meta and node types; view=graph returns full editable node configs and edges; view=node returns one node config plus touching edges (requires nodeId).',
  },
  data_get_workflow_dsl_reference: {
    label: 'Get workflow DSL reference',
    description:
      'Read the embedded Prep DSL reference (syntax, operators, examples, validation rules). Topics: overview, workflow, operators, derive_window, reshape, examples, all.',
  },
  data_get_workflow_capability_manifest: {
    label: 'Get workflow capability manifest',
    description:
      'Versioned capability manifest for constrained workflow plans: plan JSON Schema, resource binding contract, runtime semantics, stable diagnostic codes, and the apply->trial-run repair loop. Default response omits per-operator config schemas; pass sections=["operators"] with operatorTypes to fetch only the schemas needed. Pass table ids to include real column snapshots.',
  },
  data_apply_workflow_plan: {
    label: 'Apply workflow plan',
    description:
      'Apply a constrained workflow plan ({version, nodes, edges} matching the capability manifest). Binds input_source nodes by alias via inputResources, validates configs/graph/schema, exports canonical DSL, and saves unless dryRun.',
  },
  data_apply_workflow_dsl: {
    label: 'Apply workflow DSL',
    description:
      'Apply Prep DSL text to a data task. inputResources maps each input alias to a real input table id; dryRun validates without saving. Returns diagnostics with stable codes and the canonical DSL.',
  },
  data_configure_input_operator: {
    label: 'Configure input operator',
    description:
      'Bind an input_source node to a real input table (alias optional; incrementalBy sets the incremental watermark column).',
  },
  data_configure_output_operator: {
    label: 'Configure output operator',
    description:
      'Configure an output node: output table binding, mode (replace/append/error_if_exists/merge), mergeKeys for merge, and schemaPolicy.',
  },
  data_apply_operator_dsl: {
    label: 'Apply operator DSL',
    description: 'Apply a single Prep DSL operator line to an existing workflow node.',
  },
  data_export_workflow_dsl: {
    label: 'Export workflow DSL',
    description: 'Export a data task workflow back to DSL.',
  },
  data_run_task: {
    label: 'Run data task',
    description:
      'Run a saved data task. mode=temporary only validates a preview and does not update reusable output tables; mode=persisted writes formal outputs.',
  },
  data_get_run_result: {
    label: 'Get run result',
    description: 'Read the latest bounded preview for a completed data task.',
  },
} as const satisfies Record<string, ToolPromptCopy>;

export const AUTOMATION_TOOL_COPY = {
  automation_list: {
    label: 'List automations',
    description:
      'List existing automations. Use before referencing an automation by name or when checking whether a similar automation already exists.',
  },
  automation_set_enabled: {
    label: 'Enable or disable automation',
    description:
      'Enable or disable an existing automation. Resolve the exact automation id with automation_list first. Call only when the user explicitly requested this state change. Enabling also resumes a paused or failed automation. Disabling prevents future scheduled executions but does not cancel an execution already in progress.',
  },
  automation_prepare: {
    label: 'Prepare automation',
    description:
      'Validate and prepare a scheduled automation without creating it. Call only after action and execution time are fully known. Pass schedule and action as objects, not JSON strings. For a new data task, generate and validate the saved data task first, then pass its returned task id. This returns a draftId for automation_create.',
  },
  automation_create: {
    label: 'Create automation',
    description:
      'Create a persistent scheduled automation from a valid automation_prepare draft. Call only when the user explicitly asked to create the prepared automation. Retrying the same draft is idempotent.',
  },
  automation_prepare_schedule_update: {
    label: 'Prepare automation schedule update',
    description:
      'Validate and preview a schedule-only update for an existing automation. Resolve the exact automation id with automation_list first. This preserves the automation action and enabled or paused state, and returns a draftId for automation_update_schedule.',
  },
  automation_update_schedule: {
    label: 'Update automation schedule',
    description:
      'Apply a prepared schedule-only automation update. Call only when the user explicitly requested the exact schedule change. Retrying the same draft is idempotent.',
  },
} as const satisfies Record<string, ToolPromptCopy>;

export const TOOL_RESULT_GUIDANCE = {
  dataAnalysisSupported:
    'Show this plan to the user and wait for an explicit confirmation in a new user message. Then call data_generate_task_from_requirement with this analysisId.',
  dataAnalysisNeedsConfirmation:
    'Ask the user to clarify or revise the ambiguous/unsupported items, then analyze the revised requirement again. Do not generate yet.',
  dataAnalysisUnsupported:
    'Explain the unsupported capability and suggested alternatives. Do not generate this requirement.',
  dataTaskSaved:
    'The reusable task is saved. Formal output has not been written; use data_run_task with mode=persisted only when the user requests it.',
  automationPrepared:
    'Call automation_create only if the user explicitly asked to create this automation.',
  automationScheduleUpdatePrepared:
    'Call automation_update_schedule only if the user explicitly requested this schedule change.',
} as const;

export const TOOL_SCHEMA_COPY = {
  data: {
    inputConfig: 'Input table configuration. Use the data page config shape when known.',
    resourceQuery: 'Search by resource name.',
    resultPreviewRows:
      'Number of result rows returned to the conversation. Defaults to 5 and is capped at 5; use data_preview_table only when the user explicitly requests more row values.',
    apiOrigin: 'Cloud space API origin. If omitted, the saved Cloud Space setting is used.',
    apiKey:
      'Cloud space API key used to exchange an access token. If omitted, the saved Cloud Space setting is used.',
    accessToken: 'Optional Bearer token. If omitted, the tool exchanges apiKey for a token.',
    connectionMode:
      'Explicit credential mode. account uses the signed-in desktop account token only; apiKey uses the provided or saved API key only. If omitted, legacy fallback rules apply.',
    normalizerRule:
      'User rule prompt describing how to transform the authorized source into a standard two-dimensional table.',
    serializedProcessingStrategy:
      'Compatibility fallback for models that accidentally serialize processingStrategy as a JSON string. Prefer passing an object.',
    cloudTableQuery: 'Search by cloud table name.',
    cloudSpaceId: 'Optional cloud space id. Pass with projectId to resolve the cloud table name.',
    cloudProjectId: 'Optional cloud project id. Pass with spaceId to resolve the cloud table name.',
    datasourceId:
      'Cloud space datasource id used for this upload. If omitted, the tool uses the only available datasource; when multiple datasources are available, ask the user to choose one.',
    replaceTableId: 'Required when writeMode=REPLACE. Must be omitted for CREATE.',
    uploadFileName: 'CSV file name sent to the upload API.',
    authorizedFilePath: 'Authorized local file path.',
    authorizedFolderPath: 'Authorized local folder path.',
    sourceInputTableId: 'Optional input table id to initialize the output table.',
    includeRows:
      'Set true only when the user explicitly asks to inspect row values. Defaults to schema-only output.',
    requirementInputTableId: 'Existing input table id returned by data_list_input_tables.',
    processRequirement: 'The user requirement exactly as agreed so far.',
    analysisId: 'Opaque id returned by data_analyze_task_requirement.',
    analysisConfirmed: 'Pass true only after the user explicitly confirms the analysis.',
    outputMode:
      'Use create for a new output table or replace for an existing output table selected by the user.',
    outputTableName: 'New output table name. Use only when outputMode=create.',
    outputTableId:
      'Existing output table id explicitly selected by the user. Required when outputMode=replace.',
  },
  automation: {
    timezone:
      'IANA timezone. Omit to use the desktop system timezone. This version only supports the system timezone.',
    startDate: 'Optional local start date, YYYY-MM-DD.',
    endDate: 'Optional local end date, YYYY-MM-DD.',
    times: 'Local execution times in HH:mm format.',
    runAt: 'RFC3339 timestamp with an explicit offset, for example 2026-08-15T09:00:00+08:00.',
    intervalStartAt: 'RFC3339 timestamp with an explicit timezone offset.',
    intervalEndAt: 'Optional RFC3339 timestamp with an explicit timezone offset.',
    dataTaskId:
      'Existing saved data task id. Resolve names with data_list_tasks. For a new task, first finish data_generate_task_from_requirement and use its returned task id.',
    conversationPrompt: 'The complete instruction that each scheduled conversation should execute.',
    query: 'Search automation name or description.',
    serializedObject:
      'Compatibility fallback for models that accidentally serialize this object as JSON. Prefer passing an object.',
    createConfirmed: 'Pass true only when the user explicitly requested creation.',
    automationId:
      'Exact automation id. Resolve it with automation_list; never guess an id from a name.',
    enabled: 'Set true to enable the automation or false to disable it.',
    enabledConfirmed:
      'Pass true only when the user explicitly requested enabling or disabling this automation.',
    scheduleUpdateConfirmed:
      'Pass true only when the user explicitly requested this schedule change.',
  },
} as const;
