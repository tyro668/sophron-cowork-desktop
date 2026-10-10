/**
 * UI state for the data workspace: active tab, search, error banner,
 * in-flight action id, and per-tab loading flags. No IPC, no server data.
 */
import { useState } from 'react';
import type { DataTab } from '../model/types';

export function useDataViewUi() {
  const [activeTab, setActiveTab] = useState<DataTab>('pipelines');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loadingTab, setLoadingTab] = useState<DataTab | null>('pipelines');
  const [pendingNavigationTab, setPendingNavigationTab] = useState<DataTab | null>('pipelines');

  return {
    activeTab,
    searchQuery,
    error,
    actionId,
    loadingTab,
    pendingNavigationTab,
    setActiveTab,
    setSearchQuery,
    setError,
    setActionId,
    setLoadingTab,
    setPendingNavigationTab,
  };
}

export type DataViewUi = ReturnType<typeof useDataViewUi>;
