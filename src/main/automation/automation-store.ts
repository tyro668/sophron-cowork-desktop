import { randomUUID } from 'crypto';
import type { DatabaseInstance, ScheduledTaskRow } from '../db/database';
import type {
  Automation,
  AutomationActionGraph,
  AutomationArtifact,
  AutomationConcurrencyPolicy,
  AutomationCreateInput,
  AutomationDeliveryConfig,
  AutomationFailurePolicy,
  AutomationListQuery,
  AutomationRun,
  AutomationRunQuery,
  AutomationRunStatus,
  AutomationTrigger,
  AutomationTriggerReason,
  AutomationUpdateInput,
} from '../../shared/automation/types';
import { computeNextAutomationRunAt, normalizeAutomationTrigger } from './automation-trigger';

const AUTOMATION_MIGRATION_VERSION = '1';
const AUTOMATION_MIGRATION_KEY = 'automation_migration_version';
const INTERRUPTED_RUN_ERROR = 'App restarted or the process was interrupted; marked as failed.';
const ORPHANED_QUEUED_RUN_ERROR = 'Queued run became invalid after app restart.';

export interface AutomationRunRecoveryResult {
  failedRunningRuns: number;
  cancelledQueuedRuns: number;
  releasedAutomations: number;
}

export interface AutomationStore {
  list(query?: AutomationListQuery): Automation[];
  get(id: string): Automation | null;
  create(input: AutomationCreateInput): Automation;
  update(id: string, updates: AutomationUpdateInput): Automation | null;
  delete(id: string): boolean;
  listRunnable(now: number): Automation[];
  setRuntimeState(
    id: string,
    updates: Partial<
      Pick<
        Automation,
        | 'status'
        | 'nextRunAt'
        | 'lockedRunId'
        | 'lastRunAt'
        | 'lastRunStatus'
        | 'lastError'
        | 'enabled'
      >
    >
  ): Automation | null;
  createRun(input: AutomationRunCreateInput): AutomationRun;
  updateRun(id: string, updates: AutomationRunUpdateInput): AutomationRun | null;
  listRuns(automationId: string, query?: AutomationRunQuery): AutomationRun[];
  createArtifact(input: AutomationArtifactCreateInput): AutomationArtifact;
  listArtifacts(runId: string): AutomationArtifact[];
  migrateScheduledTasks(): void;
  recoverInterruptedRuns(now?: number): AutomationRunRecoveryResult;
}

interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  enabled: number;
  status: string;
  trigger_json: string;
  action_graph_json: string;
  delivery_json: string | null;
  failure_policy_json: string;
  concurrency_json: string;
  next_run_at: number | null;
  locked_run_id: string | null;
  last_run_at: number | null;
  last_run_status: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface AutomationRunRow {
  id: string;
  automation_id: string;
  status: string;
  trigger_reason: string;
  queued_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  error: string | null;
  artifact_count: number;
  delivery_status: string | null;
  created_session_id: string | null;
  created_at: number;
}

interface AutomationArtifactRow {
  id: string;
  automation_run_id: string;
  source_node_id: string | null;
  kind: string;
  title: string;
  summary: string | null;
  payload_json: string | null;
  file_path: string | null;
  href: string | null;
  created_at: number;
}

interface AutomationRunCreateInput {
  automationId: string;
  status: AutomationRunStatus;
  triggerReason: AutomationTriggerReason;
  queuedAt?: number | null;
  startedAt?: number | null;
}

interface AutomationRunUpdateInput {
  status?: AutomationRunStatus;
  startedAt?: number | null;
  finishedAt?: number | null;
  durationMs?: number | null;
  error?: string | null;
  artifactCount?: number;
  deliveryStatus?: AutomationRun['deliveryStatus'];
  createdSessionId?: string | null;
}

interface AutomationArtifactCreateInput {
  runId: string;
  sourceNodeId?: string | null;
  kind: AutomationArtifact['kind'];
  title: string;
  summary?: string | null;
  mimeType?: string | null;
  content?: string | null;
  filePath?: string | null;
  href?: string | null;
  dataRef?: AutomationArtifact['dataRef'];
}

