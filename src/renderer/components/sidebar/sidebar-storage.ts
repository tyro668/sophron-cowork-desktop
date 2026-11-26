export const SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY = 'sophron.sidebar.projectExpansion.v1';
export const SIDEBAR_PINNED_STORAGE_KEY = 'sophron.sidebar.pinnedSessions.v1';

export function readStoredProjectExpansion(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const expansion: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        expansion[key] = value;
      }
    }
    return expansion;
  } catch {
    return {};
  }
}

export function writeStoredProjectExpansion(projectExpansion: Record<string, boolean>) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY,
      JSON.stringify(projectExpansion)
    );
  } catch {
    // Ignore storage failures so sidebar navigation remains usable.
  }
}

export function readStoredPinnedSessions(): Set<string> {
  if (typeof window === 'undefined') return new Set();

  try {
    const raw = window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeStoredPinnedSessions(pinnedIds: Set<string>) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, JSON.stringify([...pinnedIds]));
  } catch {
    // Ignore storage failures so sidebar navigation remains usable.
  }
}
