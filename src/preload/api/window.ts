import { ipcRenderer } from 'electron';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createWindowApi(): ElectronApi['window'] {
  return {
    minimize: () => ipcRenderer.send('window.minimize'),
    maximize: () => ipcRenderer.send('window.maximize'),
    close: () => ipcRenderer.send('window.close'),
  };
}
