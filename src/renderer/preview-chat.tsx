// Renderer-only preview of the chat conversation UI (no Electron required).
// Serves via: vite --config vite.preview.config.ts, then open /preview-chat.html
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import 'highlight.js/styles/github-dark-dimmed.min.css';
import './styles/globals.css';
import { useAppStore } from './store';
import { ChatView } from './components/ChatView';
import { WelcomeView } from './components/WelcomeView';
import {
  EmptyState,
  PaginationFooter,
  DataTableSearch,
  DataToolbarButton,
} from './components/data-view/shared';
import { Plus } from 'lucide-react';
import type { AppConfig, Message, Session } from './types';

const SESSION_ID = 'preview-session';

const messages: Message[] = [
  {
    id: 'u1',
    sessionId: SESSION_ID,
    role: 'user',
    timestamp: Date.now() - 120000,
    content: [
      {
        type: 'file_attachment',
        filename: 'sales_2024.xlsx',
        relativePath: 'sales_2024.xlsx',
        size: 46000,
      },
      {
        type: 'text',
        text: '帮我分析这个销售表：按地区汇总销售额，找出同比增长最快的品类，并生成柱状图。',
      },
    ],
  },
  {
    id: 'a1',
    sessionId: SESSION_ID,
    role: 'assistant',
    timestamp: Date.now() - 110000,
    content: [
      {
        type: 'thinking',
        thinking:
          '用户想分析销售数据。先看看工作目录里有什么文件，然后读取表结构，再决定用哪些算子。**重点**是地区维度汇总和同比口径的确认。',
      },
      { type: 'text', text: '我先查看工作目录和数据表结构，然后搭建处理流程。' },
      {
        type: 'tool_use',
        id: 'tu1',
        name: 'execute_command',
        input: { command: 'ls -la ~/Documents/work/data' },
      },
      {
        type: 'tool_result',
        toolUseId: 'tu1',
        content:
          'total 128\ndrwxr-xr-x  5 richie  staff   160 Sep 16 10:20 .\n-rw-r--r--  1 richie  staff  45K Sep 15 18:02 sales_2024.xlsx\n-rw-r--r--  1 richie  staff  12K Sep 14 09:31 regions.csv',
      },
      {
        type: 'tool_use',
        id: 'tu2',
        name: 'read_file',
        input: { file_path: '~/Documents/work/data/sales_2024.xlsx' },
      },
      {
        type: 'tool_result',
        toolUseId: 'tu2',
        content:
          'Sheet1: 12,480 rows × 9 cols\nColumns: order_id, region, category, amount, qty, order_date, channel, rep, status',
      },
      {
        type: 'tool_use',
        id: 'tu3',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: '读取并校验销售表结构', status: 'completed' },
            {
              content: '按地区汇总销售额',
              status: 'in_progress',
              activeForm: '正在按地区汇总销售额',
            },
            { content: '计算品类同比增长', status: 'pending' },
            { content: '生成柱状图与报告', status: 'pending' },
          ],
        },
      },
      {
        type: 'tool_use',
        id: 'tu4',
        name: 'edit_file',
        input: { file_path: 'analysis/aggregate.py' },
      },
      {
        type: 'tool_result',
        toolUseId: 'tu4',
        content: "Error: EACCES: permission denied, open 'analysis/aggregate.py'",
        isError: true,
      },
      {
        type: 'tool_use',
        id: 'tu5',
        name: 'mcp__feishu__send_message',
        input: { channel: 'data-team', text: '汇总任务已开始' },
      },
      { type: 'tool_result', toolUseId: 'tu5', content: 'ok' },
      // Intentionally no tool_result → renders as a running row
      { type: 'tool_use', id: 'tu6', name: 'data_run_task', input: { id: 'task-012' } },
      {
        type: 'text',
        text: '地区销售额已经汇总完成，**华东区占比最高**。核心 SQL：\n\n```sql\nSELECT region, SUM(amount) AS total\nFROM sales_2024\nGROUP BY region\nORDER BY total DESC;\n```\n\n| 地区 | 销售额 | 占比 |\n| --- | --- | --- |\n| 华东 | ¥4,820,300 | 34.2% |\n| 华南 | ¥3,910,500 | 27.8% |\n| 华北 | ¥2,704,100 | 19.2% |\n\n接下来需要确认同比口径：\n\n- 按自然年对比（2024 vs 2023）\n- 或按月度环比\n\n详见 `analysis/aggregate.py`。',
      },
      {
        type: 'tool_use',
        id: 'tu7',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              header: '口径确认',
              question: '同比增长按哪个口径计算？',
              options: [
                { label: '按自然年对比', description: '2024 年与 2023 年同一时间段对比' },
                { label: '按月环比', description: '每个月与上一个月对比' },
              ],
            },
          ],
        },
      },
    ],
  },
];

