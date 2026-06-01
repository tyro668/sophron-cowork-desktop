import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import type { AppUpdateState } from '../../renderer/types';

interface UpdateServiceOptions {
  getWindow: () => BrowserWindow | null;
  beforeInstall?: () => Promise<void> | void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const ALLOWED_CHANNELS = new Set(['stable', 'beta', 'canary']);
const DEFAULT_UPDATE_CHANNEL = 'stable';

export class UpdateService {
  private readonly getWindow: UpdateServiceOptions['getWindow'];
  private readonly beforeInstall: UpdateServiceOptions['beforeInstall'];
  private readonly log: UpdateServiceOptions['log'];
  private readonly warn: UpdateServiceOptions['warn'];
  private readonly error: UpdateServiceOptions['error'];
  private state: AppUpdateState;
  private initialized = false;
  private installing = false;

  constructor(options: UpdateServiceOptions) {
    this.getWindow = options.getWindow;
    this.beforeInstall = options.beforeInstall;
    this.log = options.log;
    this.warn = options.warn;
    this.error = options.error;
    this.state = {
      status: app.isPackaged ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      availableVersion: null,
      percent: null,
      error: app.isPackaged ? null : 'Online updates are only available in packaged builds.',
      checkedAt: null,
    };
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (...args: unknown[]) => this.log('[Update]', ...args),
      warn: (...args: unknown[]) => this.warn('[Update]', ...args),
      error: (...args: unknown[]) => this.error('[Update]', ...args),
    };
    this.configureFeedUrl();

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', error: null, percent: null });
    });
    autoUpdater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        error: null,
        checkedAt: Date.now(),
      });
    });
    autoUpdater.on('update-not-available', (info) => {
      this.setState({
        status: 'not-available',
        availableVersion: info.version,
        percent: null,
        error: null,
        checkedAt: Date.now(),
      });
    });
    autoUpdater.on('download-progress', (progress) => this.handleProgress(progress));
    autoUpdater.on('update-downloaded', (event) => {
      void this.installDownloadedUpdate(event);
    });
    autoUpdater.on('error', (err) => {
      this.setState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  isInstalling(): boolean {
    return this.installing;
  }

  async checkForUpdate(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: 'unsupported',
        error: 'Online updates are only available in packaged builds.',
      });
      return this.getState();
    }
    this.initialize();
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.installing) {
      return this.getState();
    }

    this.setState({ status: 'checking', error: null, percent: null });
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.isUpdateAvailable) {
      this.setState({
        status: 'not-available',
        availableVersion: null,
        percent: null,
        error: null,
        checkedAt: Date.now(),
      });
    }
    return this.getState();
  }

  async checkAndInstall(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: 'unsupported',
        error: 'Online updates are only available in packaged builds.',
      });
      return this.getState();
    }
    this.initialize();
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.installing) {
      return this.getState();
    }

    this.setState({ status: 'checking', error: null, percent: null });
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.isUpdateAvailable) {
      this.setState({ status: 'not-available', checkedAt: Date.now() });
      return this.getState();
    }

    const updateInfo = result.updateInfo;
    this.setState({
      status: 'downloading',
      availableVersion: updateInfo.version,
      percent: 0,
      error: null,
    });
    await autoUpdater.downloadUpdate(result.cancellationToken);
    return this.getState();
  }

  private configureFeedUrl(): void {
    const explicitUrl = process.env.SOPHRON_UPDATE_URL?.trim();
    const channel = normalizeUpdateChannel(process.env.SOPHRON_UPDATE_CHANNEL);
    if (!explicitUrl) {
      autoUpdater.channel = channel === DEFAULT_UPDATE_CHANNEL ? null : channel;
      return;
    }

    try {
      const parsed = new URL(explicitUrl);
      if (parsed.protocol !== 'https:') {
        this.warn('[Update] Ignoring non-HTTPS update URL override.');
        return;
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: parsed.toString() });
    } catch (error) {
      this.warn('[Update] Ignoring invalid update URL override:', error);
    }
  }

  private handleProgress(progress: ProgressInfo): void {
    this.setState({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      error: null,
    });
  }

  private async installDownloadedUpdate(event: UpdateDownloadedEvent): Promise<void> {
    if (this.installing) return;
    this.installing = true;
    this.setState({
      status: 'downloaded',
      availableVersion: event.version,
      percent: 100,
      error: null,
    });
    this.setState({ status: 'installing' });
    try {
      await this.beforeInstall?.();
    } catch (error) {
      this.warn('[Update] Pre-install cleanup failed, continuing update install:', error);
    }
    autoUpdater.quitAndInstall(true, true);
  }

  private setState(next: Partial<AppUpdateState>): void {
    this.state = {
      ...this.state,
      ...next,
      currentVersion: app.getVersion(),
    };
    this.publishState();
  }

  private publishState(): void {
    const targetWindow = this.getWindow();
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('update.state', this.getState());
    }
  }
}

function normalizeUpdateChannel(value: string | undefined): string {
  const channel = value?.trim() || DEFAULT_UPDATE_CHANNEL;
  return ALLOWED_CHANNELS.has(channel) ? channel : DEFAULT_UPDATE_CHANNEL;
}
