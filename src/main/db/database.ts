import {
  getAutomationTableBindings,
  tableBindingKey,
} from '../../shared/automation/table-bindings';
import type { AutomationTableBinding } from '../../shared/automation/types';
/**
 * SQLite database implementation using better-sqlite3
 * Provides persistent storage for sessions, messages, and other data
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, statSync, renameSync, openSync, readSync, closeSync } from 'fs';
import { randomUUID } from 'crypto';
import { log, logError, logWarn } from '../utils/logger';
import { SCRIPT_VERSIONS_TABLE_SQL } from '../automation/script-packages/version-store';

export interface DatabaseInstance {
  // Raw database access (for advanced queries)
  raw: Database.Database;

  // Session operations
  sessions: {
    create: (session: SessionRow) => void;
    update: (id: string, updates: Partial<SessionRow>) => void;
    get: (id: string) => SessionRow | undefined;
    getAll: () => SessionRow[];
    delete: (id: string) => void;
  };

  projects?: {
    create: (project: ProjectRow) => void;
    update: (id: string, updates: Partial<ProjectRow>) => ProjectRow | undefined;
    get: (id: string) => ProjectRow | undefined;
    getByPathKey: (pathKey: string) => ProjectRow | undefined;
    getAll: () => ProjectRow[];
    ensureForCwd: (cwd: string, name?: string | null) => ProjectRow;
    delete: (id: string) => void;
  };

  // Message operations
  messages: {
    create: (message: MessageRow) => void;
    update: (id: string, updates: Partial<Pick<MessageRow, 'execution_time_ms'>>) => void;
    getBySessionId: (sessionId: string) => MessageRow[];
    delete: (id: string) => void;
    deleteBySessionId: (sessionId: string) => void;
  };

  /** Skill usage log for the 近 7 天调用 counter (optional for lightweight test doubles). */
  skillInvocations?: {
    record: (entry: {
      skillName: string;
      sessionId: string | null;
      source: string;
      invokedAt: number;
    }) => void;
    countSince: (sinceMs: number) => Record<string, number>;
  };

  traceSteps: {
    create: (step: TraceStepRow) => void;
    update: (id: string, updates: Partial<TraceStepRow>) => boolean;
    getBySessionId: (sessionId: string) => TraceStepRow[];
    deleteBySessionId: (sessionId: string) => void;
  };

  scheduledTasks: {
    create: (task: ScheduledTaskRow) => void;
    update: (id: string, updates: Partial<ScheduledTaskRow>) => void;
    get: (id: string) => ScheduledTaskRow | undefined;
    getAll: () => ScheduledTaskRow[];
    delete: (id: string) => void;
  };

  // For compatibility with old interface
  prepare: (sql: string) => Database.Statement;
  exec: (sql: string) => void;
  pragma: (pragma: string) => unknown;
  close: () => void;
}

export interface SessionRow {
  id: string;
  title: string;
  agent_session_id: string | null;
  openai_thread_id: string | null;
  status: string;
  project_id?: string | null;
  project_name?: string | null;
  cwd: string | null;
  mounted_paths: string; // JSON string
  allowed_tools: string; // JSON string
  memory_enabled: number;
  model: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  name: string | null;
  cwd: string;
  path_key: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string; // JSON string
  timestamp: number;
  token_usage: string | null; // JSON string
  execution_time_ms: number | null;
}

export interface TraceStepRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  parent_id: string | null;
  type: string;
  status: string;
  title: string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null; // JSON string
  tool_output: string | null;
  tool_output_truncated: number | null;
  tool_output_length: number | null;
  result_message_id: string | null;
  is_error: number | null;
  error_json: string | null;
  permission_json: string | null;
  outcome: string | null;
  metrics_json: string | null;
  timestamp: number;
  ended_at: number | null;
  duration: number | null;
}

export interface ScheduledTaskRow {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  automation_config: string | null;
  run_at: number;
  next_run_at: number | null;
  schedule_config: string | null;
  repeat_every: number | null;
  repeat_unit: string | null;
  enabled: number;
  last_run_at: number | null;
  last_run_session_id: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

let db: DatabaseInstance | null = null;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

export function normalizeProjectPathKey(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) {
    return '';
  }

