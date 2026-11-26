import { useTranslation } from 'react-i18next';
import { GlassSelect } from '../GlassSelect';
import { Input } from '../ui';

export interface ApiModelOptionItem {
  id: string;
  name: string;
}

interface ApiModelSelectorFieldProps {
  inputId?: string;
  useCustomModel: boolean;
  model: string;
  customModel: string;
  modelOptions: ApiModelOptionItem[];
  modelInputPlaceholder: string;
  onModelChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  inputClassName?: string;
  triggerClassName?: string;
  /** Render borderless flush controls inside `.ui-form-flush` cells. */
  flush?: boolean;
}

/** Shared model input/select control reused by ConfigModal and SettingsAPI. */
export function ApiModelSelectorField({
  inputId,
  useCustomModel,
  model,
  customModel,
  modelOptions,
  modelInputPlaceholder,
  onModelChange,
  onCustomModelChange,
  inputClassName = 'h-8',
  triggerClassName = 'h-8 w-full justify-between bg-surface px-2.5 text-[13px] text-text-primary',
  flush = false,
}: ApiModelSelectorFieldProps) {
  const { t } = useTranslation();

  if (useCustomModel) {
    if (flush) {
      return (
        <input
          id={inputId}
          type="text"
          value={customModel}
          onChange={(event) => onCustomModelChange(event.target.value)}
          placeholder={modelInputPlaceholder}
          className="min-w-0 flex-1 text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
        />
      );
    }
    return (
      <Input
        id={inputId}
        type="text"
        value={customModel}
        onChange={(event) => onCustomModelChange(event.target.value)}
        placeholder={modelInputPlaceholder}
        className={inputClassName}
      />
    );
  }

  return (
    <GlassSelect
      value={modelOptions.length ? model : ''}
      onValueChange={onModelChange}
      options={
        modelOptions.length
          ? modelOptions.map((item) => ({ value: item.id, label: item.name }))
          : [
              {
                value: 'no-models',
                label: t('api.noModelsAvailable'),
                disabled: true,
              },
            ]
      }
      placeholder={t('api.noModelsAvailable')}
      disabled={!modelOptions.length}
      triggerClassName={
        flush
          ? 'w-full justify-between text-[12.5px] text-text-primary focus-visible:ring-0'
          : triggerClassName
      }
      contentClassName="w-[var(--radix-select-trigger-width)]"
    />
  );
}
