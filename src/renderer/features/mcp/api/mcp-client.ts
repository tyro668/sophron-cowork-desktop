import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type McpApi = ElectronApi['mcp'];

const api = () => requireElectronNamespace('mcp');

export const mcpClient = {
  isAvailable: () => isElectronNamespaceAvailable('mcp'),
  getServers: () => api().getServers(),
  getServerStatus: () => api().getServerStatus(),
  getTools: () => api().getTools(),
  getPresets: () => api().getPresets(),
  saveServer: (...args: Parameters<McpApi['saveServer']>) => api().saveServer(...args),
  deleteServer: (...args: Parameters<McpApi['deleteServer']>) => api().deleteServer(...args),
  reauthorize: (...args: Parameters<McpApi['reauthorize']>) => api().reauthorize(...args),
  cancelAuthorization: (...args: Parameters<McpApi['cancelAuthorization']>) =>
    api().cancelAuthorization(...args),
};
