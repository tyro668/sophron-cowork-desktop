import { ChevronDown } from 'lucide-react';
import type { AppConfig } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';

export interface AgentModelOption {
  id: string;
  name: string;
  model: string;
  isActive: boolean;
}

export function getAgentModelOptions(
  appConfig: AppConfig | null | undefined,
  selectedConfigSetId?: string
): AgentModelOption[] {
  return (
    appConfig?.configSets
      ?.map((set) => {
        const model = set.profiles?.[set.activeProfileKey]?.model?.trim() || '';
        return {
          id: set.id,
          name: set.name,
          model,
          isActive: set.id === (selectedConfigSetId || appConfig.activeConfigSetId),
        };
      })
      .filter((option) => option.model) || []
  );
}

export function getAgentModelLabel(
  appConfig: AppConfig | null | undefined,
  fallback: string,
  selectedConfigSetId?: string
): string {
  const selected =
    selectedConfigSetId && appConfig?.configSets
      ? appConfig.configSets.find((set) => set.id === selectedConfigSetId)
      : null;
  return (
    selected?.profiles?.[selected.activeProfileKey]?.model?.trim() ||
    appConfig?.model?.trim() ||
    fallback
  );
}

export function AgentModelSelector({
  open,
  onOpenChange,
  appConfig,
  selectedConfigSetId,
  fallbackLabel,
  disabled = false,
  triggerClassName,
  side = 'top',
  align = 'end',
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appConfig: AppConfig | null | undefined;
  selectedConfigSetId?: string;
  fallbackLabel: string;
  disabled?: boolean;
  triggerClassName: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  onSelect: (configSetId: string) => void;
}) {
  const label = getAgentModelLabel(appConfig, fallbackLabel, selectedConfigSetId);
  const options = getAgentModelOptions(appConfig, selectedConfigSetId);

  if (disabled) {
    return (
      <button type="button" disabled className={triggerClassName} title={label}>
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
      </button>
    );
  }

  return (
    <GlassDropdownMenu
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      align={align}
      contentClassName="w-[min(18rem,calc(100vw-2rem))]"
      trigger={
        <button type="button" className={triggerClassName} title={label}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
        </button>
      }
    >
      <div className="max-h-56 overflow-y-auto">
        {options.length > 0 ? (
          options.map((option) => (
            <GlassMenuItem
              key={option.id}
              selected={option.isActive}
              onSelect={() => onSelect(option.id)}
            >
              <span className="block min-w-0">
                <span className="block truncate text-[13px] font-medium">{option.name}</span>
                <span className="block truncate text-xs opacity-80">{option.model}</span>
              </span>
            </GlassMenuItem>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-text-muted">{label}</div>
        )}
      </div>
    </GlassDropdownMenu>
  );
}
