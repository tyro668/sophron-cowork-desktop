import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Save, Globe, Trash2, Copy } from 'lucide-react';
import { formatAppDateTime } from '../../utils/i18n-format';
import { showToast } from '../../utils/toast';
import { SettingsContentSection } from './shared';
import { GlassSwitch } from '../GlassSwitch';
import { useConfirmDialog } from '../ConfirmDialog';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsLogs({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const [logFiles, setLogFiles] = useState<
    Array<{ name: string; path: string; size: number; mtime: Date }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [logsDirectory, setLogsDirectory] = useState('');
  const [devLogsEnabled, setDevLogsEnabled] = useState(true);

  const loadLogs = useCallback(async () => {
    try {
      const [files, dir] = await Promise.all([
        window.electronAPI.logs.getAll(),
        window.electronAPI.logs.getDirectory(),
      ]);
      setLogFiles(files || []);
      setLogsDirectory(dir || '');
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  }, []);

  const loadDevLogsStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.logs.isEnabled();
      if (result.success && typeof result.enabled === 'boolean') {
        setDevLogsEnabled(result.enabled);
      }
    } catch (err) {
      console.error('Failed to load dev logs status:', err);
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return;
    }
    void loadLogs();
    void loadDevLogsStatus();
    const interval = setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive, loadDevLogsStatus, loadLogs]);

  async function handleToggleDevLogs() {
    setIsLoading(true);
    try {
      const newEnabled = !devLogsEnabled;
      const result = await window.electronAPI.logs.setEnabled(newEnabled);
      if (result.success) {
        setDevLogsEnabled(newEnabled);
        showToast('success', newEnabled ? t('logs.devLogsEnabled') : t('logs.devLogsDisabled'));
      } else {
        showToast('error', result.error || t('logs.toggleFailed'));
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('logs.toggleFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExport() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.logs.export();
      if (result.success) {
        showToast('success', t('logs.exportSuccess', { path: result.path }));
      } else {
        showToast('error', result.error || t('logs.exportFailed'));
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpen() {
    setIsLoading(true);
    try {
      await window.electronAPI.logs.open();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClear() {
    const confirmed = await confirmDelete({
      title: t('logs.clearLogs', '清空日志'),
      message: t('logs.clearConfirm'),
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const result = await window.electronAPI.logs.clear();
      if (result.success) {
        showToast('success', t('logs.clearSuccess', { count: result.deletedCount }));
        await loadLogs();
      } else {
        showToast('error', result.error || t('logs.clearFailed'));
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('logs.clearFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(date: Date): string {
    return formatAppDateTime(date);
  }

  const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      {/* Developer Logs Toggle */}
      <section className="ui-group bg-surface p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary">{t('logs.enableDevLogs')}</h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('logs.enableDevLogsDesc')}</p>
          </div>
          <GlassSwitch
            checked={devLogsEnabled}
            onCheckedChange={handleToggleDevLogs}
            disabled={isLoading}
            ariaLabel={t('logs.enableDevLogs')}
          />
        </div>
      </section>

      {/* Stats */}
      <SettingsContentSection
        title={t('logs.logFiles')}
        description={t('logs.inventoryDescription')}
        flush
      >
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('logs.logFiles')}</span>
          <div className="ui-form-value text-[13px] font-medium tabular-nums text-text-primary">
            {logFiles.length}
          </div>
        </div>
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('logs.totalSize')}</span>
          <div className="ui-form-value text-[13px] font-medium tabular-nums text-text-primary">
            {formatFileSize(totalSize)}
          </div>
        </div>
        {logsDirectory && (
          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('logs.logsDirectory')}</span>
            <div className="ui-form-value">
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 truncate font-mono text-xs text-text-secondary text-left hover:text-accent hover:underline cursor-pointer bg-transparent border-none p-0"
                  onClick={() => window.electronAPI.logs.open()}
                  title={t('logs.openFolder')}
                >
                  {logsDirectory}
                </button>
                <button
                  className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
                  onClick={() => navigator.clipboard.writeText(logsDirectory)}
                  title={t('common.copy')}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </SettingsContentSection>

      {/* Log Files List */}
      <SettingsContentSection
        title={t('logs.logFiles')}
        description={t('logs.recentDescription')}
        flush
      >
        {logFiles.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('logs.noLogFiles')}</p>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {logFiles.map((file) => (
              <div
                key={file.path}
                className="flex h-9 items-center justify-between gap-3 border-b border-border-subtle px-3 last:border-b-0"
              >
                <span className="min-w-0 truncate font-mono text-[12px] text-text-primary">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {formatFileSize(file.size)} · {formatDate(file.mtime)}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsContentSection>

      {/* Action Buttons */}
      <SettingsContentSection
        title={t('logs.actionsTitle')}
        description={t('logs.actionsDescription')}
        flush
      >
        <div className="grid grid-cols-3">
          <button
            onClick={handleExport}
            disabled={isLoading}
            className="flex h-10 items-center justify-center gap-2 bg-accent text-accent-foreground text-[13px] font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t('logs.exportZip')}
          </button>
          <button
            onClick={handleOpen}
            disabled={isLoading}
            className="flex h-10 items-center justify-center gap-2 border-l border-border-subtle text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Globe className="w-4 h-4" />
            {t('logs.openFolder')}
          </button>
          <button
            onClick={handleClear}
            disabled={isLoading || logFiles.length === 0}
            className="flex h-10 items-center justify-center gap-2 border-l border-border-subtle text-[13px] font-medium text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {t('logs.clearAll')}
          </button>
        </div>
      </SettingsContentSection>

      {/* Help Text */}
      <div className="text-xs text-text-muted text-center space-y-1">
        <p>{t('logs.helpText1')}</p>
        <p>{t('logs.helpText2')}</p>
      </div>
    </div>
  );
}
