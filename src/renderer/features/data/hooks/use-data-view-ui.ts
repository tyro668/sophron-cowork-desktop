/**
 * UI state for the data workspace: active tab, search, error banner,
 * in-flight action id, and per-tab loading flags. No IPC, no server data.
 */
import { useState } from 'react';
import type { DataTab, InputTableSourceFilter } from '../model/types';

export function useDataViewUi() {
  const [activeTab, setActiveTab] = useState<DataTab>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loadingTab, setLoadingTab] = useState<DataTab | null>('tasks');
  const [pendingNavigationTab, setPendingNavigationTab] = useState<DataTab | null>('tasks');
  const [inputTableSourceFilter, setInputTableSourceFilter] =
    useState<InputTableSourceFilter>('all');

  return {
    activeTab,
    searchQuery,
    error,
    actionId,
    loadingTab,
    pendingNavigationTab,
    inputTableSourceFilter,
    setActiveTab,
    setSearchQuery,
    setError,
    setActionId,
    setLoadingTab,
    setPendingNavigationTab,
    setInputTableSourceFilter,
  };
}

export type DataViewUi = ReturnType<typeof useDataViewUi>;
