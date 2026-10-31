type ToolPromptCopy = Readonly<{ label: string; description: string }>;

const CLOUD_CONNECTION_RETRY_GUIDANCE =
  ' If a previous Cloud Space authentication or connection error appears in the conversation, do not assume it is still current after the user updates Cloud Space settings; retry this cloud tool for the new request.';

export const DATA_TOOL_COPY = {
  data_list_raw_tables: {
    label: 'List raw tables',
    description: 'List local data raw tables. Use before referencing a raw table by name.',
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
      'Export a personal analysis cloud/mock table as Csv, download it locally, and create a cowork raw table from it.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_upload_table_to_cloud: {
    label: 'Upload table to cloud',
    description:
      'Export a cowork raw/result table to Csv, upload it to personal analysis cloud/mock storage, and submit an import with CREATE or REPLACE mode. For workflow outputs, only upload after a mode=persisted run and an result-table preview confirms the final rows.' +
      CLOUD_CONNECTION_RETRY_GUIDANCE,
  },
  data_create_raw_table: {
    label: 'Create raw table',
    description:
      'Create raw table(s) from a user-selected or explicitly authorized local file/folder. A source can produce several tables. Excel: sheetName imports one sheet; sheetNames imports one table per sheet, or one merged table (with a _sheet column) when mergeSheets=true. Folder: folderMode=merge (default; one table with a _来源文件 column, missing columns filled with null, files missing the sheet or with type conflicts are excluded) or per_file (one table per file); sheetSelector picks the sheet of multi-sheet Excel files by name or 1-based index. Call data_summarize_raw_table_source first to list the sheets.',
  },
  data_refresh_raw_source: {
    label: 'Refresh raw source',
    description:
      'Re-import every table of a raw-table source (all its sheets or files) from the local file/folder. Pass the source id or any of its raw table ids. New sheets/files are added when auto-include is on; members no longer in the source are marked missing.',
  },
  data_create_raw_table_with_processing_strategy: {
    label: 'Create raw table with processing strategy',
    description:
      'Create a raw table using an explicit data-processing strategy. Use strategy=auto for built-in import. Use strategy=customize for complex Excel/Csv/folder standardization: the app samples the source, generates a normalizer project through the configured LLM, previews it, publishes the version, then imports the raw table bound to that published strategy.',
  },
  data_update_raw_table: {
    label: 'Update raw table',
    description:
      'Rename or re-import an existing raw table. For Excel, pass sheetName to switch the imported sheet (it must exist; the error lists the available sheets).',
  },
  data_delete_raw_table: {
    label: 'Delete raw table',
    description:
      'Delete an input table that you created earlier in this same conversation (for example a wrong import or wrong sheet). Tables created elsewhere or used by a data pipeline are refused. Requires user confirmation like other deletes; prefer data_update_raw_table with sheetName to fix a wrong sheet in place.',
  },
  data_summarize_raw_table_source: {
    label: 'Summarize raw table source',
    description:
      'Use built-in Node readers to create a bounded structural summary for an authorized input file/folder, including Excel sheet samples and merged-cell metadata.',
  },
  data_generate_raw_table_normalizer_draft: {
    label: 'Generate raw table normalizer draft',
    description:
      'Generate and save a draft Python or Node.js normalizer project. The app first samples the real source with built-in Node readers, asks the LLM to analyze that structure, then generates final processing code from the analysis and rule prompt.',
  },
  data_preview_raw_table_normalizer_version: {
    label: 'Preview raw table normalizer version',
    description:
      'Run a saved normalizer artifact version against an authorized input source and return a bounded preview of the normalized table.',
  },
  data_publish_raw_table_normalizer_version: {
    label: 'Publish raw table normalizer version',
    description:
      'Publish a previewed normalizer artifact version. This archives the previously published version for the same artifact.',
  },
  data_list_raw_table_normalizer_versions: {
    label: 'List raw table normalizer versions',
    description: 'List draft, published, and archived versions for a normalizer artifact.',
  },
  data_list_result_tables: {
    label: 'List result tables',
    description: 'List reusable result tables. Use before referencing a result table by name.',
  },
  data_create_result_table: {
    label: 'Create result table',
    description:
      'Create reusable result table metadata. For workflow outputs, usually pass only name and bind it later with data_apply_workflow_dsl resultTableId. Physical data is written when a data pipeline runs.',
  },
  data_update_result_table: {
    label: 'Update result table',
    description: 'Rename a result table or refresh it from a raw table.',
  },
  data_preview_table: {
    label: 'Preview data table',
    description:
      'Inspect a table schema, or bounded row values (includeRows=true, limit<=100, offset for paging). Read the rows with includeRows=true before describing or summarizing a result table; the output states which rows were shown and how to fetch the rest. Do not call this before data_analyze_pipeline_requirement merely to discover columns; the analyzer resolves the input schema internally. Rows are omitted unless includeRows=true.',
  },
  data_list_pipelines: {
    label: 'List data pipelines',
    description: 'List reusable data pipelines. Use before referencing a pipeline by name.',
  },
  data_analyze_pipeline_requirement: {
    label: 'Analyze data pipeline requirement',
    description:
      "Analyze a natural-language requirement against the registered single-input data-pipeline capabilities. Always call this before generating a pipeline. Show the result to the user and wait for a new user message with explicit confirmation. Ambiguous or unsupported requirements must be revised and analyzed again. Call it on the requirement as stated instead of asking clarifying questions in prose first: vague criteria come back as needs_confirmation, and the user's answer to that question then counts as the confirmation.",
  },
  data_generate_pipeline_from_requirement: {
    label: 'Generate data pipeline from requirement',
    description:
      'Generate, compile, temporarily execute, validate, and save a reusable native-node data pipeline from a supported analysis receipt. Call only after showing the analysis to the user and receiving explicit confirmation in a new user message. Pass outputMode, resultTableName, and resultTableId as flat fields; never serialize nested JSON into a string. Never provide or generate workflow DSL.',
  },
  data_create_pipeline: {
    label: 'Create data pipeline',
    description:
      'Create an empty (draft) data pipeline with a unique name, optionally bound to a source raw table and/or result table. Use this for multi-input or explicitly constructed pipelines, then fill it with data_apply_workflow_plan({pipelineId, ...}). This is the only supported way to create a pipeline; never write to the app database directly.',
  },
  data_update_pipeline: {
    label: 'Update data pipeline',
    description: 'Rename an existing data pipeline.',
  },
  data_get_pipeline_workflow: {
    label: 'Get pipeline workflow',
    description:
      'Read the saved workflow for a data pipeline. view=summary (default) returns pipeline meta and node types; view=graph returns full editable node configs and edges; view=node returns one node config plus touching edges (requires nodeId).',
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
      'Apply a constrained workflow plan ({version, nodes, edges} matching the capability manifest). Binds input nodes by alias via inputResources, validates configs/graph/schema, exports canonical DSL, and saves unless dryRun.',
  },
  data_apply_workflow_dsl: {
    label: 'Apply workflow DSL',
    description:
      'Apply Prep DSL text to a data pipeline. inputResources maps each input alias to a real raw table id; dryRun validates without saving. Returns diagnostics with stable codes and the canonical DSL.',
  },
  data_configure_input_operator: {
    label: 'Configure input operator',
    description:
      'Bind an input node to a real raw table (alias optional). The operator reads the full raw table on every run.',
  },
  data_configure_output_operator: {
    label: 'Configure output operator',
    description:
      'Configure an output node: result table binding, mode (replace/append/error_if_exists/merge), mergeKeys for merge, and schemaPolicy.',
  },
  data_apply_operator_dsl: {
    label: 'Apply operator DSL',
    description: 'Apply a single Prep DSL operator line to an existing workflow node.',
  },
  data_export_workflow_dsl: {
    label: 'Export workflow DSL',
    description: 'Export a data pipeline workflow back to DSL.',
  },
  data_run_pipeline: {
    label: 'Run data pipeline',
    description:
      'Run a saved data pipeline. mode=temporary only validates a preview and does not update reusable result tables; mode=persisted writes formal outputs.',
  },
  data_get_run_result: {
    label: 'Get run result',
    description: 'Read the latest bounded preview for a completed data pipeline.',
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
      'Validate and prepare a scheduled automation without creating it. Call only after action and execution time are fully known. Pass schedule and action as objects, not JSON strings. For a new data pipeline, generate and validate the saved data pipeline first, then pass its returned pipeline id. This returns a draftId for automation_create.',
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
    'Show this plan to the user and wait for an explicit confirmation in a new user message. Then call data_generate_pipeline_from_requirement with this analysisId.',
  dataAnalysisClarified:
    "The user's latest message answered the earlier clarification, so it already confirms this plan. Call data_generate_pipeline_from_requirement now with this analysisId and confirmed=true; do not ask for another confirmation.",
  dataAnalysisNeedsConfirmation:
    'Ask the user to clarify or revise the ambiguous/unsupported items, then analyze the revised requirement again. Do not generate yet.',
  dataAnalysisUnsupported:
    'Explain the unsupported capability and suggested alternatives. Do not generate this requirement.',
  dataPipelineSaved:
    'The reusable pipeline is saved. Formal output has not been written; use data_run_pipeline with mode=persisted only when the user requests it.',
  automationPrepared:
    'Call automation_create only if the user explicitly asked to create this automation.',
  automationScheduleUpdatePrepared:
    'Call automation_update_schedule only if the user explicitly requested this schedule change.',
} as const;

export const TOOL_SCHEMA_COPY = {
  data: {
    inputConfig: 'Raw table configuration. Use the data page config shape when known.',
    sheetName:
      'Excel only: exact sheet name to import. Must exist in the workbook; otherwise the call fails and lists the available sheets.',
    sheetNames:
      'Excel only: several exact sheet names. Creates one table per sheet (or one merged table with mergeSheets=true).',
    mergeSheets:
      'Excel with sheetNames: merge the sheets into one table with a _sheet column. Sheets must have the same columns.',
    folderMode:
      'Folder only: merge = one table with a _来源文件 column (default); per_file = one table per file.',
    sheetSelector:
      'Folder only: which sheet to use for multi-sheet Excel files, {by:"name",name} or {by:"index",index>=1}. Files without that sheet are excluded.',
    rawSourceId: 'Raw-table source id, or the id of any raw table in that source.',
    deleteReason: 'Short reason shown to the user, e.g. "imported the wrong sheet".',
    resourceQuery: 'Search by resource name.',
    resultPreviewRows:
      'Number of result rows returned to the conversation (default and max 20). If the result has more rows, read them with data_preview_table(includeRows=true, offset) before describing them.',
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
    uploadFileName: 'Csv file name sent to the upload API.',
    authorizedFilePath: 'Authorized local file path.',
    authorizedFolderPath: 'Authorized local folder path.',
    sourceRawTableId: 'Optional raw table id to initialize the result table.',
    includeRows:
      'Set true whenever you need row values: when the user asks to see data, and before you describe, list, count or summarize rows of a table. Defaults to schema-only output (no row values).',
    requirementRawTableId: 'Existing raw table id returned by data_list_raw_tables.',
    processRequirement: 'The user requirement exactly as agreed so far.',
    analysisId: 'Opaque id returned by data_analyze_pipeline_requirement.',
    analysisConfirmed: 'Pass true only after the user explicitly confirms the analysis.',
    outputMode:
      'Use create for a new result table or replace for an existing result table selected by the user.',
    resultTableName: 'New result table name. Use only when outputMode=create.',
    resultTableId:
      'Existing result table id explicitly selected by the user. Required when outputMode=replace.',
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
    dataPipelineId:
      'Existing saved data pipeline id. Resolve names with data_list_pipelines. For a new pipeline, first finish data_generate_pipeline_from_requirement and use its returned pipeline id.',
    conversationPrompt: 'The complete instruction that each scheduled conversation should execute.',
    scriptPackageId:
      'Published script package id (from script_package_list). The automation runs it with no model call and imports its output into a raw table.',
    scriptOnError:
      'What to do when the script fails: notify (default, keep old data) or ai_repair (let the AI fix a pending copy for the user to confirm).',
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
