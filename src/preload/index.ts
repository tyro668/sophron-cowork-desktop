/**
 * @module preload/index
 *
 * Preload entry point — composes the domain bridge modules under ./api into a
 * single object typed by the shared ElectronApi contract and exposes it on
 * `window.electronAPI`. The global Window declaration lives in
 * electron-api.d.ts next to this file.
 */
import { contextBridge } from 'electron';
import type { ElectronApi } from '../shared/contracts/electron-api';
import { createCoreApi } from './api/core';
import { createUpdateApi } from './api/update';
import { createAuthApi } from './api/auth';
import { createShellApi } from './api/shell';
import { createDataApi } from './api/data';
import { createConfigApi } from './api/config';
import { createWindowApi } from './api/window';
import { createMcpApi } from './api/mcp';
import { createSkillsApi } from './api/skills';
import { createPluginsApi } from './api/plugins';
import { createSandboxApi } from './api/sandbox';
import { createLogsApi } from './api/logs';
import { createRemoteApi } from './api/remote';
import { createScheduleApi } from './api/schedule';
import { createAutomationApi } from './api/automation';
import { createMemoryApi } from './api/memory';

const electronApi = {
  ...createCoreApi(),
  update: createUpdateApi(),
  auth: createAuthApi(),
  ...createShellApi(),
  data: createDataApi(),
  config: createConfigApi(),
  window: createWindowApi(),
  mcp: createMcpApi(),
  skills: createSkillsApi(),
  plugins: createPluginsApi(),
  sandbox: createSandboxApi(),
  logs: createLogsApi(),
  remote: createRemoteApi(),
  schedule: createScheduleApi(),
  automation: createAutomationApi(),
  memory: createMemoryApi(),
} satisfies ElectronApi;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', electronApi);
