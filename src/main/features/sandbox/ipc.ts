import { sendToRenderer } from '../../app/events';
import { handleIpc } from '../../ipc-handle';
import { LimaBridge } from '../../sandbox/lima-bridge';
import { getSandboxAdapter } from '../../sandbox/sandbox-adapter';
import { getSandboxBootstrap } from '../../sandbox/sandbox-bootstrap';
import { WSLBridge } from '../../sandbox/wsl-bridge';
import { logError } from '../../utils/logger';

export function registerSandboxIpc(): void {
  // Sandbox IPC handlers
  handleIpc('sandbox.getStatus', async () => {
    try {
      const adapter = getSandboxAdapter();
      const platform = process.platform;

      if (platform === 'win32') {
        const wslStatus = await WSLBridge.checkWSLStatus();
        return {
          platform: 'win32',
          mode: adapter.initialized ? adapter.mode : 'none',
          initialized: adapter.initialized,
          wsl: wslStatus,
          lima: null,
        };
      } else if (platform === 'darwin') {
        const limaStatus = await LimaBridge.checkLimaStatus();
        return {
          platform: 'darwin',
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: limaStatus,
        };
      } else {
        return {
          platform,
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: null,
        };
      }
    } catch (error) {
      logError('[Sandbox] Error getting status:', error);
      return {
        platform: process.platform,
        mode: 'none',
        initialized: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // WSL IPC handlers (Windows)
  handleIpc('sandbox.checkWSL', async () => {
    try {
      return await WSLBridge.checkWSLStatus();
    } catch (error) {
      logError('[Sandbox] Error checking WSL:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('sandbox.installNodeInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installNodeInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Node.js:', error);
      return false;
    }
  });

  handleIpc('sandbox.installPythonInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installPythonInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Python:', error);
      return false;
    }
  });

  // Lima IPC handlers (macOS)
  handleIpc('sandbox.checkLima', async () => {
    try {
      return await LimaBridge.checkLimaStatus();
    } catch (error) {
      logError('[Sandbox] Error checking Lima:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('sandbox.createLimaInstance', async () => {
    try {
      return await LimaBridge.createLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error creating Lima instance:', error);
      return false;
    }
  });

  handleIpc('sandbox.startLimaInstance', async () => {
    try {
      return await LimaBridge.startLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error starting Lima instance:', error);
      return false;
    }
  });

  handleIpc('sandbox.stopLimaInstance', async () => {
    try {
      return await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima instance:', error);
      return false;
    }
  });

  handleIpc('sandbox.installNodeInLima', async () => {
    try {
      return await LimaBridge.installNodeInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Node.js in Lima:', error);
      return false;
    }
  });

  handleIpc('sandbox.installPythonInLima', async () => {
    try {
      return await LimaBridge.installPythonInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Python in Lima:', error);
      return false;
    }
  });

  handleIpc('sandbox.retryLimaSetup', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Lima is only available on macOS' };
    }

    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      try {
        await LimaBridge.stopLimaInstance();
      } catch (error) {
        logError('[Sandbox] Error stopping Lima before retry:', error);
      }

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying Lima setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Generic retry setup for both WSL and Lima
  handleIpc('sandbox.retrySetup', async () => {
    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      // Reset and re-run bootstrap
      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
