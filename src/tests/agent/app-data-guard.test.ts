import { describe, expect, it } from 'vitest';
import {
  APP_DATA_GUARD_REASON,
  checkAppDataAccess,
  isProtectedAppDataPath,
} from '../../main/agent/app-data-guard';

const userDataDir = '/home/u/.config/sophron';
const workDir = `${userDataDir}/DefaultWorkingDir`;
const opts = { userDataDir, cwd: workDir, homeDir: '/home/u' };

describe('app data guard', () => {
  it('blocks the shell commands the agent used to edit cowork.db', () => {
    const cmds = [
      `cd ${userDataDir}; python3 - <<'EOF'\nimport sqlite3\nc=sqlite3.connect('data/cowork.db')\nc.execute("insert into data_pipelines values (1)")\nEOF`,
      `sqlite3 ${userDataDir}/data/cowork.db "update data_pipelines set name='x'"`,
      `python3 -c "import duckdb; duckdb.connect('${userDataDir}/data/workspace.duckdb')"`,
      `ls ${userDataDir}/data`,
      `cat ~/.config/sophron/config.json`,
      `cd ${userDataDir}/data/raw-table-normalizers && cat x.py`,
    ];
    for (const command of cmds) {
      expect(checkAppDataAccess('bash', { command }, opts), command).toBe(APP_DATA_GUARD_REASON);
    }
  });

  it('allows normal commands in the working directory', () => {
    for (const command of [
      `cd ${workDir} && python3 recon.py`,
      `cd ${workDir} && wc -m 场景_今日缺货预警.md`,
      'ls /workspace/sophron-cowork-desktop/src/main/data',
      `python3 -c "open('${workDir}/data/out.csv','w')"`,
    ]) {
      expect(checkAppDataAccess('bash', { command }, opts), command).toBeNull();
    }
  });

  it('blocks write/edit/apply_patch into the app data dir and config files', () => {
    expect(checkAppDataAccess('write', { path: `${userDataDir}/data/cowork.db` }, opts)).toBe(
      APP_DATA_GUARD_REASON
    );
    expect(checkAppDataAccess('edit', { file_path: `${userDataDir}/config.json` }, opts)).toBe(
      APP_DATA_GUARD_REASON
    );
    expect(checkAppDataAccess('write', { path: '../data/workspace.duckdb' }, opts)).toBe(
      APP_DATA_GUARD_REASON
    );
    expect(
      checkAppDataAccess(
        'apply_patch',
        {
          patch: `*** Begin Patch\n*** Update File: ${userDataDir}/data/raw-table-normalizers/a.py\n`,
        },
        opts
      )
    ).toBe(APP_DATA_GUARD_REASON);
  });

  it('allows writes to the working directory and ignores other tools', () => {
    expect(checkAppDataAccess('write', { path: `${workDir}/report.md` }, opts)).toBeNull();
    expect(checkAppDataAccess('write', { path: 'notes/data/x.csv' }, opts)).toBeNull();
    expect(checkAppDataAccess('read', { path: 'src/main/data/x.ts' }, opts)).toBeNull();
    expect(checkAppDataAccess('data_create_pipeline', { name: 'x' }, opts)).toBeNull();
  });

  it('classifies protected paths', () => {
    expect(isProtectedAppDataPath(`${userDataDir}/data`, opts)).toBe(true);
    expect(isProtectedAppDataPath(`${userDataDir}/data/cowork.db-wal`, opts)).toBe(true);
    expect(isProtectedAppDataPath(`${userDataDir}/memory/notes.md`, opts)).toBe(false);
    expect(isProtectedAppDataPath('/tmp/cowork.db', opts)).toBe(true);
  });

  it('tells the agent which official tools to use', () => {
    expect(APP_DATA_GUARD_REASON).toContain('data_create_pipeline');
    expect(APP_DATA_GUARD_REASON).toContain('data_apply_workflow_plan');
  });
});
