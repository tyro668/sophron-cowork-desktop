import type Database from 'better-sqlite3';
import type {
  ScriptPackageVersion,
  ScriptRuntime,
  ScriptVersionSource,
  ScriptVersionStatus,
} from '../../../shared/automation/script-package';

/** Version metadata row; the code itself lives in the package's git repo (`commit`). */
export interface ScriptVersionRecord extends Omit<ScriptPackageVersion, 'diff' | 'commit'> {
  packageId: string;
  commit: string;
  /** Automation whose failure produced this version (AI repair). */
  automationId?: string;
}

export interface ScriptVersionStore {
  list(packageId: string): ScriptVersionRecord[];
  insert(record: ScriptVersionRecord): void;
  update(packageId: string, version: number, patch: Partial<ScriptVersionRecord>): void;
  delete(packageId: string, version: number): void;
  /** Every package with version rows (including ones whose folder is gone). */
  packageIds(): string[];
  deletePackage(packageId: string): void;
}

export class MemoryScriptVersionStore implements ScriptVersionStore {
  private readonly rows: ScriptVersionRecord[] = [];
  list(packageId: string) {
    return this.rows
      .filter((row) => row.packageId === packageId)
      .map((row) => ({ ...row }))
      .sort((a, b) => a.version - b.version);
  }
  insert(record: ScriptVersionRecord) {
    this.rows.push({ ...record });
  }
  update(packageId: string, version: number, patch: Partial<ScriptVersionRecord>) {
    const row = this.rows.find((item) => item.packageId === packageId && item.version === version);
    if (row) Object.assign(row, patch);
  }
  delete(packageId: string, version: number) {
    const index = this.rows.findIndex(
      (item) => item.packageId === packageId && item.version === version
    );
    if (index >= 0) this.rows.splice(index, 1);
  }
  packageIds() {
    return [...new Set(this.rows.map((row) => row.packageId))];
  }
  deletePackage(packageId: string) {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.rows[index].packageId === packageId) this.rows.splice(index, 1);
    }
  }
}

export const SCRIPT_VERSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS script_package_versions (
    package_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    commit_oid TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    entry TEXT NOT NULL,
    runtime TEXT NOT NULL,
    rule_prompt TEXT,
    base_version INTEGER,
    session_id TEXT,
    automation_id TEXT,
    rows INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    PRIMARY KEY (package_id, version)
  );
`;

interface Row {
  package_id: string;
  version: number;
  commit_oid: string;
  status: string;
  source: string;
  entry: string;
  runtime: string;
  rule_prompt: string | null;
  base_version: number | null;
  session_id: string | null;
  automation_id: string | null;
  rows: number | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

const COLUMNS: Record<keyof ScriptVersionRecord, keyof Row> = {
  packageId: 'package_id',
  version: 'version',
  commit: 'commit_oid',
  status: 'status',
  source: 'source',
  entry: 'entry',
  runtime: 'runtime',
  rulePrompt: 'rule_prompt',
  baseVersion: 'base_version',
  sessionId: 'session_id',
  automationId: 'automation_id',
  rows: 'rows',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
};

function fromRow(row: Row): ScriptVersionRecord {
  return {
    packageId: row.package_id,
    version: row.version,
    commit: row.commit_oid,
    status: row.status as ScriptVersionStatus,
    source: row.source as ScriptVersionSource,
    entry: row.entry,
    runtime: row.runtime as ScriptRuntime,
    ...(row.rule_prompt != null ? { rulePrompt: row.rule_prompt } : {}),
    baseVersion: row.base_version,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.automation_id ? { automationId: row.automation_id } : {}),
    ...(row.rows != null ? { rows: row.rows } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.published_at != null ? { publishedAt: row.published_at } : {}),
  };
}

/** The table is created by main-schema migration 9 (`SCRIPT_VERSIONS_TABLE_SQL`). */
export function createSqliteScriptVersionStore(db: Database.Database): ScriptVersionStore {
  return {
    list: (packageId) =>
      (
        db
          .prepare('SELECT * FROM script_package_versions WHERE package_id = ? ORDER BY version')
          .all(packageId) as Row[]
      ).map(fromRow),
    insert: (record) => {
      const keys = Object.keys(COLUMNS) as Array<keyof ScriptVersionRecord>;
      db.prepare(
        `INSERT INTO script_package_versions (${keys.map((key) => COLUMNS[key]).join(', ')})
         VALUES (${keys.map(() => '?').join(', ')})`
      ).run(...keys.map((key) => record[key] ?? null));
    },
    update: (packageId, version, patch) => {
      const keys = (Object.keys(patch) as Array<keyof ScriptVersionRecord>).filter(
        (key) => key !== 'packageId' && key !== 'version' && key in COLUMNS
      );
      if (keys.length === 0) return;
      db.prepare(
        `UPDATE script_package_versions SET ${keys.map((key) => `${COLUMNS[key]} = ?`).join(', ')}
         WHERE package_id = ? AND version = ?`
      ).run(...keys.map((key) => patch[key] ?? null), packageId, version);
    },
    delete: (packageId, version) => {
      db.prepare('DELETE FROM script_package_versions WHERE package_id = ? AND version = ?').run(
        packageId,
        version
      );
    },
    packageIds: () =>
      (
        db.prepare('SELECT DISTINCT package_id FROM script_package_versions').all() as Array<{
          package_id: string;
        }>
      ).map((row) => row.package_id),
    deletePackage: (packageId) => {
      db.prepare('DELETE FROM script_package_versions WHERE package_id = ?').run(packageId);
    },
  };
}
