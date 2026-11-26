import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import { formatSkillDate, getSkillVisualIcon, type SkillTableItem } from './skill-helpers';

export function SkillFilterCell({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  const label = options.find(([key]) => key === value)?.[1] ?? '';
  return (
    <GlassDropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          className="inline-flex h-full min-w-[104px] flex-shrink-0 items-center justify-between gap-2 border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>
      }
    >
      {options.map(([key, text]) => (
        <GlassMenuItem key={key} selected={value === key} onSelect={() => onChange(key)}>
          {text}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
}

export function SkillTableRow({
  item,
  selected,
  onSelect,
}: {
  item: SkillTableItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = getSkillVisualIcon(item.name, item.type);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`grid h-9 w-full cursor-pointer grid-cols-[minmax(0,1fr)_76px_86px_132px] items-center border-b border-border-muted/85 px-3 text-left transition-colors last:border-b-0 ${
        selected
          ? 'bg-accent-muted shadow-[inset_3px_0_0_var(--color-accent)]'
          : 'hover:bg-surface-hover/35'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="flex-shrink-0 truncate text-[13px] font-medium text-text-primary">
            {item.name}
          </span>
          {item.description && (
            <span className="min-w-0 truncate text-[12px] text-text-muted" title={item.description}>
              {item.description}
            </span>
          )}
        </span>
      </span>
      <span className="min-w-0">
        <SkillTypeBadge item={item} />
      </span>
      <span className="min-w-0">
        <SkillStatusBadge item={item} />
      </span>
      <span className="truncate font-mono text-[12px] text-text-secondary">
        {formatSkillDate(item.updatedAt)}
      </span>
    </div>
  );
}

export function SkillTypeBadge({ item }: { item: SkillTableItem }) {
  return (
    <span
      className={`inline-flex h-6 max-w-full items-center rounded-full px-2 text-xs font-medium ${
        item.type === 'plugin'
          ? 'bg-mcp/10 text-mcp'
          : item.type === 'builtin'
            ? 'bg-accent-muted text-accent'
            : item.type === 'mcp'
              ? 'bg-mcp/10 text-mcp'
              : 'bg-success/10 text-success'
      }`}
    >
      <span className="truncate">{item.typeLabel}</span>
    </span>
  );
}

export function SkillStatusBadge({ item }: { item: SkillTableItem }) {
  const { t } = useTranslation();
  const installable = item.kind === 'plugin' && !item.installed;
  const installedPlugin = item.kind === 'plugin' && item.installed;

  return (
    <span
      className={`inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium ${
        installable
          ? 'bg-warning/10 text-warning'
          : item.enabled
            ? 'bg-success/10 text-success'
            : 'bg-text-muted/10 text-text-muted'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
          installable ? 'bg-warning' : item.enabled ? 'bg-success' : 'bg-text-muted'
        }`}
      />
      <span className="truncate">
        {installable
          ? t('skills.workspace.installable')
          : installedPlugin
            ? t('skills.pluginInstalled')
            : item.enabled
              ? t('skills.workspace.enabled')
              : t('skills.workspace.disabled')}
      </span>
    </span>
  );
}
