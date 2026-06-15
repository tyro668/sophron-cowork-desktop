import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  Package,
  Power,
  PowerOff,
  Trash2,
  Plus,
  Loader2,
  FolderOpen,
  Globe,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Skill, PluginCatalogItemV2, InstalledPlugin, PluginComponentKind } from '../../types';
import { useAppStore } from '../../store';
import type { LocalizedBanner } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const SKILLHUB_MARKET_PAGE_SIZE = 50;

export function SettingsSkills({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const skillsStorageChangeEvent = useAppStore((state) => state.skillsStorageChangeEvent);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [storagePath, setStoragePath] = useState('');
  const [plugins, setPlugins] = useState<PluginCatalogItemV2[]>([]);
  const [installedPluginsByKey, setInstalledPluginsByKey] = useState<
    Record<string, InstalledPlugin>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [isPluginLoading, setIsPluginLoading] = useState(false);
  const [isPluginLoadingMore, setIsPluginLoadingMore] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [pluginPage, setPluginPage] = useState(0);
  const [hasMorePlugins, setHasMorePlugins] = useState(false);
  const [pluginActionKey, setPluginActionKey] = useState<string | null>(null);
  const [pluginToastMessage, setPluginToastMessage] = useState('');
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const pluginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const componentOrder: PluginComponentKind[] = ['skills', 'commands', 'agents', 'hooks', 'mcp'];

  function normalizePluginLookupKey(value: string | undefined): string {
    if (!value) {
      return '';
    }
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getCatalogLookupKeys(plugin: PluginCatalogItemV2): string[] {
    const keys = new Set<string>();
    const addKey = (value: string | undefined) => {
      if (!value) {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      keys.add(trimmed);
      keys.add(trimmed.toLowerCase());
      const normalized = normalizePluginLookupKey(trimmed);
      if (normalized) {
        keys.add(normalized);
      }
    };

    addKey(plugin.name);
    addKey(plugin.pluginId);
    addKey(plugin.skillHubSlug);

    const marketplaceId = plugin.pluginId?.split('@')[0];
    addKey(marketplaceId);

    return [...keys];
  }

  const installedSkillsByKey = useMemo(() => {
    const nextInstalledByKey: Record<string, Skill> = {};
    const addLookupKey = (key: string, skill: Skill) => {
      if (!key || nextInstalledByKey[key]) {
        return;
      }
      nextInstalledByKey[key] = skill;
    };

    for (const skill of skills) {
      const candidates = [
        skill.name,
        skill.name?.toLowerCase(),
        normalizePluginLookupKey(skill.name),
      ].filter((value): value is string => Boolean(value));
      for (const key of candidates) {
        addLookupKey(key, skill);
      }
    }
    return nextInstalledByKey;
  }, [skills]);

  useEffect(() => {
    if (!skillsStorageChangeEvent) {
      return;
    }
    if (skillsStorageChangeEvent.reason === 'fallback') {
      setError({ text: t('skills.storagePathFallback') });
      return;
    }
    if (skillsStorageChangeEvent.reason === 'watcher_error') {
      setError({
        text: t('skills.storageWatcherError', {
          message: skillsStorageChangeEvent.message || '',
        }),
      });
    }
  }, [skillsStorageChangeEvent, t]);

  function showPluginInstallToast(message: string) {
    setPluginToastMessage(message);
    if (pluginToastTimerRef.current) {
      clearTimeout(pluginToastTimerRef.current);
    }
    pluginToastTimerRef.current = setTimeout(() => {
      setPluginToastMessage('');
      pluginToastTimerRef.current = null;
    }, 5000);
  }

  const loadSkills = useCallback(async (silent = false) => {
    try {
      const [skillsResult, storagePathResult] = await Promise.allSettled([
        window.electronAPI.skills.getAll(),
        window.electronAPI.skills.getStoragePath(),
      ]);
      const errors: string[] = [];

      if (skillsResult.status === 'fulfilled') {
        setSkills(skillsResult.value || []);
      } else {
        errors.push(
          skillsResult.reason instanceof Error
            ? skillsResult.reason.message
            : tRef.current('skills.failedToLoad')
        );
      }
      if (storagePathResult.status === 'fulfilled') {
        setStoragePath(storagePathResult.value || '');
      } else {
        errors.push(
          storagePathResult.reason instanceof Error
            ? storagePathResult.reason.message
            : tRef.current('skills.storagePathUnavailable')
        );
      }

      if (errors.length > 0) {
        throw new Error(errors.join(' | '));
      }

      if (!silent) {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      if (!silent) {
        setError({
          text:
            err instanceof Error && err.message
              ? `${tRef.current('skills.failedToLoad')}: ${err.message}`
              : tRef.current('skills.failedToLoad'),
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return () => {
        if (pluginToastTimerRef.current) {
          clearTimeout(pluginToastTimerRef.current);
        }
      };
    }

    void loadSkills();

    return () => {
      if (pluginToastTimerRef.current) {
        clearTimeout(pluginToastTimerRef.current);
      }
    };
  }, [isActive, loadSkills]);

  useEffect(() => {
    if (isElectron && isActive && skillsStorageChangedAt > 0) {
      void loadSkills(true);
    }
  }, [isActive, loadSkills, skillsStorageChangedAt]);

  async function loadPlugins(reset = true) {
    const nextPage = reset ? 1 : pluginPage + 1;
    try {
      if (reset) {
        setIsPluginLoading(true);
      } else {
        setIsPluginLoadingMore(true);
      }
      const [catalog, installed] = await Promise.all([
        window.electronAPI.plugins.listCatalog({
          installableOnly: false,
          source: 'skillhub',
          page: nextPage,
          pageSize: SKILLHUB_MARKET_PAGE_SIZE,
        }),
        window.electronAPI.plugins.listInstalled(),
      ]);
      const nextCatalog = catalog || [];
      setPlugins((current) => {
        if (reset) {
          return nextCatalog;
        }
        const seen = new Set(current.map((plugin) => plugin.pluginId || plugin.name));
        return [
          ...current,
          ...nextCatalog.filter((plugin) => !seen.has(plugin.pluginId || plugin.name)),
        ];
      });
      setPluginPage(nextPage);
      setHasMorePlugins(nextCatalog.length >= SKILLHUB_MARKET_PAGE_SIZE);
      const nextInstalledByKey: Record<string, InstalledPlugin> = {};
      const addLookupKey = (key: string, plugin: InstalledPlugin) => {
        if (!key || nextInstalledByKey[key]) {
          return;
        }
        nextInstalledByKey[key] = plugin;
      };
      for (const plugin of installed || []) {
        const candidates = [
          plugin.name,
          plugin.name?.toLowerCase(),
          normalizePluginLookupKey(plugin.name),
          plugin.pluginId,
          plugin.pluginId?.toLowerCase(),
          normalizePluginLookupKey(plugin.pluginId),
        ].filter((value): value is string => Boolean(value));
        for (const key of candidates) {
          addLookupKey(key, plugin);
        }
      }
      setInstalledPluginsByKey(nextInstalledByKey);
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      if (reset) {
        setIsPluginLoading(false);
      } else {
        setIsPluginLoadingMore(false);
      }
    }
  }

  async function handleBrowsePlugins() {
    setIsPluginModalOpen(true);
    setPluginPage(0);
    setHasMorePlugins(false);
    await Promise.all([loadSkills(true), loadPlugins(true)]);
  }

  async function handleInstall() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({
        type: 'folder.select',
        payload: {},
      });
      if (!folderPath) return;

      setIsLoading(true);
      const validation = await window.electronAPI.skills.validate(folderPath);

      if (!validation.valid) {
        setError({ text: `Invalid skill folder: ${validation.errors.join(', ')}` });
        return;
      }

      const result = await window.electronAPI.skills.install(folderPath);
      if (result.success) {
        await loadSkills();
        setError(null);
        setSuccess(null);
      }
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToInstall') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectStoragePath() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({
        type: 'folder.select',
        payload: {},
      });
      if (!folderPath) return;

      setIsLoading(true);
      const result = await window.electronAPI.skills.setStoragePath(folderPath, true);
      if (result.success) {
        setStoragePath(result.path);
        await loadSkills(true);
        setError(null);
        setSuccess({
          text: t('skills.storagePathUpdated', {
            migrated: result.migratedCount,
            skipped: result.skippedCount,
          }),
        });
        setTimeout(() => setSuccess(null), 5000);
      }
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t('skills.storagePathUpdateFailed'),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenStoragePath() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.skills.openStoragePath();
      if (!result.success) {
        setError({ text: result.error || t('skills.storagePathOpenFailed') });
        return;
      }
      setStoragePath(result.path);
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.storagePathOpenFailed') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefreshSkills() {
    setIsLoading(true);
    try {
      await loadSkills();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(skillId: string, skillName: string) {
    if (!confirm(t('skills.deleteSkill', { name: skillName }))) return;

    setIsLoading(true);
    try {
      await window.electronAPI.skills.delete(skillId);
      await loadSkills();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToDelete') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(skill: Skill) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.setEnabled(skill.id, !skill.enabled);
      await loadSkills();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToToggle') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleInstallPlugin(plugin: PluginCatalogItemV2) {
    const installTarget = plugin.pluginId ?? plugin.name;
    setPluginActionKey(`install:${installTarget}`);
    setError(null);
    setSuccess(null);
    try {
      if (plugin.catalogSource === 'skillhub') {
        const slug = plugin.skillHubSlug ?? installTarget.replace(/^skillhub:/i, '');
        const result = await window.electronAPI.skills.installFromSkillHub(slug);
        await loadSkills();
        await loadPlugins();
        const message = t('skills.skillHubInstallSuccess', { name: result.skill.name });
        setSuccess({ text: message });
        showPluginInstallToast(message);
        setTimeout(() => setSuccess(null), 4000);
        return;
      }

      const result = await window.electronAPI.plugins.install(installTarget);
      await loadSkills();
      await loadPlugins();
      const message = t('skills.pluginInstallSuccess', { name: result.plugin.name });
      setSuccess({ text: message });
      showPluginInstallToast(message);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetPluginEnabled(plugin: InstalledPlugin, enabled: boolean) {
    setPluginActionKey(`enabled:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setEnabled(plugin.pluginId, enabled);
      await loadPlugins();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetComponentEnabled(
    plugin: InstalledPlugin,
    component: PluginComponentKind,
    enabled: boolean
  ) {
    setPluginActionKey(`component:${plugin.pluginId}:${component}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setComponentEnabled(plugin.pluginId, component, enabled);
      await loadPlugins();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleUninstallPlugin(plugin: InstalledPlugin) {
    if (!confirm(t('skills.pluginUninstall', { name: plugin.name }))) {
      return;
    }

    setPluginActionKey(`uninstall:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.uninstall(plugin.pluginId);
      await loadPlugins();
      showPluginInstallToast(t('skills.pluginUninstalled', { name: plugin.name }));
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  const builtinSkills = skills.filter((s) => s.type === 'builtin');
  const customSkills = skills.filter((s) => s.type !== 'builtin');

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-[13px] text-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[13px] text-success">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {success.key ? t(success.key) : success.text}
        </div>
      )}

      <section className="glass-card rounded-xl px-3 py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-text-primary">
              {t('skills.storagePathTitle')}
            </h2>
            <p className="mt-1 break-all text-[12px] leading-5 text-text-secondary">
              {storagePath || t('skills.storagePathUnavailable')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
            <button
              onClick={handleSelectStoragePath}
              disabled={isLoading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/68 px-3 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {t('skills.selectStoragePath')}
            </button>
            <button
              onClick={handleOpenStoragePath}
              disabled={isLoading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/68 px-3 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <Globe className="h-4 w-4" />
              {t('skills.openStoragePath')}
            </button>
            <button
              onClick={handleRefreshSkills}
              disabled={isLoading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/68 px-3 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {t('skills.refreshSkills')}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {t('skills.builtinSkills')}
          </h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-accent/10 px-1.5 text-xs font-medium text-accent">
            {builtinSkills.length}
          </span>
        </div>
        <div className="glass-card overflow-hidden rounded-xl">
          {builtinSkills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onToggleEnabled={() => handleToggleEnabled(skill)}
              onDelete={null}
              isLoading={isLoading}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold text-text-primary">{t('skills.customSkills')}</h2>
        <div className="glass-card overflow-hidden rounded-xl">
          {customSkills.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-3 text-text-muted">
              <Package className="h-8 w-8 flex-shrink-0 opacity-45" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-primary">
                  {t('skills.noCustomSkills')}
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-text-muted">
                  {t('skills.installSkillsDesc')}
                </p>
              </div>
            </div>
          ) : (
            customSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                onToggleEnabled={() => handleToggleEnabled(skill)}
                onDelete={() => handleDelete(skill.id, skill.name)}
                isLoading={isLoading}
              />
            ))
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          onClick={handleBrowsePlugins}
          disabled={isLoading || isPluginLoading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border-muted bg-background/42 px-3 text-[13px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          {isPluginLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Package className="h-4 w-4" />
          )}
          {t('skills.browsePlugins')}
        </button>
        <button
          onClick={handleInstall}
          disabled={isLoading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border-muted bg-background/42 px-3 text-[13px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t('skills.installSkillFromFolder')}
        </button>
      </div>

      {isPluginModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border border-border bg-surface shadow-elevated">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">
                {t('skills.pluginListTitle')}
              </h3>
              <button
                onClick={() => setIsPluginModalOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              {isPluginLoading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-text-secondary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t('common.loading')}</span>
                </div>
              ) : plugins.length === 0 ? (
                <div className="py-8 text-center text-text-muted">{t('skills.noPluginsFound')}</div>
              ) : (
                <>
                  {plugins.map((plugin) => (
                    <div
                      key={plugin.pluginId || plugin.name}
                      className="rounded-lg border border-border bg-surface-hover p-4"
                    >
                      {(() => {
                        const installedPlugin = getCatalogLookupKeys(plugin)
                          .map((key) => installedPluginsByKey[key])
                          .find((item): item is InstalledPlugin => Boolean(item));
                        const installedSkill = getCatalogLookupKeys(plugin)
                          .map((key) => installedSkillsByKey[key])
                          .find((item): item is Skill => Boolean(item));
                        const installTarget = plugin.pluginId ?? plugin.name;
                        const isInstalling = pluginActionKey === `install:${installTarget}`;
                        const componentEntries = componentOrder.filter(
                          (component) => plugin.componentCounts[component] > 0
                        );
                        const isSkillHubCatalog = plugin.catalogSource === 'skillhub';
                        const isMarketplaceCatalog = plugin.catalogSource === 'claude-marketplace';
                        const hasKnownComponents = componentEntries.length > 0;
                        const isInstallable = plugin.installable;
                        const isInstalled = Boolean(installedPlugin || installedSkill);
                        return (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-medium text-text-primary truncate">
                                    {plugin.name}
                                  </h4>
                                  {plugin.version && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-surface text-text-muted">
                                      v{plugin.version}
                                    </span>
                                  )}
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      isSkillHubCatalog
                                        ? 'bg-success/10 text-success'
                                        : 'bg-accent/10 text-accent'
                                    }`}
                                  >
                                    {isSkillHubCatalog
                                      ? t('skills.skillHubSource')
                                      : t('skills.claudeMarketplaceSource')}
                                  </span>
                                </div>
                                {plugin.description && (
                                  <p className="text-sm text-text-muted line-clamp-2">
                                    {plugin.description}
                                  </p>
                                )}
                                {isSkillHubCatalog ? (
                                  <p className="text-xs text-text-muted mt-2">
                                    {plugin.requiresApiKey
                                      ? t('skills.skillHubRequiresApiKey')
                                      : t('skills.skillHubSkillPackage')}
                                  </p>
                                ) : hasKnownComponents ? (
                                  <p className="text-xs text-text-muted mt-2">
                                    {t('skills.pluginComponents', {
                                      skills: plugin.componentCounts.skills,
                                      commands: plugin.componentCounts.commands,
                                      agents: plugin.componentCounts.agents,
                                      hooks: plugin.componentCounts.hooks,
                                      mcp: plugin.componentCounts.mcp,
                                    })}
                                  </p>
                                ) : (
                                  isMarketplaceCatalog &&
                                  !installedPlugin && (
                                    <p className="text-xs text-text-muted mt-2">
                                      {t('skills.pluginComponentsAvailableAfterInstall')}
                                    </p>
                                  )
                                )}
                                {hasKnownComponents &&
                                  plugin.componentCounts.hooks > 0 &&
                                  !installedPlugin && (
                                    <p className="text-xs text-warning mt-1">
                                      {t('skills.pluginComponentHooksDisabledByDefault')}
                                    </p>
                                  )}
                                {hasKnownComponents &&
                                  plugin.componentCounts.mcp > 0 &&
                                  !installedPlugin && (
                                    <p className="text-xs text-warning mt-1">
                                      {t('skills.pluginComponentMcpDisabledByDefault')}
                                    </p>
                                  )}
                                {!isInstallable && !isMarketplaceCatalog && (
                                  <p className="text-xs text-error mt-1">
                                    {t('skills.pluginNoComponents')}
                                  </p>
                                )}
                              </div>
                              {isInstalled ? (
                                <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                                  <CheckCircle className="w-4 h-4" />
                                  {t('skills.pluginInstalled')}
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleInstallPlugin(plugin)}
                                  disabled={!isInstallable || pluginActionKey !== null}
                                  className="px-3 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                  {isInstalling ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      {t('common.install')}
                                    </span>
                                  ) : (
                                    t('skills.pluginInstall')
                                  )}
                                </button>
                              )}
                            </div>
                            {installedPlugin && (
                              <div className="mt-3 pt-3 border-t border-border space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs text-text-muted">
                                    {installedPlugin.enabled
                                      ? t('skills.pluginAppliedInRuntime')
                                      : t('skills.pluginDisabled')}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() =>
                                        handleSetPluginEnabled(
                                          installedPlugin,
                                          !installedPlugin.enabled
                                        )
                                      }
                                      disabled={pluginActionKey !== null}
                                      className={`px-3 py-1.5 rounded-md text-xs ${
                                        installedPlugin.enabled
                                          ? 'bg-warning/10 text-warning hover:bg-warning/20'
                                          : 'bg-success/10 text-success hover:bg-success/20'
                                      } disabled:opacity-50`}
                                    >
                                      {installedPlugin.enabled
                                        ? t('skills.pluginDisable')
                                        : t('skills.pluginEnable')}
                                    </button>
                                    <button
                                      onClick={() => handleUninstallPlugin(installedPlugin)}
                                      disabled={pluginActionKey !== null}
                                      className="px-3 py-1.5 rounded-md text-xs bg-error/10 text-error hover:bg-error/20 disabled:opacity-50"
                                    >
                                      {t('skills.pluginManageUninstall')}
                                    </button>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  {componentEntries.map((component) => {
                                    const enabled = installedPlugin.componentsEnabled[component];
                                    return (
                                      <div
                                        key={`${installedPlugin.pluginId}:${component}`}
                                        className="flex items-center justify-between gap-2"
                                      >
                                        <div className="text-xs text-text-secondary">
                                          <span className="font-medium">{component}</span>
                                          <span className="text-text-muted">
                                            {' '}
                                            ({plugin.componentCounts[component]})
                                          </span>
                                        </div>
                                        <button
                                          onClick={() =>
                                            handleSetComponentEnabled(
                                              installedPlugin,
                                              component,
                                              !enabled
                                            )
                                          }
                                          disabled={pluginActionKey !== null}
                                          className={`px-2 py-1 rounded text-xs ${
                                            enabled
                                              ? 'bg-success/10 text-success hover:bg-success/20'
                                              : 'bg-surface text-text-muted hover:bg-surface-active'
                                          } disabled:opacity-50`}
                                        >
                                          {enabled
                                            ? t('skills.pluginDisable')
                                            : t('skills.pluginEnable')}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {hasMorePlugins && (
                    <button
                      type="button"
                      onClick={() => loadPlugins(false)}
                      disabled={isPluginLoadingMore}
                      className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/52 px-3 text-[13px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                    >
                      {isPluginLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('skills.loadMore')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {pluginToastMessage && (
        <div className="fixed right-6 bottom-6 z-[80] max-w-md rounded-lg border border-success/30 bg-surface px-4 py-3 shadow-elevated">
          <div className="flex items-start gap-2 text-success text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{pluginToastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  onToggleEnabled,
  onDelete,
  isLoading,
}: {
  skill: Skill;
  onToggleEnabled: () => void;
  onDelete: (() => void) | null;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const isBuiltin = skill.type === 'builtin';

  return (
    <div className="flex min-h-[64px] items-center gap-3 border-b border-border-muted px-3 py-2.5 last:border-b-0">
      <div
        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          skill.enabled ? 'bg-success' : 'bg-text-muted'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[14px] font-medium text-text-primary">{skill.name}</h3>
          <span
            className={`inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium leading-none ${
              isBuiltin
                ? 'border-accent/20 bg-accent/5 text-accent'
                : skill.type === 'mcp'
                  ? 'border-mcp/20 bg-mcp/5 text-mcp'
                  : 'border-success/20 bg-success/5 text-success'
            }`}
          >
            {skill.type.toUpperCase()}
          </span>
        </div>
        {skill.description && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-text-muted">
            {skill.description}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          onClick={onToggleEnabled}
          disabled={isLoading}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
            skill.enabled
              ? 'text-success hover:bg-success/10'
              : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
          }`}
          title={skill.enabled ? t('common.disable') : t('common.enable')}
        >
          {skill.enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-md text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            title={t('common.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
