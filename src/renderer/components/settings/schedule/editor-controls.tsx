import { useState, type MouseEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { AppConfig } from '../../../types';
import { DATA_PROCESS_AI_CONFIG_KEY, DATA_PROCESS_TASK_CONFIG_KEY } from './types';
import { GlassSelect } from '../../GlassSelect';
import { LlmPromptComposer } from '../../LlmPromptComposer';

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  fill = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  fill?: boolean;
}) {
  return (
    <div
      className={`min-h-9 flex-wrap items-center gap-1 rounded-lg border border-border-muted bg-surface-muted p-1 ${
        fill ? 'flex w-full' : 'inline-flex'
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`h-8 whitespace-nowrap rounded-md px-3 text-[12px] font-medium transition-colors ${
              fill ? 'min-w-max flex-1' : 'shrink-0'
            } ${active ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="automation-config-row grid min-w-0 gap-2 text-[12px] font-medium text-text-secondary">
      <span className="automation-config-label">{label}</span>
      <span className="block min-w-0">{children}</span>
    </label>
  );
}

export function SelectLine({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <GlassSelect
      value={value}
      options={[{ value: '', label: placeholder }, ...options]}
      onValueChange={onChange}
      placeholder={placeholder}
      triggerClassName="h-9 w-full justify-between"
      contentClassName="w-[var(--radix-select-trigger-width)]"
    />
  );
}

// A dropdown paired with a client-side name filter, mirroring the cloud table picker layout.
// Use for local input/output tables, where the full list can be large.
export function LocalTableSelect({
  value,
  tables,
  placeholder,
  searchPlaceholder,
  onChange,
}: {
  value: string;
  tables: Array<{ id: string; name: string }>;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const normalized = keyword.trim().toLowerCase();
  const filtered = normalized
    ? tables.filter((table) => table.name.toLowerCase().includes(normalized))
    : tables;
  const selected = tables.find((table) => table.id === value);
  // Keep the selected table in the option list even when filtered out, so its label still shows.
  const visible =
    selected && !filtered.some((table) => table.id === value) ? [selected, ...filtered] : filtered;
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(11rem,0.5fr)]">
      <GlassSelect
        value={value}
        options={[
          { value: '', label: placeholder },
          ...visible.map((table) => ({ value: table.id, label: table.name })),
        ]}
        onValueChange={onChange}
        placeholder={placeholder}
        triggerClassName="h-9 w-full justify-between"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={searchPlaceholder}
          className="input h-9 w-full pr-3 pl-8 text-xs"
        />
      </div>
    </div>
  );
}

export function MiniIcon({
  onClick,
  children,
}: {
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-tertiary"
    >
      {children}
    </span>
  );
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AutomationPromptPermissionFields({
  value,
  onChange,
  selectedSkillNames,
  onSelectedSkillNamesChange,
  onSkillSelectionCommit,
  appConfig,
  selectedModelConfigSetId,
  onModelSelect,
  placeholder,
  label,
  tr,
}: {
  value: string;
  onChange: (value: string) => void;
  selectedSkillNames: string[];
  onSelectedSkillNamesChange: (names: string[]) => void;
  onSkillSelectionCommit: (selection: { value: string; selectedSkillNames: string[] }) => void;
  appConfig: AppConfig | null;
  selectedModelConfigSetId?: string;
  onModelSelect: (selection: { configSetId: string; model: string }) => void;
  placeholder: string;
  label?: string;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <>
      <ConfigRow label={label ?? tr('schedule.conversationPrompt', '指令内容')}>
        <LlmPromptComposer
          value={value}
          onChange={onChange}
          selectedSkillNames={selectedSkillNames}
          onSelectedSkillNamesChange={onSelectedSkillNamesChange}
          onSkillSelectionCommit={onSkillSelectionCommit}
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          modelDisabled={!appConfig?.model?.trim()}
          modelFallbackLabel={tr('chat.noModel', '未配置模型')}
          placeholder={placeholder}
          onModelSelect={onModelSelect}
        />
      </ConfigRow>
    </>
  );
}

export type DataProcessMode = 'ai' | 'task';

export function createLlmUsageTraceId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `llm-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Unified "数据处理" action editor. AI is a configuration-time generator; runtime execution
// should settle on a generated/reused data task action.
export function getStashedDataProcessConfig(
  config: Record<string, unknown>,
  key: typeof DATA_PROCESS_AI_CONFIG_KEY | typeof DATA_PROCESS_TASK_CONFIG_KEY
): Record<string, unknown> | null {
  const value = config[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
