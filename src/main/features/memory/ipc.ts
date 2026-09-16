import { appContext } from '../../app/context';
import { sendToRenderer } from '../../app/events';
import { configStore } from '../../config/config-store';
import { handleIpc } from '../../ipc-handle';

export function registerMemoryIpc(): void {
  handleIpc('memory.getOverview', (_event, cwd?: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.getOverview(cwd);
  });

  handleIpc(
    'memory.search',
    (
      _event,
      payload: {
        query: string;
        cwd?: string;
        sourceWorkspace?: string | null;
        scope?: 'workspace' | 'global' | 'all';
        limit?: number;
      }
    ) => {
      if (!appContext.memoryService) {
        throw new Error('Memory service not initialized');
      }
      return appContext.memoryService.search(payload);
    }
  );

  handleIpc('memory.read', (_event, id: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.read(id);
  });

  handleIpc('memory.listCoreEntries', () => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.listCoreEntries();
  });

  handleIpc(
    'memory.updateCoreEntry',
    (
      _event,
      combinedKey: string,
      updates: {
        key?: string;
        value?: string;
        confidence?: number;
        status?: 'active' | 'pending' | 'rejected' | 'archived';
      }
    ) => {
      if (!appContext.memoryService) {
        throw new Error('Memory service not initialized');
      }
      return appContext.memoryService.updateCoreEntry(combinedKey, updates);
    }
  );

  handleIpc('memory.deleteCoreEntry', (_event, combinedKey: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.deleteCoreEntry(combinedKey);
  });

  handleIpc('memory.listProjectEntries', (_event, workspaceKey?: string | null) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.listProjectEntries(workspaceKey);
  });

  handleIpc(
    'memory.updateProjectEntry',
    (
      _event,
      id: string,
      updates: {
        key?: string;
        value?: string;
        confidence?: number;
        status?: 'active' | 'pending' | 'rejected' | 'archived';
      }
    ) => {
      if (!appContext.memoryService) {
        throw new Error('Memory service not initialized');
      }
      return appContext.memoryService.updateProjectEntry(id, updates);
    }
  );

  handleIpc('memory.deleteProjectEntry', (_event, id: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.deleteProjectEntry(id);
  });

  handleIpc('memory.rebuildWorkspace', async (_event, cwd: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.rebuildWorkspace(cwd);
  });

  handleIpc('memory.clearWorkspace', (_event, cwd: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.clearWorkspace(cwd);
  });

  handleIpc('memory.clearCoreMemory', () => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.clearCoreMemory();
  });

  handleIpc('memory.rebuildAll', async () => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.rebuildAll();
  });

  handleIpc('memory.listFiles', () => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.listFiles();
  });

  handleIpc('memory.readFile', (_event, filePath: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.readFile(filePath);
  });

  handleIpc('memory.inspectSession', (_event, sessionId: string, workspaceKey?: string) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return appContext.memoryService.inspectSession(sessionId, workspaceKey);
  });

  handleIpc('memory.setEnabled', (_event, enabled: boolean) => {
    if (!appContext.memoryService) {
      throw new Error('Memory service not initialized');
    }
    const result = appContext.memoryService.setEnabled(enabled);
    appContext.sessionManager?.clearAllCachedAgentSessions();
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured: configStore.isConfigured(),
        config: configStore.getAll(),
      },
    });
    return result;
  });
}
