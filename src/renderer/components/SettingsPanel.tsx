import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Plug,
  Shield,
  Wifi,
  AlertCircle,
  Globe,
  Keyboard,
  BrainCircuit,
  Database,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowSize } from '../hooks/useWindowSize';
import { RemoteControlPanel } from './RemoteControlPanel';
import { useAppStore } from '../store';
import { SettingsAPI } from './settings/SettingsAPI';
import { SettingsSandbox } from './settings/SettingsSandbox';
import { SettingsConnectors } from './settings/SettingsConnectors';
import { SettingsGeneral } from './settings/SettingsGeneral';
import { SettingsLogs } from './settings/SettingsLogs';
import { SettingsMemory } from './settings/SettingsMemory';
import { SettingsPersonalAnalysis } from './settings/SettingsPersonalAnalysis';
import { SettingsShortcuts } from './settings/SettingsShortcuts';

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | 'api'
    | 'sandbox'
    | 'connectors'
    | 'memory'
    | 'personal-analysis'
    | 'remote'
    | 'logs'
    | 'general'
    | 'shortcuts';
}

type TabId =
  | 'api'
  | 'sandbox'
  | 'connectors'
  | 'memory'
  | 'personal-analysis'
  | 'remote'
  | 'logs'
  | 'general'
  | 'shortcuts';

const VALID_TABS = new Set<TabId>([
  'api',
  'sandbox',
  'connectors',
  'memory',
  'personal-analysis',
  'remote',
  'logs',
  'general',
  'shortcuts',
]);

export function SettingsPanel({ onClose, initialTab = 'api' }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial =
    storeTab && VALID_TABS.has(storeTab as TabId) ? (storeTab as TabId) : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([resolvedInitial]));

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    setViewedTabs((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  const tabs: Array<{ id: TabId; label: string; icon: typeof Settings; group: string }> = [
    {
      id: 'api' as TabId,
      group: 'models',
      label: t('settings.apiSettings'),
      icon: Settings,
    },
    {
      id: 'sandbox' as TabId,
      group: 'models',
      label: t('settings.sandbox'),
      icon: Shield,
    },
    {
      id: 'connectors' as TabId,
      group: 'models',
      label: t('settings.connectors'),
      icon: Plug,
    },
    {
      id: 'memory' as TabId,
      group: 'data',
      label: t('settings.memory'),
      icon: BrainCircuit,
    },
    {
      id: 'personal-analysis' as TabId,
      group: 'data',
      label: t('settings.personalAnalysis', 'Cloud Space'),
      icon: Database,
    },
    {
      id: 'remote' as TabId,
      group: 'collab',
      label: t('settings.remote', '远程控制'),
      icon: Wifi,
    },
    {
      id: 'logs' as TabId,
      group: 'app',
      label: t('settings.logs'),
      icon: AlertCircle,
    },
    {
      id: 'general' as TabId,
      group: 'app',
      label: t('settings.general'),
      icon: Globe,
    },
    {
      id: 'shortcuts' as TabId,
      group: 'app',
      label: t('settings.shortcuts'),
      icon: Keyboard,
    },
  ];
  const tabGroups = [
    { id: 'models', label: t('settings.groups.models') },
    { id: 'data', label: t('settings.groups.data') },
    { id: 'collab', label: t('settings.groups.collab') },
    { id: 'app', label: t('settings.groups.app') },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div className="titlebar-drag flex flex-shrink-0 items-center justify-end border-b border-border-subtle bg-surface px-3 py-2 sm:px-4">
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="titlebar-no-drag p-2 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-56'} flex flex-shrink-0 flex-col border-r border-border-subtle bg-background-secondary`}
        >
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${compactSidebar ? 'space-y-1 p-1.5' : 'p-3'}`}
          >
            {tabGroups.map((group) => (
              <div key={group.id} className={compactSidebar ? 'space-y-1' : 'space-y-0.5 pb-2'}>
                {!compactSidebar && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {group.label}
                  </div>
                )}
                {tabs
                  .filter((tab) => tab.group === group.id)
                  .map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      title={compactSidebar ? tab.label : undefined}
                      className={`flex w-full items-center ${compactSidebar ? 'justify-center p-2.5' : 'h-9 gap-2.5 px-3'} rounded-lg text-left transition-colors ${
                        activeTab === tab.id
                          ? 'bg-surface-active font-medium text-accent'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      <tab.icon className="h-4 w-4 flex-shrink-0" />
                      {!compactSidebar && (
                        <span className="min-w-0 flex-1 truncate text-[13px]">{tab.label}</span>
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
            <div className="max-w-[1120px] h-full w-full min-w-0 mx-auto">
              <div className="h-full">
                <div className={activeTab === 'api' ? 'h-full' : 'hidden'}>
                  {viewedTabs.has('api') && (
                    <>
                      <SettingsAPI />
                    </>
                  )}
                </div>
                <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
                  {viewedTabs.has('sandbox') && <SettingsSandbox />}
                </div>
                <div className={activeTab === 'connectors' ? '' : 'hidden'}>
                  {viewedTabs.has('connectors') && (
                    <SettingsConnectors isActive={activeTab === 'connectors'} />
                  )}
                </div>
                <div className={activeTab === 'memory' ? 'h-full' : 'hidden'}>
                  {viewedTabs.has('memory') && <SettingsMemory />}
                </div>
                <div className={activeTab === 'personal-analysis' ? '' : 'hidden'}>
                  {viewedTabs.has('personal-analysis') && <SettingsPersonalAnalysis />}
                </div>
                <div className={activeTab === 'remote' ? '' : 'hidden'}>
                  {viewedTabs.has('remote') && (
                    <RemoteControlPanel isActive={activeTab === 'remote'} />
                  )}
                </div>
                <div className={activeTab === 'logs' ? '' : 'hidden'}>
                  {viewedTabs.has('logs') && <SettingsLogs isActive={activeTab === 'logs'} />}
                </div>
                <div className={activeTab === 'general' ? '' : 'hidden'}>
                  {viewedTabs.has('general') && <SettingsGeneral />}
                </div>
                <div className={activeTab === 'shortcuts' ? '' : 'hidden'}>
                  {viewedTabs.has('shortcuts') && <SettingsShortcuts />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
