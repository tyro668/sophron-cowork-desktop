import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/main/db/database';
import { SessionResultRepository } from '../../src/main/session/session-result-repository';
import { ModelResultStore } from '../../src/main/agent/model-result-store';

const fixtures: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of fixtures.splice(0)) if (db.raw.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function temporaryDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sophron-harness-'));
  directories.push(dir);
  return join(dir, 'cowork.db');
}

export function harnessDatabase(path = ':memory:') {
  const db = openDatabase(path);
  fixtures.push(db);
  return db;
}

export function testResultStore() {
  const db = harnessDatabase();
  const id = randomUUID();
  db.raw
    .prepare('INSERT INTO sessions (id,title,created_at,updated_at) VALUES (?,?,0,0)')
    .run(id, 'test');
  return new ModelResultStore(new SessionResultRepository(db.raw, id));
}
