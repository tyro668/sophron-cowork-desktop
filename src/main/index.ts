/**
 * @module main/index
 *
 * Electron main-process composition root. This file only performs startup,
 * dependency assembly, and exit cleanup wiring:
 *
 * - Environment/bootstrap flags: .env load, saved-config env application,
 *   hardware acceleration, dev-mode CDP port, single-instance lock.
 * - IPC assembly: every feature domain registers its handlers via
 *   features/<domain>/ipc.ts (see registerAllIpc).
 * - Lifecycle: app event handlers live in app/lifecycle.ts; service
 *   construction and window/menu/tray wiring live in app/bootstrap.ts.
 *
 * Shared runtime state lives in app/context.ts (appContext); cross-process
 * types live in src/shared/contracts.
 */
import { app } from 'electron';
import { resolve } from 'path';
import { config } from 'dotenv';
import { configStore } from './config/config-store';
import { bootstrap, handleBootstrapFailure } from './app/bootstrap';
import { registerAppLifecycle } from './app/lifecycle';
import { registerAllIpc } from './features';
import { log, logWarn } from './utils/logger';

// Load .env file from project root (for development)
const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  configStore.applyToEnv();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';

// Enable Chrome DevTools Protocol in dev mode so the renderer can be inspected
// via chrome://inspect or connected to by Puppeteer/Playwright at localhost:9223.
// Chrome MCP uses 9222, so keep Electron on a separate port in development.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
  app.commandLine.appendSwitch(
    'remote-allow-origins',
    `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
  );
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn('[App] Another instance is already running, quitting this instance');
  app.quit();
}

// Register all feature IPC handlers (each uses the validating handleIpc wrapper)
registerAllIpc();

// App lifecycle handlers: second-instance focus, window-all-closed, signals,
// before-quit cleanup
registerAppLifecycle();

// Initialize app
void app.whenReady().then(bootstrap).catch(handleBootstrapFailure);
