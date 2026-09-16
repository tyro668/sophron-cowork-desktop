import { shell } from 'electron';
import { appContext } from '../../app/context';
import { sendToRenderer } from '../../app/events';
import { configStore } from '../../config/config-store';
import { handleIpc } from '../../ipc-handle';
import { logError } from '../../utils/logger';

export function registerSkillsIpc(): void {
  // Skills API handlers
  handleIpc('skills.getAll', async () => {
    try {
      if (!appContext.skillsManager) {
        throw new Error('Skills manager is still starting');
      }
      return await appContext.skillsManager.listSkills();
    } catch (error) {
      logError('[Skills] Error getting skills:', error);
      throw error;
    }
  });

  handleIpc('skills.install', async (_event, skillPath: string) => {
    try {
      if (!appContext.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      const skill = await appContext.skillsManager.installSkill(skillPath);
      appContext.sessionManager?.invalidateSkillsSetup();
      return { success: true, skill };
    } catch (error) {
      logError('[Skills] Error installing skill:', error);
      throw error;
    }
  });

  handleIpc('skills.installFromSkillHub', async (_event, slug: string) => {
    try {
      if (!appContext.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      const skill = await appContext.skillsManager.installSkillHubSkill(slug);
      appContext.sessionManager?.invalidateSkillsSetup();
      return { success: true, skill };
    } catch (error) {
      logError('[Skills] Error installing SkillHub skill:', error);
      throw error;
    }
  });

  handleIpc('skills.delete', async (_event, skillId: string) => {
    try {
      if (!appContext.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      await appContext.skillsManager.uninstallSkill(skillId);
      appContext.sessionManager?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error deleting skill:', error);
      throw error;
    }
  });

  handleIpc('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
    try {
      if (!appContext.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      appContext.skillsManager.setSkillEnabled(skillId, enabled);
      appContext.sessionManager?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error toggling skill:', error);
      throw error;
    }
  });

  handleIpc('skills.validate', async (_event, skillPath: string) => {
    try {
      if (!appContext.skillsManager) {
        return { valid: false, errors: ['SkillsManager not initialized'] };
      }
      const result = await appContext.skillsManager.validateSkillFolder(skillPath);
      return result;
    } catch (error) {
      logError('[Skills] Error validating skill:', error);
      return { valid: false, errors: ['Validation failed'] };
    }
  });

  handleIpc('skills.getStoragePath', async () => {
    try {
      if (!appContext.skillsManager) {
        return null;
      }
      return appContext.skillsManager.getGlobalSkillsPath();
    } catch (error) {
      logError('[Skills] Error getting storage path:', error);
      return null;
    }
  });

  handleIpc('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
    if (!appContext.skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const result = await appContext.skillsManager.setGlobalSkillsPath(
      targetPath,
      migrate !== false
    );
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured: configStore.isConfigured(),
        config: configStore.getAll(),
      },
    });
    return { success: true, ...result };
  });

  handleIpc('skills.openStoragePath', async () => {
    if (!appContext.skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const storagePath = appContext.skillsManager.getGlobalSkillsPath();
    const openResult = await shell.openPath(storagePath);
    if (openResult) {
      return { success: false, path: storagePath, error: openResult };
    }
    return { success: true, path: storagePath };
  });

  handleIpc('skills.openSkillPath', async (_event, skillId: string) => {
    if (!appContext.skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    await appContext.skillsManager.listSkills();
    const skillPath = appContext.skillsManager.getSkillPath(skillId);
    if (!skillPath) {
      return { success: false, path: '', error: 'Skill path unavailable' };
    }
    const openResult = await shell.openPath(skillPath);
    if (openResult) {
      return { success: false, path: skillPath, error: openResult };
    }
    return { success: true, path: skillPath };
  });
}
