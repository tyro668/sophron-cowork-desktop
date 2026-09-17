import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('memory integration wiring', () => {
  it('registers the memory extension in the main process and exposes IPC handlers', () => {
    const bootstrap = readProjectFile('src/main/app/bootstrap.ts');
    const memoryIpc = readProjectFile('src/main/features/memory/ipc.ts');
    expect(bootstrap).toContain('new MemoryExtension(appContext.memoryService)');
    expect(memoryIpc).toContain("handleIpc('memory.getOverview'");
    expect(memoryIpc).toContain("'memory.search'");
    expect(memoryIpc).toContain("'memory.listFiles'");
    expect(memoryIpc).toContain("'memory.inspectSession'");
    expect(memoryIpc).toContain("handleIpc('memory.setEnabled'");
  });

  it('injects runtime plugin skill paths and extension hooks into the agent runner', () => {
    const runner = readProjectFile('src/main/agent/agent-runner.ts');
    const runnerSkills = readProjectFile('src/main/agent/agent-runner-skills.ts');
    const memoryExtension = readProjectFile('src/main/memory/memory-extension.ts');
    expect(runner).toContain('resolveSkillPaths(session.id)');
    expect(runnerSkills).toContain("path.join(plugin.runtimePath, 'skills')");
    expect(runner).toContain('this.extensionManager.beforeSessionRun');
    expect(runner).toContain('skillsSignature');
    expect(memoryExtension).not.toContain('customTools: this.memoryService.getTools()');
  });

  it('adds a dedicated Memory settings tab and preload bridge', () => {
    const settingsPanel = readProjectFile('src/renderer/components/SettingsPanel.tsx');
    const preload = readProjectFile('src/preload/index.ts');
    const memoryApi = readProjectFile('src/preload/api/memory.ts');
    const memorySettings = readProjectFile('src/renderer/components/settings/SettingsMemory.tsx');

    expect(settingsPanel).toContain("id: 'memory'");
    expect(settingsPanel).toContain('<SettingsMemory />');
    expect(preload).toContain('memory: createMemoryApi()');
    expect(memoryApi).toContain("ipcRenderer.invoke('memory.search'");
    expect(memoryApi).toContain("ipcRenderer.invoke('memory.listFiles')");
    expect(memorySettings).toContain('window.electronAPI.memory.listCoreEntries');
    expect(memorySettings).toContain('window.electronAPI.memory.listProjectEntries');
    expect(memorySettings).toContain('window.electronAPI.memory.deleteCoreEntry');
    expect(memorySettings).toContain('window.electronAPI.memory.deleteProjectEntry');
    expect(memorySettings).toContain('window.electronAPI.memory.rebuildWorkspace');
    expect(memorySettings).toContain('failedSessionCount');
    expect(memorySettings).not.toContain('window.electronAPI.memory.readFile');
    expect(memorySettings).not.toContain('promptIterationRounds');
  });

  it('defaults new sessions to the global memory toggle', () => {
    const sessionManager = readProjectFile('src/main/session/session-manager.ts');
    expect(sessionManager).toContain("configStore.get('memoryEnabled') !== false");
    expect(sessionManager).toContain('memoryEnabled?: boolean');
    expect(sessionManager).toContain('afterSessionRun');
  });

  it('removes unused SQLite memory tables from schema initialization', () => {
    const databaseSource = readProjectFile('src/main/db/database.ts');
    expect(databaseSource).not.toContain('memory_core_entries');
    expect(databaseSource).not.toContain('memory_experience_sessions');
    expect(databaseSource).not.toContain('memory_experience_chunks');
    expect(databaseSource).not.toContain('memory_session_state');
  });
});