  let normalized = trimmed.replace(/\\/g, '/');
  if (/^\/+$/.test(normalized)) {
    return '/';
  }

  normalized = normalized.replace(/\/+$/g, '');
  if (!normalized) {
    return '';
  }

  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function buildBackupPath(targetPath: string, suffix: string): string {
  return `${targetPath}.${suffix}-${Date.now()}`;
}

function moveIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }
  renameSync(sourcePath, destinationPath);
}

function ensureDirectory(pathToEnsure: string, label: string): void {
  if (!existsSync(pathToEnsure)) {
    mkdirSync(pathToEnsure, { recursive: true });
    return;
  }

  const stats = statSync(pathToEnsure);
  if (stats.isDirectory()) {
    return;
  }

  const backupPath = buildBackupPath(pathToEnsure, 'backup');
  renameSync(pathToEnsure, backupPath);
  logWarn(`[Database] ${label} path is not a directory, moved to backup:`, backupPath);
  mkdirSync(pathToEnsure, { recursive: true });
}

function isSqliteFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead < SQLITE_HEADER.length) {
      return false;
    }
    return buffer.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function prepareDatabaseDirectory(userDataPath: string): string {
  ensureDirectory(userDataPath, 'userData');

  const dbDir = join(userDataPath, 'data');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    return dbDir;
  }

  const stats = statSync(dbDir);
  if (stats.isDirectory()) {
    return dbDir;
  }

  const preservedPath = buildBackupPath(dbDir, isSqliteFile(dbDir) ? 'legacy-db' : 'conflict');
  renameSync(dbDir, preservedPath);
  mkdirSync(dbDir, { recursive: true });

  if (isSqliteFile(preservedPath)) {
    const recoveredDbPath = join(dbDir, 'cowork.db');
    renameSync(preservedPath, recoveredDbPath);
    moveIfExists(`${dbDir}-wal`, `${recoveredDbPath}-wal`);
    moveIfExists(`${dbDir}-shm`, `${recoveredDbPath}-shm`);
    logWarn('[Database] Recovered legacy SQLite file into:', recoveredDbPath);
  } else {
    logWarn(
      '[Database] Database directory path was occupied by a file, moved to backup:',
      preservedPath
    );
  }

  return dbDir;
}

function ensureProjectForCwdInDatabase(
  database: Database.Database,
  cwd: string,
  name?: string | null
): ProjectRow {
  const trimmedCwd = cwd.trim();
  if (!trimmedCwd) {
    throw new Error('Project cwd cannot be empty');
  }

  const pathKey = normalizeProjectPathKey(trimmedCwd);
  if (!pathKey) {
    throw new Error('Project cwd cannot be empty');
  }

  const existing = database
    .prepare('SELECT * FROM projects WHERE path_key = ? LIMIT 1')
    .get(pathKey) as ProjectRow | undefined;
  if (existing) {
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    if (existing.cwd !== trimmedCwd || nextName !== existing.name) {
      database
        .prepare('UPDATE projects SET cwd = ?, name = ?, updated_at = ? WHERE id = ?')
        .run(trimmedCwd, nextName, Date.now(), existing.id);
      return database.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id) as ProjectRow;
    }
    return existing;
  }

  const now = Date.now();
  const project: ProjectRow = {
    id: randomUUID(),
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    cwd: trimmedCwd,
    path_key: pathKey,
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(
      'INSERT INTO projects (id, name, cwd, path_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      project.id,
      project.name,
      project.cwd,
      project.path_key,
      project.created_at,
      project.updated_at
    );
  return project;
}

function migrateLegacySessionProjects(database: Database.Database): void {
  const rows = database
    .prepare(
      "SELECT id, cwd FROM sessions WHERE project_id IS NULL AND cwd IS NOT NULL AND TRIM(cwd) <> ''"
    )
    .all() as Array<{ id: string; cwd: string }>;

  if (rows.length === 0) {
    return;
  }

  const updateSessionProject = database.prepare(
    'UPDATE sessions SET project_id = ?, cwd = NULL WHERE id = ?'
  );

  database.transaction(() => {
    for (const row of rows) {
      const project = ensureProjectForCwdInDatabase(database, row.cwd);
      updateSessionProject.run(project.id, row.id);
    }
  })();

  log('[Database] Migrated legacy session workdirs into projects:', rows.length);
}

