/**
 * Cross-process skills contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */

// Skills types
export interface Skill {
  id: string;
  name: string;
  description?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  supportFeatures?: string[];
  path?: string;
  type: SkillType;
  enabled: boolean;
  /** SkillHub package slug persisted from `_meta.json` when installed from the hub. */
  skillHubSlug?: string;
  config?: Record<string, unknown>;
  createdAt: number;
}

export type SkillType = 'builtin' | 'mcp' | 'custom';

export type PluginComponentKind = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp';

export interface PluginComponentCounts {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
}

export interface PluginComponentEnabledState {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
}

export interface PluginCatalogItemV2 {
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  installable: boolean;
  hasManifest: boolean;
  componentCounts: PluginComponentCounts;
  pluginId?: string;
  skillHubSlug?: string;
  installCommand?: string;
  detailUrl?: string;
  catalogSource?: 'claude-marketplace' | 'skillhub';
  requiresApiKey?: boolean;
}

export type PluginCatalogSource = NonNullable<PluginCatalogItemV2['catalogSource']>;

export interface PluginCatalogItem extends PluginCatalogItemV2 {
  skillCount: number;
  hasSkills: boolean;
}

export interface InstalledPlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  enabled: boolean;
  sourcePath: string;
  runtimePath: string;
  componentCounts: PluginComponentCounts;
  componentsEnabled: PluginComponentEnabledState;
  installedAt: number;
  updatedAt: number;
}

export interface PluginInstallResultV2 {
  plugin: InstalledPlugin;
  installedSkills: string[];
  warnings: string[];
}

export interface PluginToggleResult {
  success: boolean;
  plugin: InstalledPlugin;
}

export interface PluginInstallResult {
  pluginName: string;
  installedSkills: string[];
  skippedSkills: string[];
  errors: string[];
}

export interface SkillsStorageChangeEvent {
  path: string;
  reason: 'updated' | 'path_changed' | 'fallback' | 'watcher_error';
  message?: string;
}
