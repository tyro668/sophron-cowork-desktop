/**
 * Versioned main-database (cowork.db) migration coverage:
 * - fresh databases get the ledger and full schema
 * - pre-ledger databases upgrade in place exactly once
 * - reopening does not re-run migrations
 * - a database newer than this build opens read-only and refuses writes
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAIN_SCHEMA_MIGRATIONS,
  MAIN_SCHEMA_VERSION,
  migrateMainSchema,
} from '../src/main/db/database';

const tempRoots: string[] = [];
const rawDbs: Database.Database[] = [];

function openRawDb(): Database.Database {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-maindb-'));
  tempRoots.push(root);
  const db = new Database(path.join(root, 'cowork.db'));
  rawDbs.push(db);
  return db;
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

function ledgerVersions(db: Database.Database): number[] {
  return (
    db.prepare('SELECT version FROM app_schema_migrations ORDER BY version ASC').all() as Array<{
      version: number;
    }>
  ).map((row) => row.version);
}

afterEach(() => {
  while (rawDbs.length > 0) {
    rawDbs.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('main database migrations', () => {
  it('declares strictly increasing unique versions', () => {
    const versions = MAIN_SCHEMA_MIGRATIONS.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(MAIN_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
  });

  it('creates the ledger and full schema on a fresh database', () => {
    const db = openRawDb();
    migrateMainSchema(db);

    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const table of [
      'projects',
      'sessions',
      'messages',
      'llm_usage_events',
      'trace_steps',
      'scheduled_tasks',
      'automations',
      'automation_runs',
      'automation_artifacts',
      'automation_groups',
      'skill_invocations',
      'app_meta',
      'app_schema_migrations',
    ]) {
      expect(tableNames(db)).toContain(table);
    }
  });

  it('upgrades a pre-ledger database in place and migrates legacy session workdirs', () => {
    const db = openRawDb();
    // Simulate a DB written by a pre-migration build: sessions table exists
    // with a cwd that must be folded into a project row, but no ledger.
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        cwd TEXT,
        mounted_paths TEXT NOT NULL DEFAULT '[]',
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        memory_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    db.prepare(
      "INSERT INTO sessions (id, title, claude_session_id, status, cwd, created_at, updated_at) VALUES ('s1', 't', 'sdk-123', 'idle', '/tmp/work', 1, 1)"
    ).run();

    migrateMainSchema(db);

    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const session = db
      .prepare('SELECT project_id, cwd, agent_session_id FROM sessions WHERE id = ?')
      .get('s1') as {
      project_id: string | null;
      cwd: string | null;
      agent_session_id: string | null;
    };
    expect(session.project_id).toBeTruthy();
    expect(session.cwd).toBeNull();
    // v2 renamed the legacy column without dropping its value.
    expect(session.agent_session_id).toBe('sdk-123');
    const columnNames = (
      db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    expect(columnNames).toContain('agent_session_id');
    expect(columnNames).not.toContain('claude_session_id');
    const project = db.prepare('SELECT cwd FROM projects WHERE id = ?').get(session.project_id) as {
      cwd: string;
    };
    expect(project.cwd).toBe('/tmp/work');
  });

  it('does not re-run migrations on reopen', () => {
    const db = openRawDb();
    migrateMainSchema(db);

    // If the baseline re-ran, CREATE TABLE IF NOT EXISTS would recreate this.
    db.exec('DROP TABLE skills');

    migrateMainSchema(db);
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tableNames(db)).not.toContain('skills');
  });

  it('opens a newer-version database read-only and refuses writes', () => {
    const db = openRawDb();
    migrateMainSchema(db);
    db.prepare(
      'INSERT INTO app_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(MAIN_SCHEMA_VERSION + 100, 'future_migration', Date.now());

    migrateMainSchema(db);

    expect(db.pragma('query_only', { simple: true })).toBe(1);
    expect(() => db.prepare("INSERT INTO app_meta (key, value) VALUES ('k', 'v')").run()).toThrow(
      /readonly/i
    );
    // Reads still work.
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, MAIN_SCHEMA_VERSION + 100]);
  });
});