/**
 * Get the database file path
 */
function getDatabasePath(): string {
  // Use electron's userData path for persistent storage
  const userDataPath = app.getPath('userData');
  const dbDir = prepareDatabaseDirectory(userDataPath);
  const dbPath = join(dbDir, 'cowork.db');

  if (existsSync(dbPath) && statSync(dbPath).isDirectory()) {
    const backupPath = buildBackupPath(dbPath, 'dir-backup');
    renameSync(dbPath, backupPath);
    logWarn('[Database] Database file path is a directory, moved to backup:', backupPath);
  }

  return dbPath;
}

interface MainSchemaMigration {
  readonly version: number;
  readonly name: string;
  up(database: Database.Database): void;
}

const MAIN_SCHEMA_MIGRATION_LEDGER = 'app_schema_migrations';

/**
 * Baseline schema for the main database. Runs once (recorded in the
 * `app_schema_migrations` ledger), not on every launch. All statements are
 * idempotent so pre-ledger databases upgrade in place.
 */
function createBaselineMainSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at
    ON projects(updated_at DESC)
  `);

  // Create sessions table
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      project_id TEXT,
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  ensureColumn(database, 'sessions', 'openai_thread_id', 'openai_thread_id TEXT');
  ensureColumn(database, 'sessions', 'model', 'model TEXT');
  ensureColumn(database, 'sessions', 'project_id', 'project_id TEXT');
  migrateLegacySessionProjects(database);

  // Create messages table
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  ensureColumn(database, 'messages', 'execution_time_ms', 'execution_time_ms INTEGER');

  // One-shot model calls do not belong to an interactive chat session. Keep
  // their usage in a dedicated audit table so data-pipeline generation and repair
  // costs can be queried without creating synthetic messages.
  database.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage_events (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      phase TEXT NOT NULL,
      pipeline_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL,
      cost_total REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      stop_reason TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_events_generation
    ON llm_usage_events(generation_id, created_at)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_events_pipeline
    ON llm_usage_events(pipeline_id, created_at DESC)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_events_feature
    ON llm_usage_events(feature, created_at DESC)
  `);

  // Create trace steps table
  database.exec(`
    CREATE TABLE IF NOT EXISTS trace_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      tool_output_truncated INTEGER,
      tool_output_length INTEGER,
      result_message_id TEXT,
      is_error INTEGER,
      error_json TEXT,
      permission_json TEXT,
      outcome TEXT,
      metrics_json TEXT,
      timestamp INTEGER NOT NULL,
      ended_at INTEGER,
      duration INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  ensureColumn(database, 'trace_steps', 'turn_id', 'turn_id TEXT');
  ensureColumn(database, 'trace_steps', 'parent_id', 'parent_id TEXT');
  ensureColumn(database, 'trace_steps', 'tool_output_truncated', 'tool_output_truncated INTEGER');
  ensureColumn(database, 'trace_steps', 'tool_output_length', 'tool_output_length INTEGER');
  ensureColumn(database, 'trace_steps', 'result_message_id', 'result_message_id TEXT');
  ensureColumn(database, 'trace_steps', 'error_json', 'error_json TEXT');
  ensureColumn(database, 'trace_steps', 'permission_json', 'permission_json TEXT');
  ensureColumn(database, 'trace_steps', 'outcome', 'outcome TEXT');
  ensureColumn(database, 'trace_steps', 'metrics_json', 'metrics_json TEXT');
  ensureColumn(database, 'trace_steps', 'ended_at', 'ended_at INTEGER');

  // Create index for faster message queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id 
    ON messages(session_id)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp 
    ON messages(session_id, timestamp)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_session_id
    ON trace_steps(session_id)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_timestamp
    ON trace_steps(session_id, timestamp)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_session_turn
    ON trace_steps(session_id, turn_id, timestamp)
  `);

  // Create memory_entries table (for future use)
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Create skills table (for future use)
  database.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL,
      automation_config TEXT,
      run_at INTEGER NOT NULL,
      next_run_at INTEGER,
      schedule_config TEXT,
      repeat_every INTEGER,
      repeat_unit TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  ensureColumn(database, 'scheduled_tasks', 'schedule_config', 'schedule_config TEXT');
  ensureColumn(database, 'scheduled_tasks', 'automation_config', 'automation_config TEXT');

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
    ON scheduled_tasks(enabled, next_run_at)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      trigger_json TEXT NOT NULL,
      action_graph_json TEXT NOT NULL,
      delivery_json TEXT,
      failure_policy_json TEXT NOT NULL,
      concurrency_json TEXT NOT NULL,
      next_run_at INTEGER,
      locked_run_id TEXT,
      last_run_at INTEGER,
      last_run_status TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_automations_next_run
    ON automations(enabled, next_run_at)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_reason TEXT NOT NULL,
      queued_at INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      duration_ms INTEGER,
      error TEXT,
      artifact_count INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT,
      created_session_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
    ON automation_runs(automation_id, started_at DESC)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_artifacts (
      id TEXT PRIMARY KEY,
      automation_run_id TEXT NOT NULL,
      source_node_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      payload_json TEXT,
      file_path TEXT,
      href TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (automation_run_id) REFERENCES automation_runs(id) ON DELETE CASCADE
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/**
 * Versioned main-database migrations. Each entry runs exactly once, inside a
 * transaction, and is recorded in `app_schema_migrations`. Versions are
 * permanent: append new migrations, never edit or renumber applied ones.
 *
 * When the on-disk schema is newer than this build, the connection is opened
 * read-only (`PRAGMA query_only`) so an older binary cannot write into a
 * schema it does not understand.
 */
export const MAIN_SCHEMA_MIGRATIONS: readonly MainSchemaMigration[] = [
  {
    version: 1,
    name: 'baseline_schema',
    up: (database) => createBaselineMainSchema(database),
  },
  {
    version: 2,
    name: 'rename_session_agent_id',
    up: (database) => {
      const columns = database
        .prepare("SELECT name FROM pragma_table_info('sessions')")
        .all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      if (names.has('claude_session_id') && !names.has('agent_session_id')) {
        database.exec('ALTER TABLE sessions RENAME COLUMN claude_session_id TO agent_session_id');
      }
    },
  },
  {
    version: 3,
    name: 'automation_output_bindings',
    up: (database) => {
      database.exec(
        "ALTER TABLE automations ADD COLUMN output_bindings_json TEXT NOT NULL DEFAULT '[]'"
      );
    },
  },
  {
    version: 4,
    name: 'automation_groups',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS automation_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_index INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        ALTER TABLE automations ADD COLUMN group_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_automations_group ON automations(group_id);
      `);
    },
  },
  {
    version: 5,
    name: 'automation_table_bindings',
    up: (database) => {
      database.exec('ALTER TABLE automations ADD COLUMN table_bindings_json TEXT');
    },
  },
  {
    version: 6,
    name: 'automation_execution_summary',
    up: (database) => {
      database.exec('ALTER TABLE automation_runs ADD COLUMN execution_summary_json TEXT');
    },
  },
  {
    version: 7,
    name: 'shared_table_automation_policies',
    up: (database) => {
      database.exec(`CREATE TABLE automation_table_policies (
        table_kind TEXT NOT NULL, table_id TEXT NOT NULL,
        run_on_change INTEGER NOT NULL, run_on_trigger INTEGER NOT NULL,
        PRIMARY KEY (table_kind, table_id)
      )`);
      const policies = new Map<string, AutomationTableBinding>();
      const rows = database
        .prepare(
          'SELECT action_graph_json, table_bindings_json, output_bindings_json FROM automations'
        )
        .all() as Array<{
        action_graph_json: string;
        table_bindings_json: string | null;
        output_bindings_json: string;
      }>;
      for (const row of rows) {
        const bindings = getAutomationTableBindings({
          actionGraph: JSON.parse(row.action_graph_json),
          tableBindings:
            row.table_bindings_json == null ? undefined : JSON.parse(row.table_bindings_json),
          outputBindings: JSON.parse(row.output_bindings_json),
        });
        for (const binding of bindings) {
          const previous = policies.get(tableBindingKey(binding));
          // Conflicting legacy settings migrate conservatively: do not enable
          // a trigger that was explicitly off on an existing association.
          policies.set(tableBindingKey(binding), {
            ...binding,
            runOnChange: binding.runOnChange && (previous?.runOnChange ?? true),
            runOnTrigger: binding.runOnTrigger && (previous?.runOnTrigger ?? true),
          });
        }
      }
      const insert = database.prepare('INSERT INTO automation_table_policies VALUES (?, ?, ?, ?)');
      for (const policy of policies.values())
        insert.run(
          policy.kind,
          policy.tableId,
          Number(policy.runOnChange),
          Number(policy.runOnTrigger)
        );
    },
  },
  {
    version: 8,
    name: 'skill_invocations',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS skill_invocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_name TEXT NOT NULL,
          session_id TEXT,
          source TEXT NOT NULL,
          invoked_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_skill_invocations_time ON skill_invocations(invoked_at);
      `);
    },
  },
  {
    version: 9,
    name: 'script_package_versions',
    up: (database) => {
      database.exec(SCRIPT_VERSIONS_TABLE_SQL);
    },
  },
];

