import { shell } from 'electron';
import { handleIpc } from '../../ipc-handle';
import { appContext } from '../../app/context';

function requireScripts() {
  if (!appContext.scriptPackages) throw new Error('Script packages are not initialized');
  return appContext.scriptPackages;
}

export function registerScriptPackageIpc(): void {
  handleIpc('automation.scripts.list', () => requireScripts().list());
  handleIpc('automation.scripts.open', async (_event, id: string, pending?: boolean) => {
    const scripts = requireScripts();
    const dir = scripts.packageDir(id);
    const error = await shell.openPath(pending ? scripts.pendingDir(dir) : dir);
    if (error) throw new Error(error);
  });
  handleIpc(
    'automation.scripts.testRun',
    (_event, id: string, timeoutMs: number, pending?: boolean) =>
      requireScripts().testRun(id, { timeoutMs, pending: Boolean(pending) })
  );
  handleIpc('automation.scripts.confirmPending', (_event, id: string) =>
    requireScripts().confirmPending(id)
  );
  handleIpc('automation.scripts.discardPending', (_event, id: string) =>
    requireScripts().discardPending(id)
  );
}
