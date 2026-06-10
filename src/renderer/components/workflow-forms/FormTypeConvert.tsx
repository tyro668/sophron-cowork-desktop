import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';

const TYPE_OPTIONS = ['string', 'int', 'double', 'decimal', 'boolean', 'date', 'timestamp'];

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'yyyy.MM.dd',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'yyyyMMdd',
];

const TIMESTAMP_FORMATS = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss.SSS',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd',
  'yyyyMMddHHmmss',
];

const TIMEZONE_OPTIONS = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

const ON_ERROR_OPTIONS = [
  { value: 'null', label: '置空' },
  { value: 'fail', label: '报错' },
  { value: 'keep', label: '保留' },
];

interface ConversionEntry {
  column: string;
  type: string;
  format?: string;
  onError?: string;
  locale?: string;
  timezone?: string;
}

function createDefault(): ConversionEntry {
  return { column: '', type: 'string' };
}

const SELECT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50';

function needsFormat(type: string): boolean {
  return type === 'date' || type === 'timestamp';
}

export default function FormTypeConvert({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const conversions: ConversionEntry[] = (node.config.conversions as ConversionEntry[]) ?? [];

  function change(index: number, patch: Partial<ConversionEntry>) {
    const next = conversions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    updateConfig((cfg) => ({ ...cfg, conversions: next.length > 0 ? next : undefined }));
  }

  function remove(index: number) {
    const next = conversions.filter((_, i) => i !== index);
    updateConfig((cfg) => ({ ...cfg, conversions: next.length > 0 ? next : undefined }));
  }

  function add() {
    updateConfig((cfg) => ({
      ...cfg,
      conversions: [...conversions, createDefault()],
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection>
        {conversions.length === 0 ? (
          <div className="py-4 text-center text-[12px] text-text-muted">
            {tr('typeConvertEmpty', '暂未设置类型转换')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {conversions.map((item, i) => {
              const fieldSelected = !!item.column;
              const showFormat = needsFormat(item.type);

              return (
                <div
                  key={i}
                  className="relative rounded-lg border border-border-muted bg-background/42 p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-error transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  <div className="grid gap-1.5 pr-6">
                    <div>
                      <GlassFormLabel>{tr('typeConvertField', '字段名')}</GlassFormLabel>
                      <select
                        value={item.column}
                        onChange={(e) => change(i, { column: e.target.value })}
                        className={SELECT_CLASS}
                      >
                        <option value="" disabled>
                          {tr('typeConvertSelectField', '选择字段')}
                        </option>
                        {fieldCompletions.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <GlassFormLabel>{tr('typeConvertTargetType', '目标类型')}</GlassFormLabel>
                      <select
                        value={item.type}
                        disabled={!fieldSelected}
                        onChange={(e) => change(i, { type: e.target.value })}
                        className={SELECT_CLASS}
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    {showFormat && (
                      <div>
                        <GlassFormLabel>{tr('typeConvertDateFormat', '日期格式')}</GlassFormLabel>
                        <input
                          type="text"
                          list={`fmt-list-${i}`}
                          value={item.format ?? ''}
                          onChange={(e) => change(i, { format: e.target.value || undefined })}
                          placeholder={
                            item.type === 'timestamp' ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd'
                          }
                          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                        />
                        <datalist id={`fmt-list-${i}`}>
                          {(item.type === 'timestamp' ? TIMESTAMP_FORMATS : DATE_FORMATS).map(
                            (f) => (
                              <option key={f} value={f} />
                            )
                          )}
                        </datalist>
                      </div>
                    )}

                    {item.type === 'timestamp' && (
                      <div>
                        <GlassFormLabel>{tr('typeConvertTimezone', '时区')}</GlassFormLabel>
                        <input
                          type="text"
                          list={`tz-list-${i}`}
                          value={item.timezone ?? ''}
                          onChange={(e) => change(i, { timezone: e.target.value || undefined })}
                          placeholder="Asia/Shanghai"
                          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                        />
                        <datalist id={`tz-list-${i}`}>
                          {TIMEZONE_OPTIONS.map((tz) => (
                            <option key={tz} value={tz} />
                          ))}
                        </datalist>
                      </div>
                    )}

                    {item.type === 'decimal' && (
                      <div>
                        <GlassFormLabel>{tr('typeConvertLocale', '区域')}</GlassFormLabel>
                        <GlassFormTextInput
                          value={item.locale ?? ''}
                          onChange={(v) => change(i, { locale: v || undefined })}
                          placeholder="de_DE"
                        />
                      </div>
                    )}

                    <div>
                      <GlassFormLabel>{tr('typeConvertErrorHandling', '错误处理')}</GlassFormLabel>
                      <select
                        value={item.onError ?? 'null'}
                        disabled={!fieldSelected}
                        onChange={(e) =>
                          change(i, {
                            onError: e.target.value !== 'null' ? e.target.value : undefined,
                          })
                        }
                        className={SELECT_CLASS}
                      >
                        {ON_ERROR_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t(
                              `formLabels.${o.value === 'null' ? 'typeConvertNullify' : o.value === 'fail' ? 'typeConvertFail' : 'typeConvertKeep'}`,
                              { defaultValue: o.label }
                            )}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={add}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          {tr('typeConvertAdd', '添加转换')}
        </button>
      </GlassFormSection>
    </div>
  );
}
