import { ipcRenderer } from 'electron';
import type { Skill } from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createSkillsApi(): ElectronApi['skills'] {
  return {
    getAll: (): Promise<Skill[]> => ipcRenderer.invoke('skills.getAll'),
    install: (skillPath: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.install', skillPath),
    installFromSkillHub: (slug: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.installFromSkillHub', slug),
    delete: (skillId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.delete', skillId),
    setEnabled: (skillId: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.setEnabled', skillId, enabled),
    validate: (skillPath: string): Promise<{ valid: boolean; errors: string[] }> =>
      ipcRenderer.invoke('skills.validate', skillPath),
    getStoragePath: (): Promise<string> => ipcRenderer.invoke('skills.getStoragePath'),
    setStoragePath: (
      targetPath: string,
      migrate = true
    ): Promise<{
      success: boolean;
      path: string;
      migratedCount: number;
      skippedCount: number;
      error?: string;
    }> => ipcRenderer.invoke('skills.setStoragePath', targetPath, migrate),
    openStoragePath: (): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openStoragePath'),
    openSkillPath: (skillId: string): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openSkillPath', skillId),
  };
}
