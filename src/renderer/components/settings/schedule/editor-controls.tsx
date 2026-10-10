import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../../types';
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
            } ${active ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
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
    <label className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] items-start gap-2 text-[12px] font-medium text-text-secondary">
      <span className="pt-2 leading-5">{label}</span>
      <span className="block min-w-0">{children}</span>
    </label>
  );
}

// Label-above-field variant for grouped section cards (e.g. cloud sync panels).
export function FieldStack({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

// Grouped configuration card: muted surface, icon + title header, stacked fields.
export function ConfigSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border-muted bg-surface-muted/40 p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
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

// A searchable dropdown for long local lists (data pipelines, input/output tables);
// the filter input lives at the top of the dropdown itself.
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
  const { t } = useTranslation();
  return (
    <GlassSelect
      value={value}
      options={[
        { value: '', label: placeholder },
        ...tables.map((table) => ({ value: table.id, label: table.name })),
      ]}
      onValueChange={onChange}
      placeholder={placeholder}
      searchable
      searchPlaceholder={searchPlaceholder}
      searchEmptyText={t('common.noResults', '暂无结果')}
      triggerClassName="h-9 w-full justify-between"
      contentClassName="w-[var(--radix-select-trigger-width)]"
    />
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
      className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-muted"
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
      <FieldStack label={label ?? tr('schedule.conversationPrompt', '指令内容')}>
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
      </FieldStack>
    </>
  );
}
