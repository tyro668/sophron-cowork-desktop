// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PluginCatalogItemV2, Skill } from '../src/shared/contracts';
import {
  getCatalogLookupKeys,
  getInstalledSkillLookupKeys,
  normalizePluginLookupKey,
} from '../src/renderer/components/settings/SettingsSkills';

const catalogItem = (overrides: Partial<PluginCatalogItemV2>): PluginCatalogItemV2 => ({
  name: 'item',
  installable: true,
  hasManifest: false,
  componentCounts: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0 },
  ...overrides,
});

const installedSkill = (overrides: Partial<Skill>): Skill => ({
  id: 'global-x',
  name: 'x',
  type: 'custom',
  enabled: true,
  createdAt: 0,
  ...overrides,
});

const intersects = (a: string[], b: string[]) => a.some((key) => b.includes(key));

describe('SkillHub installed-detection', () => {
  it('matches a catalog item to an installed skill by canonical slug', () => {
    const keys = getCatalogLookupKeys(
      catalogItem({
        name: '编程专家.Skill',
        pluginId: 'skillhub:@indiv-ebandao/dev-expert',
        skillHubSlug: '@indiv-ebandao/dev-expert',
        catalogSource: 'skillhub',
      })
    );
    const installed = getInstalledSkillLookupKeys(
      installedSkill({ name: 'dev-expert', path: '/data/skills/dev-expert' })
    );
    expect(intersects(keys, installed)).toBe(true);
  });

  it('matches via the bare slug persisted in _meta.json', () => {
    const keys = getCatalogLookupKeys(
      catalogItem({
        name: '编程专家.Skill',
        pluginId: 'skillhub:@indiv-ebandao/dev-expert',
        skillHubSlug: '@indiv-ebandao/dev-expert',
        catalogSource: 'skillhub',
      })
    );
    const installed = getInstalledSkillLookupKeys(
      installedSkill({
        name: '编程专家',
        path: '/data/skills/编程专家',
        skillHubSlug: 'dev-expert',
      })
    );
    expect(intersects(keys, installed)).toBe(true);
  });

  it('does not emit a junk marketplace alias for skillhub plugin ids', () => {
    const keys = getCatalogLookupKeys(
      catalogItem({
        pluginId: 'skillhub:@h/foo',
        skillHubSlug: '@h/foo',
        catalogSource: 'skillhub',
      })
    );
    expect(keys).not.toContain('skillhub:');
    expect(keys).not.toContain('skillhub');
  });

  it('normalizes CJK display names and strips .skill suffixes', () => {
    expect(normalizePluginLookupKey('编程专家.Skill')).toBe('编程专家');
    expect(normalizePluginLookupKey('编程专家')).toBe('编程专家');
    expect(normalizePluginLookupKey('Dev-Expert.SKILL')).toBe('dev-expert');
  });
});
