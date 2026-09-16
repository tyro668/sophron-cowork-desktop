import { ipcRenderer } from 'electron';
import type { DesktopAuthStatus } from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createAuthApi(): ElectronApi['auth'] {
  return {
    getStatus: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.getStatus'),
    login: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.login'),
    cancelLogin: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.cancelLogin'),
    logout: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.logout'),
  };
}
