import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  Package,
  Trash2,
  Plus,
  Power,
  PowerOff,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Skill, PluginCatalogItemV2, InstalledPlugin } from '../../types';
import { useAppStore } from '../../store';
import type { LocalizedBanner } from './shared';
import { getLocalizedSkillDescription } from '../../utils/localized-skill';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  underlineTabTriggerClass,
} from '../data-view/shared';
import { useConfirmDialog } from '../ConfirmDialog';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const SKILLHUB_MARKET_PAGE_SIZE = 50;
const SKILL_TABLE_PAGE_SIZE = 10;

type SkillWorkspaceTab = 'installed' | 'builtin' | 'market';

type SkillTableItem =
  | {
      kind: 'skill';
      id: string;
      name: string;
      description: string;
      type: Skill['type'];
      typeLabel: string;
      enabled: boolean;
      updatedAt: number;
      raw: Skill;
      tags: string[];
    }
  | {
      kind: 'plugin';
      id: string;
      name: string;
      description: string;
      type: 'plugin';
      typeLabel: string;
      enabled: boolean;
      updatedAt: number;
      raw: PluginCatalogItemV2;
      installed: boolean;
      tags: string[];
    };

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

export function SettingsSkills({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const skillsStorageChangeEvent = useAppStore((state) => state.skillsStorageChangeEvent);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [plugins, setPlugins] = useState<PluginCatalogItemV2[]>([]);
  const [installedPluginsByKey, setInstalledPluginsByKey] = useState<
    Record<string, InstalledPlugin>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [isPluginLoadingMore, setIsPluginLoadingMore] = useState(false);
  const pluginPageRef = useRef(0);
  const [hasMorePlugins, setHasMorePlugins] = useState(false);
  const [pluginActionKey, setPluginActionKey] = useState<string | null>(null);
  const [pluginToastMessage, setPluginToastMessage] = useState('');
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<SkillWorkspaceTab>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pluginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const skillsResult = await window.electronAPI.skills.getAll();
      setSkills(skillsResult || []);
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

  const loadPlugins = useCallback(
    async (reset = true) => {
      const nextPage = reset ? 1 : pluginPageRef.current + 1;
      try {
        if (!reset) {
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
        pluginPageRef.current = nextPage;
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
        if (!reset) {
          setIsPluginLoadingMore(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    if (!isElectron || !isActive) {
      return () => {
        if (pluginToastTimerRef.current) {
          clearTimeout(pluginToastTimerRef.current);
        }
      };
    }

    void loadSkills();
    void loadPlugins(true);

    return () => {
      if (pluginToastTimerRef.current) {
        clearTimeout(pluginToastTimerRef.current);
      }
    };
  }, [isActive, loadPlugins, loadSkills]);

  useEffect(() => {
    if (isElectron && isActive && skillsStorageChangedAt > 0) {
      void loadSkills(true);
    }
  }, [isActive, loadSkills, skillsStorageChangedAt]);

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

  async function handleDelete(skillId: string, skillName: string) {
    const confirmed = await confirmDelete({
      message: t('skills.deleteSkill', { name: skillName }),
    });
    if (!confirmed) return;

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
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToToggle') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenSkillPath(skill: Skill) {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.skills.openSkillPath(skill.id);
      if (!result.success) {
        setError({ text: result.error || t('skills.skillPathOpenFailed') });
        return;
      }
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.skillPathOpenFailed') });
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

  const language = i18n.resolvedLanguage || i18n.language;

  const tableItems = useMemo<SkillTableItem[]>(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const skillRows = skills
      .filter((skill) => {
        if (activeWorkspaceTab === 'builtin' && skill.type !== 'builtin') return false;
        if (activeWorkspaceTab === 'market') return false;
        if (!query) return true;
        const description = getLocalizedSkillDescription(skill, language);
        return `${skill.name} ${description} ${skill.type}`.toLocaleLowerCase().includes(query);
      })
      .map((skill) => {
        const description = getLocalizedSkillDescription(skill, language);
        return {
          kind: 'skill' as const,
          id: `skill:${skill.id}`,
          name: skill.name,
          description,
          type: skill.type,
          typeLabel: t(`skills.skillTypes.${skill.type}`, { defaultValue: skill.type }),
          enabled: skill.enabled,
          updatedAt: skill.createdAt,
          raw: skill,
          tags: getSkillSupportFeatures(skill, description),
        };
      });

    const pluginRows =
      activeWorkspaceTab === 'market'
        ? plugins
            .filter((plugin) => {
              if (!query) return true;
              return `${plugin.name} ${plugin.description ?? ''} ${plugin.catalogSource ?? ''}`
                .toLocaleLowerCase()
                .includes(query);
            })
            .map((plugin) => {
              const installedPlugin = getCatalogLookupKeys(plugin)
                .map((key) => installedPluginsByKey[key])
                .find((item): item is InstalledPlugin => Boolean(item));
              const installedSkill = getCatalogLookupKeys(plugin)
                .map((key) => installedSkillsByKey[key])
                .find((item): item is Skill => Boolean(item));
              const installed = Boolean(installedPlugin || installedSkill);
              return {
                kind: 'plugin' as const,
                id: `plugin:${plugin.pluginId || plugin.skillHubSlug || plugin.name}`,
                name: plugin.name,
                description: plugin.description || t('skills.skillHubSkillPackage'),
                type: 'plugin' as const,
                typeLabel: t('skills.skillTypes.plugin', { defaultValue: '插件' }),
                enabled: installed,
                updatedAt: installedPlugin?.updatedAt ?? installedSkill?.createdAt ?? 0,
                raw: plugin,
                installed,
                tags: getPluginTags(plugin, t),
              };
            })
        : [];

    return [...skillRows, ...pluginRows];
  }, [
    activeWorkspaceTab,
    installedPluginsByKey,
    installedSkillsByKey,
    language,
    plugins,
    searchQuery,
    skills,
    t,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeWorkspaceTab, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(tableItems.length / SKILL_TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageItems = tableItems.slice(
    (safeCurrentPage - 1) * SKILL_TABLE_PAGE_SIZE,
    safeCurrentPage * SKILL_TABLE_PAGE_SIZE
  );
  const selectedItem =
    tableItems.find((item) => item.id === selectedSkillId) ?? tableItems[0] ?? null;
  const selectedSkill = selectedItem?.kind === 'skill' ? selectedItem.raw : null;
  const selectedPlugin = selectedItem?.kind === 'plugin' ? selectedItem.raw : null;
  const selectedPluginInstalled = selectedItem?.kind === 'plugin' ? selectedItem.installed : false;
  const SelectedIcon = selectedItem
    ? getSkillVisualIcon(selectedItem.name, selectedItem.type)
    : Package;
  const hasNextPage =
    safeCurrentPage < pageCount || (activeWorkspaceTab === 'market' && hasMorePlugins);

  const handleBrowseMarket = async () => {
    setActiveWorkspaceTab('market');
    await loadPlugins(true);
  };

  const handleSelectedDelete = async () => {
    if (selectedSkill && selectedSkill.type !== 'builtin') {
      await handleDelete(selectedSkill.id, selectedSkill.name);
      return;
    }
    if (selectedPlugin && !selectedPluginInstalled) {
      await handleInstallPlugin(selectedPlugin);
    }
  };

  const handleNextPage = async () => {
    if (safeCurrentPage < pageCount) {
      setCurrentPage((page) => Math.min(pageCount, page + 1));
      return;
    }
    if (activeWorkspaceTab === 'market' && hasMorePlugins && !isPluginLoadingMore) {
      await loadPlugins(false);
      setCurrentPage((page) => page + 1);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {error && (
        <div className="mb-3 flex flex-shrink-0 items-center gap-2 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-[13px] text-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}
      {success && (
        <div className="mb-3 flex flex-shrink-0 items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[13px] text-success">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {success.key ? t(success.key) : success.text}
        </div>
      )}

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 flex-shrink-0 items-end gap-3 border-b border-border-subtle">
          <Tabs
            value={activeWorkspaceTab}
            onValueChange={(v) => {
              if (v === 'market') void handleBrowseMarket();
              else setActiveWorkspaceTab(v as SkillWorkspaceTab);
            }}
          >
            <TabsList className="inline-flex items-end gap-3 rounded-none border-0 bg-transparent p-0">
              <TabsTrigger value="installed" className={underlineTabTriggerClass}>
                {t('skills.workspace.installedTab')}
              </TabsTrigger>
              <TabsTrigger value="builtin" className={underlineTabTriggerClass}>
                {t('skills.workspace.builtinTab')}
              </TabsTrigger>
              <TabsTrigger value="market" className={underlineTabTriggerClass}>
                {t('skills.workspace.marketTab')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="mt-3 flex flex-shrink-0 flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center">
            <DataTableSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('skills.workspace.searchPlaceholder')}
            />
          </div>

          {activeWorkspaceTab === 'market' && (
            <div className="flex flex-shrink-0 items-center gap-2">
              <DataToolbarButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label={
                  selectedPluginInstalled ? t('skills.pluginInstalled') : t('skills.pluginInstall')
                }
                onClick={() => void handleSelectedDelete()}
                disabled={
                  !selectedPlugin ||
                  selectedPluginInstalled ||
                  pluginActionKey !== null ||
                  isLoading
                }
              />

              <DataMoreMenu
                items={[
                  {
                    key: 'refresh',
                    label: t('skills.refreshSkills'),
                    icon: <RefreshCw className="h-3.5 w-3.5" />,
                    onClick: () => void loadPlugins(true),
                  },
                  {
                    key: 'install-folder',
                    label: t('skills.installSkillFromFolder'),
                    icon: <Plus className="h-3.5 w-3.5" />,
                    onClick: () => void handleInstall(),
                  },
                ]}
              />
            </div>
          )}

          {activeWorkspaceTab !== 'market' && (
            <div className="flex flex-shrink-0 items-center gap-2">
              <DataToolbarButton
                icon={
                  selectedSkill?.enabled ? (
                    <PowerOff className="h-3.5 w-3.5" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )
                }
                label={
                  selectedSkill?.enabled ? t('skills.pluginDisable') : t('skills.pluginEnable')
                }
                onClick={() => selectedSkill && void handleToggleEnabled(selectedSkill)}
                disabled={!selectedSkill || isLoading}
              />

              <DataToolbarButton
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                label={t('skills.openSkillPath')}
                onClick={() => selectedSkill && void handleOpenSkillPath(selectedSkill)}
                disabled={!selectedSkill || isLoading}
              />
            </div>
          )}
        </div>

        <div
          className={`mt-3 grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden ${selectedItem ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}
        >
          <div className="glass-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl">
            <div className="grid h-10 flex-shrink-0 grid-cols-[36px_minmax(0,1fr)_76px_86px] items-center border-b border-border-muted bg-[var(--data-grid-header-surface)] px-3 text-xs font-medium text-text-muted 2xl:grid-cols-[36px_minmax(0,1fr)_84px_92px_104px]">
              <span />
              <span>{t('skills.workspace.table.skill')}</span>
              <span>{t('skills.workspace.table.type')}</span>
              <span>{t('skills.workspace.table.status')}</span>
              <span className="hidden 2xl:block">{t('skills.workspace.table.updatedAt')}</span>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {pageItems.length === 0 ? (
                <EmptyState
                  label={t('skills.workspace.emptyTitle')}
                  description={t(
                    searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.skillsHint'
                  )}
                  action={
                    searchQuery.trim() ? (
                      <Button variant="secondary" onClick={() => setSearchQuery('')}>
                        {t('workspaceEmpty.clearSearch')}
                      </Button>
                    ) : (
                      activeWorkspaceTab !== 'market' && (
                        <Button
                          variant="primary"
                          onClick={() => void handleBrowseMarket()}
                          className="shadow-soft"
                        >
                          {t('skills.workspace.marketTab')}
                        </Button>
                      )
                    )
                  }
                />
              ) : (
                pageItems.map((item) => (
                  <SkillTableRow
                    key={item.id}
                    item={item}
                    selected={selectedItem?.id === item.id}
                    onSelect={() => setSelectedSkillId(item.id)}
                  />
                ))
              )}
            </div>

            <div className="flex min-h-11 flex-shrink-0 items-center justify-between gap-2 border-t border-border-muted px-4 py-1 text-xs font-medium text-text-secondary">
              <span className="min-w-0 truncate">
                {t('skills.workspace.totalCount', {
                  count: tableItems.length,
                  defaultValue: `共 ${tableItems.length} 个技能`,
                })}
              </span>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="inline-flex h-8 items-center rounded-lg border border-border-muted bg-surface px-3">
                  {t('data.rowsPerPage', { count: SKILL_TABLE_PAGE_SIZE })}
                </span>
                {pageCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage <= 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-accent/25 bg-accent-muted px-2 text-accent">
                  {safeCurrentPage}
                </span>
                {(pageCount > 1 || hasNextPage) && (
                  <button
                    type="button"
                    onClick={() => void handleNextPage()}
                    disabled={!hasNextPage || isPluginLoadingMore}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isPluginLoadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {selectedItem && (
            <aside className="glass-card hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-xl p-4 xl:flex">
              <>
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
                    <SelectedIcon className="h-7 w-7" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[16px] font-semibold text-text-primary">
                      {selectedItem.name}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SkillTypeBadge item={selectedItem} />
                      <SkillStatusBadge item={selectedItem} />
                    </div>
                  </div>
                </div>

                <p className="mt-4 line-clamp-4 break-words text-[13px] leading-5 text-text-secondary">
                  {selectedItem.description || t('skills.installSkillsDesc')}
                </p>

                <div className="mt-4 border-t border-border-muted pt-4">
                  <h4 className="text-[13px] font-semibold text-text-primary">
                    {t('skills.workspace.supportedCapabilities')}
                  </h4>
                  <div className="mt-3 space-y-2">
                    {selectedItem.tags.map((tag) => (
                      <div
                        key={`${selectedItem.id}:${tag}`}
                        className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-secondary"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate" title={tag}>
                          {tag}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <dl className="mt-4 space-y-3 border-t border-border-muted pt-4 text-[12px]">
                  <div>
                    <dt className="font-semibold text-text-primary">
                      {t('skills.workspace.table.updatedAt')}
                    </dt>
                    <dd className="mt-1 text-text-secondary">
                      {formatSkillDate(selectedItem.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-text-primary">
                      {t('skills.workspace.source')}
                    </dt>
                    <dd className="mt-1 text-text-secondary">
                      {selectedItem.kind === 'plugin'
                        ? t('skills.skillHubSource')
                        : selectedItem.type === 'builtin'
                          ? t('skills.workspace.systemBuiltin')
                          : t('skills.customSkills')}
                    </dd>
                  </div>
                </dl>

                {(selectedPlugin || (selectedSkill && selectedSkill.type !== 'builtin')) && (
                  <div className="mt-auto pt-4">
                    <button
                      type="button"
                      onClick={() => void handleSelectedDelete()}
                      disabled={
                        (!selectedPlugin && (!selectedSkill || selectedSkill.type === 'builtin')) ||
                        selectedPluginInstalled ||
                        pluginActionKey !== null ||
                        isLoading
                      }
                      className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        selectedPlugin
                          ? 'border-accent/20 bg-accent-muted text-accent hover:bg-accent-muted'
                          : 'border-error/20 bg-error/5 text-error hover:bg-error/10'
                      }`}
                    >
                      {selectedPlugin ? (
                        <Plus className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {selectedPlugin
                        ? selectedPluginInstalled
                          ? t('skills.pluginInstalled')
                          : t('skills.pluginInstall')
                        : t('skills.pluginManageUninstall')}
                    </button>
                  </div>
                )}
              </>
            </aside>
          )}
        </div>
      </section>

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

function SkillTableRow({
  item,
  selected,
  onSelect,
}: {
  item: SkillTableItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = getSkillVisualIcon(item.name, item.type);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`grid h-[3.25rem] w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)_76px_86px] items-center border-b border-border-muted/85 px-3 text-left transition-colors last:border-b-0 2xl:grid-cols-[36px_minmax(0,1fr)_84px_92px_104px] ${
        selected ? 'bg-accent-muted ring-1 ring-inset ring-accent/20' : 'hover:bg-surface-hover/35'
      }`}
    >
      <span className="flex items-center">
        <input
          type="radio"
          name="skill-selection"
          checked={selected}
          onChange={onSelect}
          onClick={(event) => event.stopPropagation()}
          className="h-3.5 w-3.5 accent-accent"
          aria-label={item.name}
        />
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-text-secondary">
            {item.name}
          </span>
        </span>
      </span>
      <span className="min-w-0">
        <SkillTypeBadge item={item} />
      </span>
      <span className="min-w-0">
        <SkillStatusBadge item={item} />
      </span>
      <span className="hidden truncate text-[12px] font-medium text-text-secondary 2xl:block">
        {formatSkillDate(item.updatedAt)}
      </span>
    </div>
  );
}

function SkillTypeBadge({ item }: { item: SkillTableItem }) {
  return (
    <span
      className={`inline-flex h-6 max-w-full items-center rounded-full px-2 text-xs font-medium ${
        item.type === 'plugin'
          ? 'bg-mcp/10 text-mcp'
          : item.type === 'builtin'
            ? 'bg-accent-muted text-accent'
            : item.type === 'mcp'
              ? 'bg-mcp/10 text-mcp'
              : 'bg-success/10 text-success'
      }`}
    >
      <span className="truncate">{item.typeLabel}</span>
    </span>
  );
}

function SkillStatusBadge({ item }: { item: SkillTableItem }) {
  const { t } = useTranslation();
  const installable = item.kind === 'plugin' && !item.installed;

  return (
    <span
      className={`inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium ${
        installable
          ? 'bg-warning/10 text-warning'
          : item.enabled
            ? 'bg-success/10 text-success'
            : 'bg-text-muted/10 text-text-muted'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
          installable ? 'bg-warning' : item.enabled ? 'bg-success' : 'bg-text-muted'
        }`}
      />
      <span className="truncate">
        {installable
          ? t('skills.workspace.installable')
          : item.enabled
            ? t('skills.workspace.enabled')
            : t('skills.workspace.disabled')}
      </span>
    </span>
  );
}

function getSkillVisualIcon(name: string, type: Skill['type'] | 'plugin'): LucideIcon {
  const normalized = name.toLowerCase();
  if (normalized.includes('github')) return GitBranch;
  if (normalized.includes('pdf') || normalized.includes('document')) return FileText;
  if (normalized.includes('table') || normalized.includes('excel') || normalized.includes('sheet'))
    return Table2;
  if (normalized.includes('data') || normalized.includes('分析')) return BarChart3;
  if (type === 'plugin') return ShoppingBag;
  if (type === 'builtin') return Layers;
  return Package;
}

function normalizeSkillFeature(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSkillSupportFeatures(skill: Skill, fallbackDescription: string): string[] {
  const features = (skill.supportFeatures ?? [])
    .map(normalizeSkillFeature)
    .filter((feature) => feature.length > 0)
    .slice(0, 6);

  if (features.length > 0) {
    return features;
  }

  return fallbackDescription
    .split(/,|;|；|、|\band\b/i)
    .map(normalizeSkillFeature)
    .filter((feature) => feature.length > 0)
    .slice(0, 6);
}

function getPluginTags(
  plugin: PluginCatalogItemV2,
  t: ReturnType<typeof useTranslation>['t']
): string[] {
  const tags = [
    t('skills.workspace.capabilities.onlineInstall'),
    plugin.requiresApiKey
      ? t('skills.workspace.capabilities.apiConfig')
      : t('skills.workspace.capabilities.readyToUse'),
  ];
  if (plugin.componentCounts.skills > 0) tags.push(t('skills.workspace.capabilities.skillPackage'));
  if (plugin.componentCounts.commands > 0)
    tags.push(t('skills.workspace.capabilities.commandActions'));
  return tags.slice(0, 4);
}

function formatSkillDate(value?: number): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
