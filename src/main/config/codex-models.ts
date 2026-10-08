/**
 * Model list for the OpenAI Codex subscription provider.
 *
 * The Codex CLI stores the account's live catalog in `~/.codex/models_cache.json`
 * (`visibility: "list"` is what the CLI picker shows). The bundled preset is only
 * the fallback when that file is missing or older than the app's known lineup.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logWarn } from '../utils/logger';

export interface CodexCatalogModel {
  id: string;
  name: string;
}

interface CodexCacheModelEntry {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  supported_in_api?: unknown;
  priority?: unknown;
}

export function defaultCodexModelsCachePath(): string {
  const override = process.env.SOPHRON_CODEX_MODELS_CACHE_PATH?.trim();
  if (override) return override;
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) return path.join(codexHome, 'models_cache.json');
  return path.join(os.homedir(), '.codex', 'models_cache.json');
}

function isListableCodexModel(entry: unknown): entry is CodexCacheModelEntry {
  if (!entry || typeof entry !== 'object') return false;
  const model = entry as CodexCacheModelEntry;
  if (typeof model.slug !== 'string' || !model.slug.trim()) return false;
  if (model.visibility === 'hide' || model.visibility === 'hidden') return false;
  if (model.visibility != null && model.visibility !== 'list') return false;
  if (model.supported_in_api === false) return false;
  return true;
}

function priorityOf(entry: CodexCacheModelEntry): number {
  return typeof entry.priority === 'number' && Number.isFinite(entry.priority)
    ? entry.priority
    : Number.MAX_SAFE_INTEGER;
}

/** Parse a Codex `models_cache.json` document. Hidden and non-API models are dropped. */
export function parseCodexModelsCache(raw: string): CodexCatalogModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logWarn('[CodexModels] Failed to parse models cache');
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const models = (parsed as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const visible = models
    .map((entry, index) => ({ entry, index }))
    .filter((item): item is { entry: CodexCacheModelEntry; index: number } =>
      isListableCodexModel(item.entry)
    );

  visible.sort((a, b) => {
    const priorityDelta = priorityOf(a.entry) - priorityOf(b.entry);
    return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
  });

  const seen = new Set<string>();
  const result: CodexCatalogModel[] = [];
  for (const { entry } of visible) {
    const id = String(entry.slug).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const displayName = typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
    result.push({ id, name: displayName || id });
  }
  return result;
}

export function readCodexSubscriptionModels(
  cachePath = defaultCodexModelsCachePath()
): CodexCatalogModel[] {
  let raw: string;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch {
    return [];
  }
  return parseCodexModelsCache(raw);
}

/**
 * Catalog order first, then any preset models the cache does not list yet.
 * Known preset ids keep the app's display name; cache-only ids use the CLI name.
 */
export function mergeCodexModelOptions<T extends { id: string; name: string }>(
  fallback: readonly T[],
  catalog: readonly CodexCatalogModel[]
): T[] {
  if (catalog.length === 0) return fallback as T[];

  const fallbackById = new Map(fallback.map((model) => [model.id, model]));
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const model of catalog) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    const known = fallbackById.get(model.id);
    merged.push(known ?? ({ id: model.id, name: model.name || model.id } as T));
  }

  for (const model of fallback) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

export function listCodexSubscriptionModelOptions<T extends { id: string; name: string }>(
  fallback: readonly T[],
  cachePath?: string
): T[] {
  return mergeCodexModelOptions(fallback, readCodexSubscriptionModels(cachePath));
}