export const DEFAULT_AUTOMATION_FAILURE_POLICY: AutomationFailurePolicy = {
  disableOnFailure: false,
  retry: { enabled: false, maxAttempts: 0, backoffMs: 60_000 },
  notifyOnFailure: true,
};

export const DEFAULT_AUTOMATION_CONCURRENCY_POLICY: AutomationConcurrencyPolicy = {
  overlapPolicy: 'skip',
};

export const DEFAULT_AUTOMATION_DELIVERY: AutomationDeliveryConfig = {
  enabled: false,
  channels: [],
  artifactPolicy: 'links',
  failureMessage: {
    includeRunLog: true,
    includeArtifacts: false,
  },
};

export function createAutomationStore(db: DatabaseInstance): AutomationStore {
  const raw = db.raw;
  const getAutomationById = (id: string): Automation | null => {
    const row = raw.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
      | AutomationRow
      | undefined;
    return row ? mapAutomationRow(row) : null;
  };

  return {
    list: (query = {}) => {
      const rows = raw
        .prepare('SELECT * FROM automations ORDER BY updated_at DESC')
        .all() as AutomationRow[];
      return rows
        .map(mapAutomationRow)
        .filter((automation) => matchesAutomationQuery(automation, query));
    },

    get: getAutomationById,

    create: (input: AutomationCreateInput) => {
      const now = Date.now();
      const trigger = normalizeAutomationTrigger(input.trigger);
      const enabled = input.enabled !== false;
      const automation: Automation = {
        id: randomUUID(),
        name: input.name.trim() || 'Automation',
        description: input.description ?? null,
        projectId: input.projectId ?? null,
        enabled,
        status: enabled ? 'enabled' : 'disabled',
        trigger,
        actionGraph: normalizeActionGraph(input.actionGraph),
        delivery: input.delivery ?? DEFAULT_AUTOMATION_DELIVERY,
        failurePolicy: mergeFailurePolicy(input.failurePolicy),
        concurrencyPolicy: mergeConcurrencyPolicy(input.concurrencyPolicy),
        nextRunAt: enabled ? computeNextAutomationRunAt(trigger, now) : null,
        lockedRunId: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      insertAutomation(raw, automation);
      return automation;
    },

    update: (id: string, updates: AutomationUpdateInput) => {
      const currentRow = raw.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
        | AutomationRow
        | undefined;
      if (!currentRow) return null;
      const current = mapAutomationRow(currentRow);
      const nextTrigger =
        updates.trigger === undefined
          ? current.trigger
          : normalizeAutomationTrigger(updates.trigger);
      const nextEnabled = updates.enabled === undefined ? current.enabled : updates.enabled;
      const nextStatus = nextEnabled
        ? current.status === 'running'
          ? 'running'
          : 'enabled'
        : 'disabled';
      const next: Automation = {
        ...current,
        name: updates.name === undefined ? current.name : updates.name.trim() || current.name,
        description: updates.description === undefined ? current.description : updates.description,
        projectId: updates.projectId === undefined ? current.projectId : updates.projectId,
        enabled: nextEnabled,
        status: nextStatus,
        trigger: nextTrigger,
        actionGraph:
          updates.actionGraph === undefined
            ? current.actionGraph
            : normalizeActionGraph(updates.actionGraph),
        delivery: updates.delivery === undefined ? current.delivery : updates.delivery,
        failurePolicy:
          updates.failurePolicy === undefined
            ? current.failurePolicy
            : mergeFailurePolicy(updates.failurePolicy, current.failurePolicy),
        concurrencyPolicy:
          updates.concurrencyPolicy === undefined
            ? current.concurrencyPolicy
            : mergeConcurrencyPolicy(updates.concurrencyPolicy, current.concurrencyPolicy),
        nextRunAt: nextEnabled ? computeNextAutomationRunAt(nextTrigger, Date.now()) : null,
        updatedAt: Date.now(),
      };
      updateAutomation(raw, id, automationToUpdateRow(next));
      return getAutomationById(id);
    },

    delete: (id: string) => {
      const result = raw.prepare('DELETE FROM automations WHERE id = ?').run(id);
      return result.changes > 0;
    },

    listRunnable: (now: number) => {
      const rows = raw
        .prepare(
          `SELECT * FROM automations
           WHERE enabled = 1
             AND status != 'paused'
             AND next_run_at IS NOT NULL
             AND next_run_at <= ?
           ORDER BY next_run_at ASC`
        )
        .all(now) as AutomationRow[];
      return rows.map(mapAutomationRow);
    },

    setRuntimeState: (id, updates) => {
      const mapped: Record<string, unknown> = {};
      if (updates.status !== undefined) mapped.status = updates.status;
      if (updates.nextRunAt !== undefined) mapped.next_run_at = updates.nextRunAt;
      if (updates.lockedRunId !== undefined) mapped.locked_run_id = updates.lockedRunId;
      if (updates.lastRunAt !== undefined) mapped.last_run_at = updates.lastRunAt;
      if (updates.lastRunStatus !== undefined) mapped.last_run_status = updates.lastRunStatus;
      if (updates.lastError !== undefined) mapped.last_error = updates.lastError;
      if (updates.enabled !== undefined) mapped.enabled = updates.enabled ? 1 : 0;
      mapped.updated_at = Date.now();
      updateAutomation(raw, id, mapped);
      const row = raw.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
        | AutomationRow
        | undefined;
      return row ? mapAutomationRow(row) : null;
    },

    createRun: (input) => {
      const now = Date.now();
      const row: AutomationRunRow = {
        id: randomUUID(),
        automation_id: input.automationId,
        status: input.status,
        trigger_reason: input.triggerReason,
        queued_at: input.queuedAt ?? null,
        started_at: input.startedAt ?? null,
        finished_at: null,
        duration_ms: null,
        error: null,
        artifact_count: 0,
        delivery_status: null,
        created_session_id: null,
        created_at: now,
      };
      raw
        .prepare(
          `INSERT INTO automation_runs (
            id, automation_id, status, trigger_reason, queued_at, started_at, finished_at,
            duration_ms, error, artifact_count, delivery_status, created_session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.automation_id,
          row.status,
          row.trigger_reason,
          row.queued_at,
          row.started_at,
          row.finished_at,
          row.duration_ms,
          row.error,
          row.artifact_count,
          row.delivery_status,
          row.created_session_id,
          row.created_at
        );
      return mapRunRow(row);
    },

    updateRun: (id, updates) => {
      const mapped: Record<string, unknown> = {};
      if (updates.status !== undefined) mapped.status = updates.status;
      if (updates.startedAt !== undefined) mapped.started_at = updates.startedAt;
      if (updates.finishedAt !== undefined) mapped.finished_at = updates.finishedAt;
      if (updates.durationMs !== undefined) mapped.duration_ms = updates.durationMs;
      if (updates.error !== undefined) mapped.error = updates.error;
      if (updates.artifactCount !== undefined) mapped.artifact_count = updates.artifactCount;
      if (updates.deliveryStatus !== undefined) mapped.delivery_status = updates.deliveryStatus;
      if (updates.createdSessionId !== undefined) {
        mapped.created_session_id = updates.createdSessionId;
      }
      updateById(raw, 'automation_runs', id, mapped);
      const row = raw.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as
        | AutomationRunRow
        | undefined;
      return row ? mapRunRow(row) : null;
    },

    listRuns: (automationId, query = {}) => {
      const rows = raw
        .prepare(
          `SELECT * FROM automation_runs
           WHERE automation_id = ?
           ORDER BY coalesce(started_at, queued_at, created_at) DESC
           LIMIT ? OFFSET ?`
        )
        .all(automationId, query.limit ?? 50, query.offset ?? 0) as AutomationRunRow[];
      return rows.map(mapRunRow).filter((run) => {
        if (!query.status || query.status === 'all') return true;
        return run.status === query.status;
      });
    },

    createArtifact: (input) => {
      const now = Date.now();
      const payload = {
        mimeType: input.mimeType ?? null,
        content: input.content ?? null,
        dataRef: input.dataRef ?? null,
      };
      const row: AutomationArtifactRow = {
        id: randomUUID(),
        automation_run_id: input.runId,
        source_node_id: input.sourceNodeId ?? null,
        kind: input.kind,
        title: input.title,
        summary: input.summary ?? null,
        payload_json: JSON.stringify(payload),
        file_path: input.filePath ?? null,
        href: input.href ?? null,
        created_at: now,
      };
      raw
        .prepare(
          `INSERT INTO automation_artifacts (
            id, automation_run_id, source_node_id, kind, title, summary, payload_json,
            file_path, href, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.automation_run_id,
          row.source_node_id,
          row.kind,
          row.title,
          row.summary,
          row.payload_json,
          row.file_path,
          row.href,
          row.created_at
        );
      return mapArtifactRow(row);
    },

    listArtifacts: (runId) => {
      const rows = raw
        .prepare(
          'SELECT * FROM automation_artifacts WHERE automation_run_id = ? ORDER BY created_at ASC'
        )
        .all(runId) as AutomationArtifactRow[];
      return rows.map(mapArtifactRow);
    },

    migrateScheduledTasks: () => {
      migrateScheduledTasksToAutomations(db);
    },

    recoverInterruptedRuns: (now = Date.now()) => {
      return recoverInterruptedAutomationRuns(raw, now);
    },
  };
}

function recoverInterruptedAutomationRuns(
  raw: DatabaseInstance['raw'],
  now: number
): AutomationRunRecoveryResult {
  const runningRows = raw
    .prepare(
      `SELECT * FROM automation_runs
       WHERE status = 'running'
         AND finished_at IS NULL`
    )
    .all() as AutomationRunRow[];
  const queuedRows = raw
    .prepare(
      `SELECT * FROM automation_runs
       WHERE status = 'queued'
         AND finished_at IS NULL`
    )
    .all() as AutomationRunRow[];

  const updateRun = raw.prepare(
    `UPDATE automation_runs
     SET status = ?, finished_at = ?, duration_ms = ?, error = ?
     WHERE id = ?`
  );
  const getLockedAutomation = raw.prepare('SELECT * FROM automations WHERE locked_run_id = ?');
  const releaseAutomation = raw.prepare(
    `UPDATE automations
     SET status = CASE WHEN enabled = 1 THEN 'enabled' ELSE 'disabled' END,
         locked_run_id = NULL,
         next_run_at = ?,
         last_run_at = ?,
         last_run_status = 'failed',
         last_error = ?,
         updated_at = ?
     WHERE locked_run_id = ?`
  );

  const transaction = raw.transaction(() => {
    let releasedAutomations = 0;

    for (const row of runningRows) {
      const startedAt = row.started_at ?? row.created_at;
      updateRun.run('failed', now, Math.max(0, now - startedAt), INTERRUPTED_RUN_ERROR, row.id);
      const automationRow = getLockedAutomation.get(row.id) as AutomationRow | undefined;
      const nextRunAt = automationRow
        ? computeNextAutomationRunAt(mapAutomationRow(automationRow).trigger, now)
        : null;
      releasedAutomations += Number(
        releaseAutomation.run(nextRunAt, now, INTERRUPTED_RUN_ERROR, now, row.id).changes
      );
    }

    for (const row of queuedRows) {
      const queuedAt = row.queued_at ?? row.created_at;
      updateRun.run(
        'cancelled',
        now,
        Math.max(0, now - queuedAt),
        ORPHANED_QUEUED_RUN_ERROR,
        row.id
      );
    }

    return releasedAutomations;
  });

  return {
    failedRunningRuns: runningRows.length,
    cancelledQueuedRuns: queuedRows.length,
    releasedAutomations: transaction(),
  };
}

function insertAutomation(raw: DatabaseInstance['raw'], automation: Automation): void {
  raw
    .prepare(
      `INSERT INTO automations (
        id, name, description, project_id, enabled, status, trigger_json, action_graph_json,
        delivery_json, failure_policy_json, concurrency_json, next_run_at, locked_run_id,
        last_run_at, last_run_status, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      automation.id,
      automation.name,
      automation.description,
      automation.projectId,
      automation.enabled ? 1 : 0,
      automation.status,
      JSON.stringify(automation.trigger),
      JSON.stringify(automation.actionGraph),
      automation.delivery ? JSON.stringify(automation.delivery) : null,
      JSON.stringify(automation.failurePolicy),
      JSON.stringify(automation.concurrencyPolicy),
      automation.nextRunAt,
      automation.lockedRunId,
      automation.lastRunAt,
      automation.lastRunStatus,
      automation.lastError,
      automation.createdAt,
      automation.updatedAt
    );
}

function updateAutomation(
  raw: DatabaseInstance['raw'],
  id: string,
  mapped: Record<string, unknown>
): void {
  updateById(raw, 'automations', id, mapped);
}

function updateById(
  raw: DatabaseInstance['raw'],
  table: 'automations' | 'automation_runs',
  id: string,
  mapped: Record<string, unknown>
): void {
  const entries = Object.entries(mapped).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const setClauses = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);
  values.push(id);
  raw.prepare(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

function automationToUpdateRow(automation: Automation): Record<string, unknown> {
  return {
    name: automation.name,
    description: automation.description,
    project_id: automation.projectId,
    enabled: automation.enabled ? 1 : 0,
    status: automation.status,
    trigger_json: JSON.stringify(automation.trigger),
    action_graph_json: JSON.stringify(automation.actionGraph),
    delivery_json: automation.delivery ? JSON.stringify(automation.delivery) : null,
    failure_policy_json: JSON.stringify(automation.failurePolicy),
    concurrency_json: JSON.stringify(automation.concurrencyPolicy),
    next_run_at: automation.nextRunAt,
    locked_run_id: automation.lockedRunId,
    updated_at: automation.updatedAt,
  };
}

function mapAutomationRow(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    status: parseAutomationStatus(row.status, row.enabled === 1),
    trigger: parseJson(row.trigger_json, defaultOnceTrigger()),
    actionGraph: normalizeActionGraph(parseJson(row.action_graph_json, emptyActionGraph())),
    delivery: parseJson(row.delivery_json, null),
    failurePolicy: mergeFailurePolicy(parseJson(row.failure_policy_json, {})),
    concurrencyPolicy: mergeConcurrencyPolicy(parseJson(row.concurrency_json, {})),
    nextRunAt: row.next_run_at,
    lockedRunId: row.locked_run_id,
    lastRunAt: row.last_run_at,
    lastRunStatus: parseRunStatus(row.last_run_status),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: parseRunStatus(row.status) ?? 'failed',
    triggerReason: parseTriggerReason(row.trigger_reason),
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    error: row.error,
    artifactCount: row.artifact_count,
    deliveryStatus: parseDeliveryStatus(row.delivery_status),
    createdSessionId: row.created_session_id,
    createdAt: row.created_at,
  };
}

function mapArtifactRow(row: AutomationArtifactRow): AutomationArtifact {
  const payload = parseJson(row.payload_json, {}) as {
    mimeType?: string | null;
    content?: string | null;
    dataRef?: AutomationArtifact['dataRef'] | null;
  };
  return {
    id: row.id,
    runId: row.automation_run_id,
    sourceNodeId: row.source_node_id ?? undefined,
    kind: row.kind as AutomationArtifact['kind'],
    title: row.title,
    summary: row.summary ?? undefined,
    mimeType: payload.mimeType ?? undefined,
    content: payload.content ?? undefined,
    filePath: row.file_path ?? undefined,
    href: row.href ?? undefined,
    dataRef: payload.dataRef ?? undefined,
    createdAt: row.created_at,
  };
}

function migrateScheduledTasksToAutomations(db: DatabaseInstance): void {
  const raw = db.raw;
  const existingVersion = raw
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(AUTOMATION_MIGRATION_KEY) as { value: string } | undefined;
  if (existingVersion?.value === AUTOMATION_MIGRATION_VERSION) return;

  const transaction = raw.transaction(() => {
    const rows = raw
      .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC')
      .all() as ScheduledTaskRow[];
    for (const row of rows) {
      const existing = raw.prepare('SELECT id FROM automations WHERE id = ?').get(row.id);
      if (existing) continue;
      insertAutomation(raw, mapScheduledTaskToAutomation(db, row));
    }
    raw
      .prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)')
      .run(AUTOMATION_MIGRATION_KEY, AUTOMATION_MIGRATION_VERSION);
  });

  transaction();
}

function mapScheduledTaskToAutomation(db: DatabaseInstance, row: ScheduledTaskRow): Automation {
  const now = Date.now();
  const project = row.cwd.trim() ? db.projects?.ensureForCwd(row.cwd) : null;
  const trigger = scheduledRowToTrigger(row);
  const automationConfig = parseJson(row.automation_config, null) as {
    actionKind?: string;
    dataTaskId?: string | null;
    dataTaskName?: string | null;
    delivery?: unknown;
  } | null;
  const actionGraph = legacyAutomationConfigToActionGraph(row, automationConfig);
  const enabled = row.enabled === 1;
  return {
    id: row.id,
    name: row.title || 'Automation',
    description: null,
    projectId: project?.id ?? null,
    enabled,
    status: enabled ? 'enabled' : 'disabled',
    trigger,
    actionGraph,
    delivery: legacyDeliveryToDeliveryConfig(automationConfig?.delivery),
    failurePolicy: DEFAULT_AUTOMATION_FAILURE_POLICY,
    concurrencyPolicy: DEFAULT_AUTOMATION_CONCURRENCY_POLICY,
    nextRunAt: enabled ? (row.next_run_at ?? computeNextAutomationRunAt(trigger, now)) : null,
    lockedRunId: null,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_error ? 'failed' : row.last_run_at ? 'succeeded' : null,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduledRowToTrigger(row: ScheduledTaskRow): AutomationTrigger {
  const scheduleConfig = parseJson(row.schedule_config, null) as
    | { kind: 'daily'; times: string[] }
    | { kind: 'weekly'; weekdays: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>; times: string[] }
    | null;
  if (scheduleConfig?.kind === 'daily') {
    return { kind: 'daily', times: scheduleConfig.times, timezone: systemTimezone() };
  }
  if (scheduleConfig?.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: scheduleConfig.weekdays,
      times: scheduleConfig.times,
      timezone: systemTimezone(),
    };
  }
  if (row.repeat_every && row.repeat_unit) {
    return {
      kind: 'interval',
      every: row.repeat_every,
      unit: row.repeat_unit === 'minute' || row.repeat_unit === 'hour' ? row.repeat_unit : 'day',
      startAt: row.run_at,
      timezone: systemTimezone(),
    };
  }
  return { kind: 'once', runAt: row.run_at, timezone: systemTimezone() };
}

function legacyAutomationConfigToActionGraph(
  row: ScheduledTaskRow,
  automationConfig: {
    actionKind?: string;
    dataTaskId?: string | null;
    dataTaskName?: string | null;
  } | null
): AutomationActionGraph {
  if (automationConfig?.actionKind === 'data_task' && automationConfig.dataTaskId) {
    const dataNodeId = randomUUID();
    return {
      version: 1,
      nodes: [
        {
          id: dataNodeId,
          type: 'data.task.run',
          label: automationConfig.dataTaskName ?? 'Data task',
          enabled: true,
          config: { taskId: automationConfig.dataTaskId, outputMode: 'persisted' },
        },
      ],
      edges: [],
    };
  }

  return {
    version: 1,
    nodes: [
      {
        id: randomUUID(),
        type: 'conversation.run',
        label: '',
        enabled: true,
        config: {
          prompt: row.prompt,
          completionMode: 'fire_and_forget',
          timeoutMs: 30 * 60 * 1000,
          collectArtifacts: true,
        },
      },
    ],
    edges: [],
  };
}

function legacyDeliveryToDeliveryConfig(value: unknown): AutomationDeliveryConfig | null {
  const delivery = value as {
    enabled?: boolean;
    artifactPolicy?: 'summary' | 'links' | 'files';
    recipients?: Array<{ id: string; channel: string; target: string; enabled: boolean }>;
  } | null;
  if (!delivery?.enabled) return DEFAULT_AUTOMATION_DELIVERY;
  return {
    enabled: true,
    artifactPolicy:
      delivery.artifactPolicy === 'files' ? 'attachments' : (delivery.artifactPolicy ?? 'links'),
    failureMessage: DEFAULT_AUTOMATION_DELIVERY.failureMessage,
    channels:
      delivery.recipients?.map((recipient) => ({
        id: recipient.id,
        type:
          recipient.channel === 'email' || recipient.channel === 'webhook'
            ? recipient.channel
            : 'feishu',
        enabled: recipient.enabled !== false,
        recipient: recipient.target,
        config: {},
      })) ?? [],
  };
}

function matchesAutomationQuery(automation: Automation, query: AutomationListQuery): boolean {
  if (query.status && query.status !== 'all' && automation.status !== query.status) return false;
  if (query.projectId !== undefined && automation.projectId !== query.projectId) return false;
  const keyword = query.query?.trim().toLowerCase();
  if (!keyword) return true;
  return [automation.name, automation.description ?? ''].some((value) =>
    value.toLowerCase().includes(keyword)
  );
}

function normalizeActionGraph(graph: AutomationActionGraph): AutomationActionGraph {
  return {
    version: 1,
    nodes: Array.isArray(graph?.nodes)
      ? graph.nodes.map((node) => ({
          id: node.id || randomUUID(),
          type: node.type || 'conversation.run',
          label: node.label,
          enabled: node.enabled !== false,
          config: node.config && typeof node.config === 'object' ? node.config : {},
          failurePolicy: node.failurePolicy,
          inputBindings: node.inputBindings,
        }))
      : [],
    edges: Array.isArray(graph?.edges)
      ? graph.edges.map((edge) => ({
          id: edge.id || randomUUID(),
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          outputKey: edge.outputKey,
          inputKey: edge.inputKey,
        }))
      : [],
  };
}

function mergeFailurePolicy(
  partial?: Partial<AutomationFailurePolicy>,
  base: AutomationFailurePolicy = DEFAULT_AUTOMATION_FAILURE_POLICY
): AutomationFailurePolicy {
  return {
    disableOnFailure: partial?.disableOnFailure ?? base.disableOnFailure,
    retry: {
      enabled: partial?.retry?.enabled ?? base.retry.enabled,
      maxAttempts: partial?.retry?.maxAttempts ?? base.retry.maxAttempts,
      backoffMs: partial?.retry?.backoffMs ?? base.retry.backoffMs,
    },
    notifyOnFailure: partial?.notifyOnFailure ?? base.notifyOnFailure,
  };
}

function mergeConcurrencyPolicy(
  partial?: Partial<AutomationConcurrencyPolicy>,
  base: AutomationConcurrencyPolicy = DEFAULT_AUTOMATION_CONCURRENCY_POLICY
): AutomationConcurrencyPolicy {
  return {
    overlapPolicy: partial?.overlapPolicy ?? base.overlapPolicy,
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function emptyActionGraph(): AutomationActionGraph {
  return { version: 1, nodes: [], edges: [] };
}

function defaultOnceTrigger(): AutomationTrigger {
  return { kind: 'once', runAt: Date.now() + 5 * 60 * 1000, timezone: systemTimezone() };
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function parseAutomationStatus(value: string, enabled: boolean): Automation['status'] {
  if (value === 'paused' || value === 'running' || value === 'failed') return value;
  return enabled ? 'enabled' : 'disabled';
}

function parseRunStatus(value: string | null): AutomationRunStatus | null {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return null;
}

function parseTriggerReason(value: string): AutomationTriggerReason {
  if (
    value === 'manual' ||
    value === 'retry' ||
    value === 'queued_overlap' ||
    value === 'file_change'
  ) {
    return value;
  }
  return 'timer';
}

function parseDeliveryStatus(value: string | null): AutomationRun['deliveryStatus'] {
  if (
    value === 'pending' ||
    value === 'succeeded' ||
    value === 'partial' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value;
  }
  return null;
}
