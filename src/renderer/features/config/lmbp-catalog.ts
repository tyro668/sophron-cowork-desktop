import { useEffect } from 'react';
import { create } from 'zustand';
import type { LmbpPairingStatus } from '../../../shared/contracts';
import { configClient } from './api/config-client';

const CACHE_KEY = 'lmbp-upstream-model-ids';
type DisplayIds = Record<string, string>;

function loadDisplayIds(): DisplayIds {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return Object.fromEntries(
        Object.entries(saved).filter((entry) => typeof entry[1] === 'string')
      );
    }
  } catch {
    // The live catalog still works when local storage is unavailable.
  }
  return {};
}

interface CatalogState {
  status?: LmbpPairingStatus;
  error?: Error;
  displayIds: DisplayIds;
}

export const useLmbpCatalog = create<CatalogState>(() => ({ displayIds: loadDisplayIds() }));

let watchers = 0;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function refreshLmbpCatalog(): Promise<void> {
  clearTimeout(timer);
  const request = ++revision;
  try {
    const status = await configClient.getLmbpStatus();
    if (request !== revision) return;
    const previous = useLmbpCatalog.getState();
    // For connectors that publish only a friendly label, keep that label until an upstream ID is available.
    const updates = status.models
      .map(
        ({ routeId, modelId, scheme, displayName }) =>
          [routeId, scheme ? modelId : displayName || modelId] as const
      )
      .filter(([routeId, label]) => previous.displayIds[routeId] !== label);
    let displayIds = previous.displayIds;
    if (updates.length) {
      displayIds = {
        ...displayIds,
        ...Object.fromEntries(updates),
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(displayIds));
      } catch {
        // Keep labels available in this window when storage cannot be written.
      }
    }
    if (
      updates.length ||
      previous.error ||
      JSON.stringify(previous.status) !== JSON.stringify(status)
    ) {
      useLmbpCatalog.setState({ status, displayIds, error: undefined });
    }
  } catch (cause) {
    if (request === revision)
      useLmbpCatalog.setState({
        status: undefined,
        error: cause instanceof Error ? cause : new Error(),
      });
  } finally {
    if (request === revision && watchers) timer = setTimeout(refreshLmbpCatalog, 2000);
  }
}

/** Share one poller between the pairing form and existing LMBP configurations. */
export function useWatchLmbpCatalog(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !configClient.isAvailable()) return;
    if (++watchers === 1) void refreshLmbpCatalog();
    return () => {
      if (--watchers === 0) {
        ++revision;
        clearTimeout(timer);
        useLmbpCatalog.setState({ status: undefined, error: undefined });
      }
    };
  }, [enabled]);
}
