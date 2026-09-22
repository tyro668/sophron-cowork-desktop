/** data_groups row access + group_id assignment on member tables. */
import { randomUUID } from 'node:crypto';
import type { DataGroup, DataGroupScope } from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import {
  DataGroupRow,
  mapGroupRow,
  outputTableConfigPredicateSql,
  storedDatasetSourceKindSql,
} from '../data-store-records';

const MEMBER_TABLE: Record<DataGroupScope, string> = {
  task: 'data_cleaning_tasks',
  input: 'data_datasets',
  output: 'data_datasets',
};

const MEMBER_PREDICATE: Record<DataGroupScope, string | null> = {
  task: null,
  input: `${storedDatasetSourceKindSql()} <> 'output'`,
  output: outputTableConfigPredicateSql(),
};

export class GroupRepository {
  constructor(private readonly ctx: DataStoreContext) {}

  async listGroups(scope: DataGroupScope): Promise<DataGroup[]> {
    const rows = await this.ctx.metaQueryRows<DataGroupRow>(
      'SELECT * FROM data_groups WHERE scope = $scope ORDER BY sort_index, created_at, name',
      { scope }
    );
    return rows.map(mapGroupRow);
  }

  async listAllGroups(): Promise<DataGroup[]> {
    const rows = await this.ctx.metaQueryRows<DataGroupRow>(
      'SELECT * FROM data_groups ORDER BY scope, sort_index, created_at, name'
    );
    return rows.map(mapGroupRow);
  }

  async createGroup(scope: DataGroupScope, name: string): Promise<DataGroup> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Group name is required');
    }
    const existing = await this.ctx.metaQueryRows<{ id: string }>(
      'SELECT id FROM data_groups WHERE scope = $scope AND name = $name LIMIT 1',
      { scope, name: trimmed }
    );
    if (existing.length > 0) {
      throw new Error(`Group already exists: ${trimmed}`);
    }
    const group: DataGroup = {
      id: randomUUID(),
      scope,
      name: trimmed,
      createdAt: this.ctx.now(),
    };
    await this.ctx.metaRunSql(
      `INSERT INTO data_groups (id, scope, name, sort_index, created_at)
       VALUES ($id, $scope, $name, $sortIndex, $createdAt)`,
      {
        id: group.id,
        scope,
        name: group.name,
        sortIndex: group.createdAt,
        createdAt: group.createdAt,
      }
    );
    return group;
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Group name is required');
    }
    await this.ctx.metaRunSql('UPDATE data_groups SET name = $name WHERE id = $id', {
      id,
      name: trimmed,
    });
  }

  /** Deletes the group; member rows fall back to ungrouped. */
  async deleteGroup(id: string): Promise<void> {
    const rows = await this.ctx.metaQueryRows<{ scope: string }>(
      'SELECT scope FROM data_groups WHERE id = $id LIMIT 1',
      { id }
    );
    if (rows.length === 0) return;
    const scope = rows[0].scope as DataGroupScope;
    const table = MEMBER_TABLE[scope];
    const predicate = MEMBER_PREDICATE[scope];
    await this.ctx.runExclusive(async () => {
      await this.ctx.metaRunSql(
        `UPDATE ${table} SET group_id = NULL WHERE group_id = $id${predicate ? ` AND ${predicate}` : ''}`,
        { id }
      );
      await this.ctx.metaRunSql('DELETE FROM data_groups WHERE id = $id', { id });
    });
  }

  /** Assigns rows to a group (or clears with null) in the matching member table. */
  async assignToGroup(scope: DataGroupScope, ids: string[], groupId: string | null): Promise<void> {
    if (ids.length === 0) return;
    const table = MEMBER_TABLE[scope];
    if (groupId !== null) {
      const rows = await this.ctx.metaQueryRows<{ id: string }>(
        'SELECT id FROM data_groups WHERE id = $id AND scope = $scope LIMIT 1',
        { id: groupId, scope }
      );
      if (rows.length === 0) {
        throw new Error(`Group not found: ${groupId}`);
      }
    }
    const placeholders = ids.map((_, i) => `$id${i}`).join(', ');
    const values: Record<string, string | null> = { gid: groupId };
    ids.forEach((id, i) => {
      values[`id${i}`] = id;
    });
    const predicate = MEMBER_PREDICATE[scope];
    await this.ctx.metaRunSql(
      `UPDATE ${table} SET group_id = $gid WHERE id IN (${placeholders})${predicate ? ` AND ${predicate}` : ''}`,
      values
    );
  }
}
