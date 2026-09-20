import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import './styles/globals.css';
import { SettingsMemory } from './components/settings/SettingsMemory';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { useAppStore } from './store';
import type { CoreMemoryEntry, MemoryConfidenceSignals, ProjectMemoryEntry } from './types';

const signals = (overrides: Partial<MemoryConfidenceSignals> = {}): MemoryConfidenceSignals => ({
  sourceType: 'explicit_user_statement',
  extractionConfidence: 0.9,
  evidenceCount: 3,
  corroborationCount: 2,
  contradictionCount: 0,
  userVerified: false,
  calculationVersion: 1,
  ...overrides,
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

const CORE_ENTRIES: CoreMemoryEntry[] = [
  {
    combinedKey: 'preferences.language',
    category: 'preferences',
    key: 'language',
    value: '用户偏好使用中文回复，技术术语保留英文原文。',
    confidence: 0.92,
    confidenceSignals: signals({ userVerified: true }),
    status: 'active',
    evidence: [
      {
        sessionId: 's1',
        sourceSessionTitle: '数据清洗任务讨论',
        excerpt: '请用中文回答',
        createdAt: daysAgo(1),
      },
      { sessionId: 's2', sourceSessionTitle: '周报生成', createdAt: daysAgo(3) },
    ],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
  },
  {
    combinedKey: 'skills.etl.join',
    category: 'skills',
    key: 'etl.join',
    value: '熟悉多表 join 与 key 冲突处理，偏好左连接保留主表行序。',
    confidence: 0.71,
    confidenceSignals: signals({ sourceType: 'conversation_summary' }),
    status: 'active',
    evidence: [{ sessionId: 's3', sourceSessionTitle: '订单表关联', createdAt: daysAgo(5) }],
    createdAt: daysAgo(12),
    updatedAt: daysAgo(5),
  },
  {
    combinedKey: 'identity.role',
    category: 'identity',
    key: 'role',
    value: '用户是数据分析师，主要处理销售与库存数据。',
    confidence: 0.55,
    confidenceSignals: signals({ sourceType: 'llm_inference', reason: '来自模型推断' }),
    status: 'active',
    evidence: [],
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
  },
];

const PROJECT_ENTRIES: ProjectMemoryEntry[] = [
  {
    id: 'p1',
    workspaceKey: '/work/sales',
    workspaceLabel: 'sales-analytics',
    key: 'target_table',
    value: '输出表固定为 sales_clean，merge by [order_id]。',
    confidence: 0.88,
    confidenceSignals: signals(),
    status: 'active',
    evidence: [{ sessionId: 's4', sourceSessionTitle: '销售表清洗', createdAt: daysAgo(2) }],
    createdAt: daysAgo(15),
    updatedAt: daysAgo(2),
  },
  {
    id: 'p2',
    workspaceKey: '/work/sales',
    workspaceLabel: 'sales-analytics',
    key: 'data_source',
    value: '输入来自 cloud:orders_q3，每周一刷新。',
    confidence: 0.62,
    confidenceSignals: signals({ sourceType: 'llm_inference' }),
    status: 'active',
    evidence: [],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(9),
  },
  {
    id: 'p3',
    workspaceKey: '/work/sales',
    workspaceLabel: 'sales-analytics',
    key: 'target_table',
    value: '输出表固定为 sales_clean，merge by [order_id]。',
    confidence: 0.8,
    confidenceSignals: signals(),
    status: 'active',
    evidence: [],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
  },
];

let enabled = true;

(window as unknown as { electronAPI: unknown }).electronAPI = {
  memory: {
    getOverview: async () => ({
      enabled,
      storageRoot: '/tmp',
      coreFilePath: '',
      projectFilePath: '',
      experienceFilePath: '',
      stateFilePath: '',
      coreCount: CORE_ENTRIES.length,
      projectCount: PROJECT_ENTRIES.length,
      experienceSessionCount: 12,
      experienceChunkCount: 340,
      sourceWorkspaceCount: 3,
      failedSessionCount: 0,
      latestIngestionAt: Date.now(),
      latestError: null,
      topSourceWorkspaces: [],
    }),
    listCoreEntries: async () => CORE_ENTRIES,
    listProjectEntries: async () => PROJECT_ENTRIES,
    setEnabled: async (v: boolean) => {
      enabled = v;
    },
    updateCoreEntry: async (
      combinedKey: string,
      updates: { confidence?: number; status?: string }
    ) => {
      const entry = CORE_ENTRIES.find((e) => e.combinedKey === combinedKey);
      if (!entry) return null;
      if (updates.confidence !== undefined) {
        entry.confidence = updates.confidence;
        entry.confidenceSignals = {
          ...entry.confidenceSignals,
          sourceType: 'manual_edit',
          userVerified: true,
          corroborationCount: entry.confidenceSignals.corroborationCount + 1,
        };
      }
      return entry;
    },
    updateProjectEntry: async (id: string, updates: { confidence?: number; status?: string }) => {
      const entry = PROJECT_ENTRIES.find((e) => e.id === id);
      if (!entry) return null;
      if (updates.confidence !== undefined) {
        entry.confidence = updates.confidence;
        entry.confidenceSignals = {
          ...entry.confidenceSignals,
          sourceType: 'manual_edit',
          userVerified: true,
          corroborationCount: entry.confidenceSignals.corroborationCount + 1,
        };
      }
      return entry;
    },
    deleteCoreEntry: async () => ({ success: true }),
    deleteProjectEntry: async () => ({ success: true }),
    rebuildWorkspace: async () => ({
      success: true,
      sessionCount: 12,
      committedSessionCount: 12,
      preparedSessionCount: 12,
      failedSessionCount: 0,
      workspaceKey: '/repo/a',
    }),
  },
};

useAppStore.setState({
  activeSessionId: 's1',
  sessions: [
    {
      id: 's1',
      title: '数据清洗任务讨论',
      cwd: '/work/sales',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: true,
      model: 'claude-sonnet-5',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ] as never,
  workingDir: '/work/sales',
  appConfig: { memoryEnabled: true } as never,
});

function PreviewApp() {
  const [light, setLight] = React.useState(true);

  React.useEffect(() => {
    document.documentElement.classList.toggle('light', light);
  }, [light]);

  return (
    <div className="min-h-screen bg-background p-6 font-sans text-text-primary">
      <div className="mx-auto flex h-[46rem] max-w-5xl flex-col gap-3">
        <button
          type="button"
          onClick={() => setLight((v) => !v)}
          className="self-end rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-xs"
        >
          theme: {light ? 'light' : 'dark'}
        </button>
        <ConfirmDialogProvider>
          <SettingsMemory />
        </ConfirmDialogProvider>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PreviewApp />);
