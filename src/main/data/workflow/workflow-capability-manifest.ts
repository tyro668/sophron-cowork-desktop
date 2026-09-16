import { z } from 'zod';
import { SCHEMA_MAP } from '../../../shared/operator-schemas';
import { WORKFLOW_PLAN_VERSION } from '../../../shared/workflow-plan';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from './prep-dsl-capability-profile';

export const WORKFLOW_CAPABILITY_MANIFEST_VERSION = 'workflow-capability-manifest/v1' as const;
export const PREP_DSL_LANGUAGE_VERSION = 'prep-dsl/v2' as const;

export interface ManifestColumnSnapshot {
  name: string;
  type: string;
}

export interface ManifestInputBindingSnapshot {
  /** Real input table id — bind it under `resources.inputs[alias]`. */
  id: string;
  name: string;
  columns: ManifestColumnSnapshot[];
}

export interface ManifestOutputBindingSnapshot {
  /** Real output table id — bind via `resources.outputTableId` or `outputDatasetId` config. */
  id: string;
  name: string;
  physicalTable: string;
  columns: ManifestColumnSnapshot[];
}

const INPUT_SOURCE_SCHEMA = {
  type: 'object',
  description:
    'Input node. `source: "dataset"` reads a bound input table (datasetId comes from resources.inputs[alias], not guessed); `source: "task"` reads the task source file; `source: "file"` reads a literal filePath.',
  properties: {
    source: { type: 'string', enum: ['dataset', 'task', 'file'] },
    datasetId: {
      type: 'string',
      description: 'Bound input table id; usually set via resources.inputs[alias]',
    },
    filePath: { type: 'string', description: 'Literal file path for source=file' },
    alias: {
      type: 'string',
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      description: 'Stream name this source produces; required when bound via resources.inputs',
    },
    incrementalBy: {
      type: 'string',
      description: 'Watermark column; runs read only rows newer than the last committed watermark',
    },
  },
  required: ['source', 'alias'],
  additionalProperties: true,
};

const OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Sink node. `table` is the output table name; bind a real output table via resources.outputTableId (first sink) or config.outputDatasetId (additional sinks).',
  properties: {
    destination: {
      type: 'string',
      enum: ['duckdb_table'],
      description: 'Only duckdb_table targets are executable',
    },
    table: { type: 'string' },
    outputDatasetId: {
      type: 'string',
      description: 'Real output table id (from data_list_output_tables)',
    },
    mode: { type: 'string', enum: ['replace', 'append', 'error_if_exists', 'merge'] },
    mergeKeys: {
      type: 'array',
      items: { type: 'string' },
      description: 'Business keys; required when mode=merge',
    },
    schemaPolicy: { type: 'string', enum: ['extend', 'strict', 'ignore'] },
  },
  required: ['table'],
  additionalProperties: true,
};

const PLAN_NODE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
    type: {
      type: 'string',
      enum: [
        'input_source',
        'filter',
        'sort',
        'field_select',
        'field_mapping',
        'deduplicate',
        'missing_value',
        'type_convert',
        'calculate_field',
        'aggregate',
        'pivot',
        'unpivot',
        'unnest',
        'join',
        'set_op',
        'limit',
        'expect',
        'output',
      ],
    },
    label: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    config: {
      type: 'object',
      description: 'Per-type config — see plan.operatorConfigSchemas[type]',
    },
  },
  required: ['id', 'type'],
  additionalProperties: false,
};

const PLAN_EDGE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    sourceNodeId: { type: 'string' },
    targetNodeId: { type: 'string' },
    sourceHandle: {
      type: 'string',
      enum: ['output', 'reject'],
      description: '`reject` only on expect nodes (requires config.rejectStream)',
    },
    targetHandle: {
      type: 'string',
      enum: ['input', 'left', 'right'],
      description: '`left`/`right` only on join/set_op targets',
    },
  },
  required: ['sourceNodeId', 'targetNodeId'],
  additionalProperties: false,
};

