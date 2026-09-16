import { appContext } from '../../app/context';
import { handleIpc } from '../../ipc-handle';

export function registerUpdateIpc(): void {
  handleIpc('update.getState', () => appContext.updateService?.getState() ?? null);

  handleIpc('update.checkAndInstall', async () => {
    if (!appContext.updateService) {
      throw new Error('Update service is not initialized');
    }
    return appContext.updateService.checkAndInstall();
  });
}
