import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Plug,
  Shield,
  Wifi,
  AlertCircle,
  Globe,
  ChevronRight,
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
    | 'general';
}

type TabId =
  | 'api'
  | 'sandbox'
  | 'connectors'
  | 'memory'
  | 'personal-analysis'
  | 'remote'
  | 'logs'
  | 'general';

const VALID_TABS = new Set<TabId>([
  'api',
  'sandbox',
  'connectors',
  'memory',
  'personal-analysis',
  'remote',
  'logs',
  'general',
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
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch {
      /* ignore */
    }
  }, []);

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

  const tabs = [
    {
      id: 'api' as TabId,
      label: t('settings.apiSettings'),
      icon: Settings,
      description: t('settings.apiSettingsDesc'),
    },
    {
      id: 'sandbox' as TabId,
      label: t('settings.sandbox'),
      icon: Shield,
      description: t('settings.sandboxDesc'),
    },
    {
      id: 'connectors' as TabId,
      label: t('settings.connectors'),
      icon: Plug,
      description: t('settings.connectorsDesc'),
    },
    {
      id: 'memory' as TabId,
      label: t('settings.memory'),
      icon: BrainCircuit,
      description: t('settings.memoryDesc'),
    },
    {
      id: 'personal-analysis' as TabId,
      label: t('settings.personalAnalysis', 'Personal Analysis'),
      icon: Database,
      description: t('settings.personalAnalysisDesc', '管理云端数据连接'),
    },
    {
      id: 'remote' as TabId,
      label: t('settings.remote', '远程控制'),
      icon: Wifi,
      description: t('settings.remoteDesc', '通过飞书等平台远程使用'),
    },
    {
      id: 'logs' as TabId,
      label: t('settings.logs'),
      icon: AlertCircle,
      description: t('settings.logsDesc'),
    },
    {
      id: 'general' as TabId,
      label: t('settings.general'),
      icon: Globe,
      description: t('settings.generalDesc'),
    },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div className="flex flex-shrink-0 items-center justify-end border-b border-border-subtle bg-background/28 px-3 py-2 backdrop-blur-xl sm:px-4">
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-60'} ml-2 mr-0 mt-3 mb-2 rounded-2xl border border-border-subtle bg-background/46 flex flex-col flex-shrink-0 shadow-card backdrop-blur-xl`}
        >
          <div className={`flex-1 ${compactSidebar ? 'p-1.5 space-y-1' : 'p-3 space-y-1.5'}`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={compactSidebar ? tab.label : undefined}
                className={`w-full flex items-center ${compactSidebar ? 'justify-center p-2.5' : 'gap-3 px-3.5 py-3'} rounded-lg text-left transition-colors active:scale-[0.98] ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-text-primary font-medium shadow-soft'
                    : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-4.5 h-4.5 flex-shrink-0" />
                {!compactSidebar && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tab.label}</p>
                    <p className="text-[11px] leading-4 text-text-muted line-clamp-2 mt-0.5">
                      {tab.description}
                    </p>
                  </div>
                )}
                {!compactSidebar && activeTab === tab.id && (
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
          <div className={`${compactSidebar ? 'p-1.5' : 'p-4'} border-t border-border-subtle`}>
            <button
              onClick={onClose}
              className={`w-full py-2 ${compactSidebar ? 'px-2' : 'px-4'} rounded-lg bg-background/68 hover:bg-surface-hover transition-colors text-text-secondary text-sm shadow-soft`}
              title={compactSidebar ? t('common.close') : undefined}
            >
              {compactSidebar ? <X className="w-4 h-4 mx-auto" /> : t('common.close')}
            </button>
            {!compactSidebar && (
              <p className="text-[10px] text-text-muted text-center mt-2 select-text">
                v{appVersion}
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
            <div className="max-w-[1120px] w-full min-w-0 mx-auto">
              <div className="">
                <div className={activeTab === 'api' ? '' : 'hidden'}>
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
                <div className={activeTab === 'memory' ? '' : 'hidden'}>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
