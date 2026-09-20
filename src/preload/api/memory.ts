import { ipcRenderer } from 'electron';
import type {
  CoreMemoryEntry,
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryInjectionRecord,
  MemoryInspectSessionResult,
  MemoryItemStatus,
  MemoryOverview,
  MemoryReadResult,
  MemoryRebuildResult,
  MemorySearchResult,
  MemorySearchScope,
  ProjectMemoryEntry,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createMemoryApi(): ElectronApi['memory'] {
  return {
    getOverview: (cwd?: string): Promise<MemoryOverview> =>
      ipcRenderer.invoke('memory.getOverview', cwd),
    search: (payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: MemorySearchScope;
      limit?: number;
    }): Promise<MemorySearchResult[]> => ipcRenderer.invoke('memory.search', payload),
    read: (id: string): Promise<MemoryReadResult | null> => ipcRenderer.invoke('memory.read', id),
    listCoreEntries: (): Promise<CoreMemoryEntry[]> => ipcRenderer.invoke('memory.listCoreEntries'),
    updateCoreEntry: (
      combinedKey: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ): Promise<CoreMemoryEntry | null> =>
      ipcRenderer.invoke('memory.updateCoreEntry', combinedKey, updates),
    deleteCoreEntry: (combinedKey: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.deleteCoreEntry', combinedKey),
    listProjectEntries: (workspaceKey?: string | null): Promise<ProjectMemoryEntry[]> =>
      ipcRenderer.invoke('memory.listProjectEntries', workspaceKey),
    updateProjectEntry: (
      id: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ): Promise<ProjectMemoryEntry | null> =>
      ipcRenderer.invoke('memory.updateProjectEntry', id, updates),
    deleteProjectEntry: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.deleteProjectEntry', id),
    rebuildWorkspace: (cwd: string): Promise<MemoryRebuildResult & { workspaceKey: string }> =>
      ipcRenderer.invoke('memory.rebuildWorkspace', cwd),
    clearWorkspace: (cwd: string): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke('memory.clearWorkspace', cwd),
    clearCoreMemory: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.clearCoreMemory'),
    rebuildAll: (): Promise<MemoryRebuildResult & { workspaceCount: number }> =>
      ipcRenderer.invoke('memory.rebuildAll'),
    listFiles: (): Promise<MemoryDebugFileInfo[]> => ipcRenderer.invoke('memory.listFiles'),
    readFile: (filePath: string): Promise<MemoryDebugFileContent> =>
      ipcRenderer.invoke('memory.readFile', filePath),
    inspectSession: (
      sessionId: string,
      workspaceKey?: string
    ): Promise<MemoryInspectSessionResult | null> =>
      ipcRenderer.invoke('memory.inspectSession', sessionId, workspaceKey),
    listInjections: (limit?: number): Promise<MemoryInjectionRecord[]> =>
      ipcRenderer.invoke('memory.listInjections', limit),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> =>
      ipcRenderer.invoke('memory.setEnabled', enabled),
  };
}
