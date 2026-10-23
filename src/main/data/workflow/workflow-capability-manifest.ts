import { z } from 'zod';
import {
  OPERATOR_TYPES,
  OPERATOR_DEFINITIONS,
  OPERATOR_GROUPS,
  SCHEMA_MAP,
} from '../../../shared/operators';
import { OPERATOR_NAMING } from '../../../shared/operators/naming';
import { WORKFLOW_PLAN_VERSION } from '../../../shared/workflow-plan';
import { AI_JFLOW_RUNTIME_PROFILE_VERSION } from './jflow-capability-profile';
import { JFLOW_REFERENCE_VERSION } from '../../../shared/jflow';

export const WORKFLOW_CAPABILITY_MANIFEST_VERSION = 'workflow-capability-manifest/v1' as const;
export const WORKFLOW_DSL_LANGUAGE_VERSION = JFLOW_REFERENCE_VERSION;

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
  /** Real output table id — bind via `resources.resultTableId` or `outputResultTableId` config. */
  id: string;
  name: string;
  physicalTable: string;
  columns: ManifestColumnSnapshot[];
}

const PLAN_NODE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
    type: {
      type: 'string',
      enum: [...OPERATOR_TYPES],
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
  // input/output come from SCHEMA_MAP's real Zod schemas too — the
  // manifest must describe exactly what validation accepts.
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
    dslVersion: WORKFLOW_DSL_LANGUAGE_VERSION,
    capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
    plan: {
      description:
        'Submit {version, nodes, edges} to data_apply_workflow_plan. Each node config must satisfy plan.operatorConfigSchemas[node.type]; field names in configs must exist on the upstream stream schema (validation runs against the real bound-table schemas).',
      schema: PLAN_ENVELOPE_SCHEMA,
      operatorConfigSchemas: operatorConfigJsonSchemas(),
      operatorCategories: OPERATOR_GROUPS,
      // type ↔ DSL keyword ↔ UI label, so agents can map user wording to plan types.
      operatorNaming: OPERATOR_NAMING,
      // Edge endpoints per operator — the single source is the registry's ports.
      ports: Object.fromEntries(
        OPERATOR_TYPES.map((type) => [type, OPERATOR_DEFINITIONS[type].ports])
      ),
      handles: {
        'join|set_op': { target: ['left', 'right'] },
        expect: { source: ['output', 'reject'], note: 'reject requires config.rejectStream' },
        default: { source: ['output'], target: ['input'] },
      },
    },
    resources: {
      inputResources:
        'Record<alias, rawTableId> — binds each input node by its config.alias to a real input table id (from data_list_raw_tables or the snapshots below). rawTableId/inputAlias legacy params bind a single source.',
      resultTableId:
        'Binds the first output node to a real output table id (from data_list_result_tables). Extra sinks bind via config.outputResultTableId.',
    },
    runtime: {
      sqlQuery:
        'sql.config.sql is one DuckDB query (SELECT, WITH, subqueries, joins, window functions). Use input as the wired upstream relation; every input with config.alias is also readable by that alias (e.g. FROM erp JOIN bank ...), so a SQL node can combine several named inputs. Result columns flow downstream. Scripts, write statements, and unbound parameters are not supported.',
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
        'input.incrementalBy (bound input tables, files and pipeline sources) reads rows newer than the last committed watermark and advances it only after a successful commit',
      outOfScope:
        'Scheduling, credentials, and retry policy stay in pipeline configuration, not in plans or DSL',
    },
    diagnostics:
      'Validation returns diagnostics with stable `code` values (e.g. planFieldNotFound, invalidConfig, outputMergeKeysMissing, NODE_GRAPH_*) — repair by code, not by message text.',
    repairLoop: [
      '1. data_get_workflow_capability_manifest({ rawTableIds, resultTableIds }) — fetch schemas + snapshots',
      '2. data_apply_workflow_plan({ pipelineId, plan, inputResources, resultTableId, dryRun: true }) — returns diagnostics + canonical dsl',
      '3. Fix the plan by diagnostic.code and retry until errors are empty',
      '4. data_apply_workflow_plan({ ..., dryRun: false }) — saves the workflow graph',
      '5. data_run_pipeline({ pipelineId, mode: "temporary" }) — trial run returns nodeStats + diagnostics',
      '6. data_run_pipeline({ pipelineId, mode: "persisted" }) — commit',
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

export type WorkflowCapabilityManifest = ReturnType<typeof buildWorkflowCapabilityManifest>;

export const WORKFLOW_CAPABILITY_MANIFEST_SECTIONS = [
  'plan',
  'operators',
  'runtime',
  'bindings',
] as const;
export type WorkflowCapabilityManifestSection =
  (typeof WORKFLOW_CAPABILITY_MANIFEST_SECTIONS)[number];

/**
 * Slice the full manifest into the model-visible payload. The complete manifest
 * stays in `details` for UI/debugging; model `content` receives only the
 * requested sections so the operator schema catalog is fetched per pipeline.
 *
 * Default slice: plan envelope + ports/handles + binding rules + runtime
 * semantics + bound resource snapshots + the operator type index. Per-operator
 * config schemas are included only when the `operators` section is requested
 * (optionally narrowed by `operatorTypes`).
 */
export function sliceWorkflowCapabilityManifest(
  manifest: WorkflowCapabilityManifest,
  options: { sections?: readonly string[]; operatorTypes?: readonly string[] } = {}
): Record<string, unknown> {
  const sections = new Set<WorkflowCapabilityManifestSection>(
    (options.sections?.filter((section): section is WorkflowCapabilityManifestSection =>
      (WORKFLOW_CAPABILITY_MANIFEST_SECTIONS as readonly string[]).includes(section)
    ) ?? []) as WorkflowCapabilityManifestSection[]
  );
  const includeAll = options.sections === undefined || options.sections.length === 0;

  const requestedOperatorTypes = (options.operatorTypes ?? []).filter((type) =>
    (OPERATOR_TYPES as readonly string[]).includes(type)
  );
  const operatorSchemas = (() => {
    // Operator payload schemas are the expensive part — they ship only on an
    // explicit `operators` section request, never in the default slice.
    if (!sections.has('operators')) return undefined;
    const all = manifest.plan.operatorConfigSchemas as Record<string, unknown>;
    if (requestedOperatorTypes.length === 0) return all;
    return Object.fromEntries(
      requestedOperatorTypes.filter((type) => type in all).map((type) => [type, all[type]])
    );
  })();

  const slice: Record<string, unknown> = {
    manifestVersion: manifest.manifestVersion,
    planVersion: manifest.planVersion,
    dslVersion: manifest.dslVersion,
    capabilityProfileVersion: manifest.capabilityProfileVersion,
    operatorTypes: [...OPERATOR_TYPES],
    operatorCategories: manifest.plan.operatorCategories,
  };
  if (includeAll || sections.has('plan')) {
    slice.plan = {
      description: manifest.plan.description,
      schema: manifest.plan.schema,
      ports: manifest.plan.ports,
      handles: manifest.plan.handles,
    };
    slice.resources = manifest.resources;
    slice.diagnostics = manifest.diagnostics;
    slice.repairLoop = manifest.repairLoop;
  }
  if (operatorSchemas) {
    slice.operatorConfigSchemas = operatorSchemas;
    if (requestedOperatorTypes.length > 0) {
      slice.operatorSchemaScope = requestedOperatorTypes;
    }
  } else {
    slice.operatorConfigSchemas =
      'Not included in this slice. Re-request with sections:["operators"] and operatorTypes:["<type>",...] to fetch per-operator config JSON Schemas.';
  }
  if (includeAll || sections.has('runtime')) {
    slice.runtime = manifest.runtime;
  }
  const bindings = (manifest as { bindings?: unknown }).bindings;
  if (bindings && (includeAll || sections.has('bindings'))) {
    slice.bindings = bindings;
  }
  return slice;
}
