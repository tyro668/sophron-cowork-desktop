/**
 * @module main/features
 *
 * IPC assembly: every feature domain exposes a register*Ipc() that wires its
 * channels through the validating handleIpc wrapper (or ipcMain.on for
 * fire-and-forget events). Called once from main/index.ts before app ready.
 */
import { registerSessionIpc } from './session/ipc';
import { registerSystemIpc } from './system/ipc';
import { registerUpdateIpc } from './update/ipc';
import { registerAuthIpc } from './auth/ipc';
import { registerShellIpc } from './shell/ipc';
import { registerDataIpc } from './data/ipc';
import { registerConfigIpc } from './config/ipc';
import { registerMcpIpc } from './mcp/ipc';
import { registerSkillsIpc } from './skills/ipc';
import { registerPluginsIpc } from './plugins/ipc';
import { registerSandboxIpc } from './sandbox/ipc';
import { registerLogsIpc } from './logs/ipc';
import { registerRemoteIpc } from './remote/ipc';
import { registerAutomationIpc } from './automation/ipc';
import { registerScheduleIpc } from './schedule/ipc';
import { registerMemoryIpc } from './memory/ipc';

export function registerAllIpc(): void {
  registerSessionIpc();
  registerSystemIpc();
  registerUpdateIpc();
  registerAuthIpc();
  registerShellIpc();
  registerDataIpc();
  registerConfigIpc();
  registerMcpIpc();
  registerSkillsIpc();
  registerPluginsIpc();
  registerSandboxIpc();
  registerLogsIpc();
  registerRemoteIpc();
  registerAutomationIpc();
  registerScheduleIpc();
  registerMemoryIpc();
}