const session: Session = {
  id: SESSION_ID,
  title: '销售数据分析',
  status: 'running',
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  model: 'claude-sonnet-4-5',
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now(),
};

const appConfig: AppConfig = {
  provider: 'anthropic',
  apiKey: 'preview',
  model: 'claude-sonnet-4-5',
  activeProfileKey: 'anthropic',
  profiles: {},
  activeConfigSetId: 'preview',
  configSets: [],
  enableDevLogs: false,
  theme: 'dark',
  permissionPolicy: 'auto_review',
  sandboxEnabled: false,
  memoryEnabled: false,
  memoryRuntime: {
    llm: { inheritFromActive: true, timeoutMs: 30000 },
    embedding: { inheritFromActive: true, timeoutMs: 30000 },
    useEmbedding: false,
    maxNavSteps: 4,
    ingestionConcurrency: 2,
  },
  personalAnalysis: { apiOrigin: '', apiKey: '', updatedAt: 0 },
  enableThinking: false,
  isConfigured: true,
};

useAppStore.setState({
  sessions: [session],
  activeSessionId: SESSION_ID,
  sessionStates: {
    [SESSION_ID]: {
      messages,
      partialMessage: '',
      partialThinking: '',
      pendingTurns: [],
      activeTurn: { stepId: 'step-1', userMessageId: 'u1' },
      executionClock: { startAt: Date.now() - 12000, endAt: null },
      traceSteps: [],
      contextWindow: 0,
    },
  },
  appConfig,
  isConfigured: true,
});

document.documentElement.classList.add('light');

function EmptyPanelPreview({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <DataTableSearch value="" onChange={() => {}} placeholder="搜索..." />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Plus className="h-3.5 w-3.5" />}
            label="操作"
            disabled
            onClick={() => {}}
          />
        </div>
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            label={`暂无${label}`}
            description="设置触发时间和执行动作，让重复工作自动完成。"
            action={
              <button className="btn btn-primary">
                <Plus className="h-4 w-4" />
                {label}
              </button>
            }
          />
        </div>
        <PaginationFooter count={0} currentPage={1} onPageChange={() => {}} embedded />
      </div>
    </div>
  );
}

function PreviewApp() {
  const [dark, setDark] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const showWelcome = params.has('welcome');
  const showEmpty = params.has('empty');

  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
  }, [dark]);

  return (
    <div className="h-screen w-screen p-3" style={{ background: 'var(--app-backdrop)' }}>
      <main className="app-main-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        {showWelcome ? (
          <WelcomeView />
        ) : showEmpty ? (
          <div className="grid h-full grid-cols-2 gap-3 overflow-auto p-3">
            <EmptyPanelPreview label="新建任务" />
            <EmptyPanelPreview label="添加输入表" />
            <EmptyPanelPreview label="添加输出表" />
            <EmptyPanelPreview label="新建自动化" />
          </div>
        ) : (
          <ChatView />
        )}
      </main>
      <button
        type="button"
        onClick={() => setDark(!dark)}
        className="fixed bottom-3 right-3 z-50 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-[12px] text-text-secondary shadow-soft"
      >
        {dark ? 'Light theme' : 'Dark theme'}
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PreviewApp />);