export const MAIN_SCHEMA_VERSION =
  MAIN_SCHEMA_MIGRATIONS[MAIN_SCHEMA_MIGRATIONS.length - 1].version;

export function migrateMainSchema(database: Database.Database): void {
  try {
    // Detect a newer-version database BEFORE writing anything: reading
    // sqlite_master and the ledger are pure reads, so an older binary leaves
    // a foreign-version file untouched.
    const ledgerExists = database
      .prepare(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
      .get(MAIN_SCHEMA_MIGRATION_LEDGER) as { found: number } | undefined;

    if (ledgerExists) {
      const rows = database
        .prepare(`SELECT version FROM ${MAIN_SCHEMA_MIGRATION_LEDGER}`)
        .all() as Array<{ version: number }>;
      const maxApplied = Math.max(0, ...rows.map((row) => Number(row.version)));
      if (maxApplied > MAIN_SCHEMA_VERSION) {
        logWarn('[Database] Schema is newer than this build — opening read-only:', {
          databaseVersion: maxApplied,
          supportedVersion: MAIN_SCHEMA_VERSION,
        });
        database.pragma('query_only = ON');
        return;
      }
    }

    // Enable WAL mode for better performance (a write — only for schemas we own)
    database.pragma('journal_mode = WAL');

    database.exec(`
    CREATE TABLE IF NOT EXISTS ${MAIN_SCHEMA_MIGRATION_LEDGER} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

    const applied = new Set(
      (
        database
          .prepare(`SELECT version FROM ${MAIN_SCHEMA_MIGRATION_LEDGER} ORDER BY version ASC`)
          .all() as Array<{ version: number }>
      ).map((row) => Number(row.version))
    );

    const recordMigration = database.prepare(
      `INSERT INTO ${MAIN_SCHEMA_MIGRATION_LEDGER} (version, name, applied_at) VALUES (?, ?, ?)`
    );

    for (const migration of MAIN_SCHEMA_MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }
      database.transaction(() => {
        migration.up(database);
        recordMigration.run(migration.version, migration.name, Date.now());
      })();
      applied.add(migration.version);
      log('[Database] Applied schema migration:', {
        version: migration.version,
        name: migration.name,
      });
    }
  } catch (error) {
    logError('[Database] Schema initialization failed:', error);
    throw error;
  }
}

function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

const ALLOWED_COLUMN_TYPES = [
  'TEXT NOT NULL DEFAULT',
  'INTEGER DEFAULT',
  'TEXT',
  'INTEGER',
  'REAL',
  'BLOB',
] as const;

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  validateIdentifier(table);
  validateIdentifier(column);

  // Reconstruct definition from validated parts to prevent SQL injection.
  // The definition format is: "<column> <TYPE_SUFFIX>" — extract the type
  // suffix that follows the column name and validate it against an allowlist.
  const prefix = column + ' ';
  if (!definition.startsWith(prefix)) {
    throw new Error(`Column definition must start with column name: ${definition}`);
  }
  const typeSuffix = definition.slice(prefix.length).trim().toUpperCase();
  const matchedType = ALLOWED_COLUMN_TYPES.find(
    (t) => typeSuffix === t || typeSuffix.startsWith(t + ' ')
  );
  if (!matchedType) {
    throw new Error(`Unsupported column type in definition: ${typeSuffix}`);
  }
  // Use only the validated column name + original (non-uppercased) suffix so
  // that default value tokens are preserved exactly as authored.
  const originalSuffix = definition.slice(prefix.length).trim();
  const safeDefinition = `${column} ${originalSuffix}`;

  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = rows.some((row) => row.name === column);
  if (exists) {
    return;
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${safeDefinition}`);
}

/**
 * Initialize the database
 */
export function initDatabase(): DatabaseInstance {
  if (db) return db;

  const dbPath = getDatabasePath();
  log('[Database] Opening database at:', dbPath);

  let rawDb: Database.Database;
  try {
    rawDb = new Database(dbPath);
  } catch (error) {
    logError('[Database] Failed to open database at:', dbPath, error);
    throw error;
  }

  // Enable foreign keys
  rawDb.pragma('foreign_keys = ON');

  // Apply versioned schema migrations (read-only open when the on-disk
  // schema is newer than this build)
  migrateMainSchema(rawDb);

  // Prepare statements for better performance
  const insertSession = rawDb.prepare(`
    INSERT OR REPLACE INTO sessions
    (id, title, agent_session_id, openai_thread_id, status, project_id, cwd, mounted_paths, allowed_tools, memory_enabled, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Note: Dynamic update queries are built in sessions.update() for flexibility
  // const updateSessionStmt = rawDb.prepare(`
  //   UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
  // `);

  const getSessionStmt = rawDb.prepare(`
    SELECT
      s.id,
      s.title,
      s.agent_session_id,
      s.openai_thread_id,
      s.status,
      s.project_id,
      p.name AS project_name,
      COALESCE(p.cwd, s.cwd) AS cwd,
      s.mounted_paths,
      s.allowed_tools,
      s.memory_enabled,
      s.model,
      s.created_at,
      s.updated_at
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `);

  const getAllSessionsStmt = rawDb.prepare(`
    SELECT
      s.id,
      s.title,
      s.agent_session_id,
      s.openai_thread_id,
      s.status,
      s.project_id,
      p.name AS project_name,
      COALESCE(p.cwd, s.cwd) AS cwd,
      s.mounted_paths,
      s.allowed_tools,
      s.memory_enabled,
      s.model,
      s.created_at,
      s.updated_at
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    ORDER BY s.updated_at DESC
  `);

  const deleteSessionStmt = rawDb.prepare(`
    DELETE FROM sessions WHERE id = ?
  `);

  const insertProject = rawDb.prepare(`
    INSERT OR REPLACE INTO projects (id, name, cwd, path_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const getProjectStmt = rawDb.prepare(`
    SELECT * FROM projects WHERE id = ?
  `);

  const getProjectByPathKeyStmt = rawDb.prepare(`
    SELECT * FROM projects WHERE path_key = ?
  `);

  const getAllProjectsStmt = rawDb.prepare(`
    SELECT * FROM projects ORDER BY updated_at DESC
  `);

  const deleteProjectStmt = rawDb.prepare(`
    DELETE FROM projects WHERE id = ?
  `);

  const insertMessage = rawDb.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp, token_usage, execution_time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getMessagesBySessionStmt = rawDb.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
  `);

  const updateMessageStmt = rawDb.prepare(`
    UPDATE messages SET execution_time_ms = ? WHERE id = ?
  `);

  const deleteMessageStmt = rawDb.prepare(`
    DELETE FROM messages WHERE id = ?
  `);

  const deleteMessagesBySessionStmt = rawDb.prepare(`
    DELETE FROM messages WHERE session_id = ?
  `);

  const insertTraceStep = rawDb.prepare(`
    INSERT OR REPLACE INTO trace_steps (
      id, session_id, turn_id, parent_id, type, status, title, content,
      tool_name, tool_input, tool_output, tool_output_truncated, tool_output_length,
      result_message_id, is_error, error_json, permission_json, outcome, metrics_json,
      timestamp, ended_at, duration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getTraceStepsBySessionStmt = rawDb.prepare(`
    SELECT * FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC
  `);

  const deleteTraceStepsBySessionStmt = rawDb.prepare(`
    DELETE FROM trace_steps WHERE session_id = ?
  `);

  const insertScheduledTask = rawDb.prepare(`
    INSERT OR REPLACE INTO scheduled_tasks (
      id, title, prompt, cwd, automation_config, run_at, next_run_at, schedule_config, repeat_every, repeat_unit, enabled, last_run_at, last_run_session_id, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getScheduledTaskStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks WHERE id = ?
  `);

  const getAllScheduledTasksStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks ORDER BY created_at ASC
  `);

  const deleteScheduledTaskStmt = rawDb.prepare(`
    DELETE FROM scheduled_tasks WHERE id = ?
  `);

  const skillInvocationsReady =
    (
      rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_invocations'")
        .get() as { name?: string } | undefined
    )?.name === 'skill_invocations';
  const insertSkillInvocation = skillInvocationsReady
    ? rawDb.prepare(
        'INSERT INTO skill_invocations (skill_name, session_id, source, invoked_at) VALUES (?, ?, ?, ?)'
      )
    : null;
  const countSkillInvocations = skillInvocationsReady
    ? rawDb.prepare(
        'SELECT skill_name AS name, COUNT(*) AS count FROM skill_invocations WHERE invoked_at >= ? GROUP BY skill_name'
      )
    : null;

  db = {
    raw: rawDb,

    skillInvocations: {
      record: (entry) => {
        try {
          insertSkillInvocation?.run(
            entry.skillName,
            entry.sessionId,
            entry.source,
            entry.invokedAt
          );
        } catch {
          // Read-only (newer schema) or locked DB: usage stats are best-effort.
        }
      },
      countSince: (sinceMs) => {
        const out: Record<string, number> = {};
        for (const row of (countSkillInvocations?.all(sinceMs) ?? []) as Array<{
          name: string;
          count: number;
        }>) {
          out[row.name] = row.count;
        }
        return out;
      },
    },

    projects: {
      create: (project: ProjectRow) => {
        insertProject.run(
          project.id,
          project.name,
          project.cwd,
          project.path_key || normalizeProjectPathKey(project.cwd),
          project.created_at,
          project.updated_at
        );
      },

      update: (id: string, updates: Partial<ProjectRow>): ProjectRow | undefined => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value === undefined || key === 'id' || key === 'created_at') {
            continue;
          }
          validateIdentifier(key);
          setClauses.push(`${key} = ?`);
          values.push(key === 'name' && typeof value === 'string' ? value.trim() || null : value);

          if (key === 'cwd' && typeof value === 'string') {
            setClauses.push('path_key = ?');
            values.push(normalizeProjectPathKey(value));
          }
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = ?');
          values.push(Date.now());
          values.push(id);

          const sql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`;
          rawDb.prepare(sql).run(...values);
        }

        return getProjectStmt.get(id) as ProjectRow | undefined;
      },

      get: (id: string): ProjectRow | undefined => {
        return getProjectStmt.get(id) as ProjectRow | undefined;
      },

      getByPathKey: (pathKey: string): ProjectRow | undefined => {
        return getProjectByPathKeyStmt.get(pathKey) as ProjectRow | undefined;
      },

      getAll: (): ProjectRow[] => {
        return getAllProjectsStmt.all() as ProjectRow[];
      },

      ensureForCwd: (cwd: string, name?: string | null): ProjectRow => {
        return ensureProjectForCwdInDatabase(rawDb, cwd, name);
      },

      delete: (id: string) => {
        deleteProjectStmt.run(id);
      },
    },

    sessions: {
      create: (session: SessionRow) => {
        insertSession.run(
          session.id,
          session.title,
          session.agent_session_id,
          session.openai_thread_id,
          session.status,
          session.project_id ?? null,
          session.cwd,
          session.mounted_paths,
          session.allowed_tools,
          session.memory_enabled,
          session.model,
          session.created_at,
          session.updated_at
        );
      },

      update: (id: string, updates: Partial<SessionRow>) => {
        // Columns that must never be overwritten after insert
        const IMMUTABLE_COLUMNS = new Set(['id', 'created_at']);

        // Build dynamic update query
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            if (IMMUTABLE_COLUMNS.has(key)) continue;
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        // Always update updated_at
        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      get: (id: string): SessionRow | undefined => {
        return getSessionStmt.get(id) as SessionRow | undefined;
      },

      getAll: (): SessionRow[] => {
        return getAllSessionsStmt.all() as SessionRow[];
      },

      delete: (id: string) => {
        // Messages will be deleted automatically due to ON DELETE CASCADE
        deleteSessionStmt.run(id);
      },
    },

    messages: {
      create: (message: MessageRow) => {
        insertMessage.run(
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.timestamp,
          message.token_usage,
          message.execution_time_ms ?? null
        );
      },

      update: (id: string, updates: Partial<Pick<MessageRow, 'execution_time_ms'>>) => {
        if (updates.execution_time_ms !== undefined) {
          updateMessageStmt.run(updates.execution_time_ms, id);
        }
      },

      getBySessionId: (sessionId: string): MessageRow[] => {
        return getMessagesBySessionStmt.all(sessionId) as MessageRow[];
      },

      delete: (id: string) => {
        deleteMessageStmt.run(id);
      },

      deleteBySessionId: (sessionId: string) => {
        deleteMessagesBySessionStmt.run(sessionId);
      },
    },

    traceSteps: {
      create: (step: TraceStepRow) => {
        insertTraceStep.run(
          step.id,
          step.session_id,
          step.turn_id,
          step.parent_id,
          step.type,
          step.status,
          step.title,
          step.content,
          step.tool_name,
          step.tool_input,
          step.tool_output,
          step.tool_output_truncated,
          step.tool_output_length,
          step.result_message_id,
          step.is_error,
          step.error_json,
          step.permission_json,
          step.outcome,
          step.metrics_json,
          step.timestamp,
          step.ended_at,
          step.duration
        );
      },

      update: (id: string, updates: Partial<TraceStepRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return false;

        values.push(id);
        const sql = `UPDATE trace_steps SET ${setClauses.join(', ')} WHERE id = ?`;
        return rawDb.prepare(sql).run(...values).changes > 0;
      },

      getBySessionId: (sessionId: string): TraceStepRow[] => {
        return getTraceStepsBySessionStmt.all(sessionId) as TraceStepRow[];
      },

      deleteBySessionId: (sessionId: string) => {
        deleteTraceStepsBySessionStmt.run(sessionId);
      },
    },

    scheduledTasks: {
      create: (task: ScheduledTaskRow) => {
        insertScheduledTask.run(
          task.id,
          task.title,
          task.prompt,
          task.cwd,
          task.automation_config,
          task.run_at,
          task.next_run_at,
          task.schedule_config,
          task.repeat_every,
          task.repeat_unit,
          task.enabled,
          task.last_run_at,
          task.last_run_session_id,
          task.last_error,
          task.created_at,
          task.updated_at
        );
      },

      update: (id: string, updates: Partial<ScheduledTaskRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      get: (id: string): ScheduledTaskRow | undefined => {
        return getScheduledTaskStmt.get(id) as ScheduledTaskRow | undefined;
      },

      getAll: (): ScheduledTaskRow[] => {
        return getAllScheduledTasksStmt.all() as ScheduledTaskRow[];
      },

      delete: (id: string) => {
        deleteScheduledTaskStmt.run(id);
      },
    },

    // Compatibility layer for old interface
    prepare: (sql: string) => rawDb.prepare(sql),
    exec: (sql: string) => rawDb.exec(sql),
    pragma: (pragma: string) => rawDb.pragma(pragma),
    close: () => {
      rawDb.close();
      db = null;
    },
  };

  log('[Database] SQLite database initialized successfully');
  return db!;
}

/**
 * Get the existing database instance
 */
export function getDatabase(): DatabaseInstance {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log('[Database] Database closed');
  }
}
