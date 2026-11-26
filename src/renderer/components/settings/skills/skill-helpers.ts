import type { TFunction } from 'i18next';
import {
  BarChart3,
  FileText,
  GitBranch,
  Layers,
  Package,
  ShoppingBag,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { PluginCatalogItemV2, Skill } from '../../../types';
import { formatAppDateTime } from '../../../utils/i18n-format';

export type SkillWorkspaceTab = 'installed' | 'builtin' | 'market';

export type SkillTableItem =
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

export function normalizePluginLookupKey(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .trim()
    .replace(/\.skills?$/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function getCatalogLookupKeys(plugin: PluginCatalogItemV2): string[] {
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

  // Canonical "@handle/slug" identities also key by the bare slug — the
  // installed package records only the slug in its `_meta.json`.
  const bareSlug = plugin.skillHubSlug?.split('/').pop();
  addKey(bareSlug);
  if (bareSlug) {
    addKey(`skillhub:${bareSlug}`);
  }

  // Marketplace alias ("name@source" → "name") only applies to
  // claude-marketplace ids; skillhub ids are "skillhub:<canonical>".
  if (plugin.catalogSource !== 'skillhub') {
    addKey(plugin.pluginId?.split('@')[0]);
  }

  return [...keys];
}

/** Lookup keys identifying an installed skill for catalog installed-detection. */
export function getInstalledSkillLookupKeys(skill: Skill): string[] {
  const dirName = skill.path?.split(/[/\\]/).filter(Boolean).pop();
  return [
    skill.name,
    skill.name?.toLowerCase(),
    normalizePluginLookupKey(skill.name),
    dirName,
    normalizePluginLookupKey(dirName),
    skill.skillHubSlug,
    skill.skillHubSlug ? `skillhub:${skill.skillHubSlug}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function getSkillVisualIcon(name: string, type: Skill['type'] | 'plugin'): LucideIcon {
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

export function getSkillSupportFeatures(skill: Skill, fallbackDescription: string): string[] {
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

export function getPluginTags(plugin: PluginCatalogItemV2, t: TFunction): string[] {
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

export function formatSkillDate(value?: number): string {
  if (!value) return '—';
  return formatAppDateTime(value);
}

/** Usage is logged by skill name or skill directory name; match either, case-insensitively. */
export function skillUsageCount(
  counts: Record<string, number>,
  skill: { name: string; path?: string }
): number {
  const keys = new Set(
    [skill.name, skill.path?.replace(/\\/g, '/').split('/').filter(Boolean).pop()]
      .filter((key): key is string => Boolean(key))
      .map((key) => key.toLocaleLowerCase())
  );
  let total = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (keys.has(name.toLocaleLowerCase())) total += count;
  }
  return total;
}