const PLAN_ENVELOPE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    version: { type: 'string', const: WORKFLOW_PLAN_VERSION },
    nodes: { type: 'array', items: PLAN_NODE_SCHEMA },
    edges: { type: 'array', items: PLAN_EDGE_SCHEMA },
  },
  required: ['version', 'nodes', 'edges'],
  additionalProperties: false,
};

function operatorConfigJsonSchemas(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const [type, schema] of Object.entries(SCHEMA_MAP)) {
    try {
      schemas[type] = z.toJSONSchema(schema);
    } catch {
      schemas[type] = { type: 'object', additionalProperties: true };
    }
  }
  schemas.input_source = INPUT_SOURCE_SCHEMA;
  schemas.output = OUTPUT_SCHEMA;
  return schemas;
}

export function buildWorkflowCapabilityManifest(
  options: {
    inputs?: ManifestInputBindingSnapshot[];
    outputs?: ManifestOutputBindingSnapshot[];
  } = {}
) {
  return {
    manifestVersion: WORKFLOW_CAPABILITY_MANIFEST_VERSION,
    planVersion: WORKFLOW_PLAN_VERSION,
    dslVersion: PREP_DSL_LANGUAGE_VERSION,
    capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
    plan: {
      description:
        'Submit {version, nodes, edges} to data_apply_workflow_plan. Each node config must satisfy plan.operatorConfigSchemas[node.type]; field names in configs must exist on the upstream stream schema (validation runs against the real bound-table schemas).',
      schema: PLAN_ENVELOPE_SCHEMA,
      operatorConfigSchemas: operatorConfigJsonSchemas(),
      handles: {
        'join|set_op': { target: ['left', 'right'] },
        expect: { source: ['output', 'reject'], note: 'reject requires config.rejectStream' },
        default: { source: ['output'], target: ['input'] },
      },
    },
    resources: {
      inputResources:
        'Record<alias, inputTableId> — binds each input_source node by its config.alias to a real input table id (from data_list_input_tables or the snapshots below). inputTableId/inputAlias legacy params bind a single source.',
      outputTableId:
        'Binds the first output node to a real output table id (from data_list_output_tables). Extra sinks bind via config.outputDatasetId.',
    },
    runtime: {
      outputModes: {
        replace: 'default; rebuilds the target table',
        append: 'adds rows to the existing target (UNION ALL BY NAME); not idempotent by design',
        error_if_exists: 'fails when the target table already exists',
        merge: 'business-key upsert via mergeKeys; rerunning the same batch is idempotent',
      },
      schemaPolicies: {
        extend: 'default; new incoming columns are added, old rows null-filled',
        strict: 'fails when incoming and existing column sets differ',
        ignore: 'drops incoming-only columns, null-fills missing target columns',
      },
      expect:
        'kind expression|unique|row_count; violations fail the run unless config.rejectStream routes rejected rows to a named stream consumable via a `reject` edge',
      incremental:
        'input_source.incrementalBy reads rows newer than the last committed watermark and advances it only after a successful commit',
      outOfScope:
        'Scheduling, credentials, and retry policy stay in task configuration, not in plans or DSL',
    },
    diagnostics:
      'Validation returns diagnostics with stable `code` values (e.g. planFieldNotFound, invalidConfig, outputMergeKeysMissing, NODE_GRAPH_*) — repair by code, not by message text.',
    repairLoop: [
      '1. data_get_workflow_capability_manifest({ inputTableIds, outputTableIds }) — fetch schemas + snapshots',
      '2. data_apply_workflow_plan({ taskId, plan, inputResources, outputTableId, dryRun: true }) — returns diagnostics + canonical dsl',
      '3. Fix the plan by diagnostic.code and retry until errors are empty',
      '4. data_apply_workflow_plan({ ..., dryRun: false }) — saves the workflow graph',
      '5. data_run_task({ taskId, mode: "temporary" }) — trial run returns nodeStats + diagnostics',
      '6. data_run_task({ taskId, mode: "persisted" }) — commit',
    ],
    ...(options.inputs || options.outputs
      ? {
          bindings: {
            inputs: options.inputs ?? [],
            outputs: options.outputs ?? [],
          },
        }
      : {}),
  };
}
