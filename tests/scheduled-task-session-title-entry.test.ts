import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('scheduled task session title wiring', () => {
  it('routes schedule title generation through SessionManager flow', () => {
    const servicePath = path.resolve(process.cwd(), 'src/main/features/schedule/service.ts');
    const ipcPath = path.resolve(process.cwd(), 'src/main/features/schedule/ipc.ts');
    const content = [servicePath, ipcPath].map((p) => readFileSync(p, 'utf8')).join('\n');
    expect(content).toContain('async function resolveScheduledTaskTitle(');
    expect(content).toContain('sessionManager.generateScheduledTaskTitle');
    expect(content).toContain("handleIpc('schedule.create', async");
    expect(content).toContain("handleIpc('schedule.update', async");
  });
});
