import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { Trash2, X, ChevronDown } from 'lucide-react';

export interface GlassTagBarProps {
  items: string[];
  onRemove: (item: string) => void;
  onClear: () => void;
  open: boolean;
  onToggle: () => void;
  toggleStyle?: 'chevron' | 'none';
  density?: 'compact' | 'default' | 'spacious';
  placeholder?: string;
  wrap?: boolean;
  className?: string;
}

export function GlassTagBar({
  items,
  onRemove,
  onClear,
  open,
  onToggle,
  toggleStyle = 'chevron',
  density = 'default',
  placeholder,
  wrap = false,
  className = '',
}: GlassTagBarProps) {
  const tr = useFormTranslation();

  const containerPad =
    density === 'compact' ? '' : density === 'spacious' ? 'px-2.5 py-1.5' : 'px-2 py-1';
  const tagPad =
    density === 'compact'
      ? 'px-1 py-0.5'
      : density === 'spacious'
        ? 'px-2 py-0.5'
        : 'px-1.5 py-0.5';

  return (
    <div
      className={`w-full min-w-0 flex items-center rounded-md border border-border-muted bg-background/42 ${containerPad} ${className}`}
    >
      <div className="flex flex-1 items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
          title={tr('clearAll', '清空')}
          aria-label={tr('clearAll', '清空')}
        >
          <Trash2 className="h-3 w-3" />
        </button>

        {items.length === 0 && placeholder && (
          <span className="text-[12px] text-text-muted italic whitespace-nowrap flex-shrink-0">
            {placeholder}
          </span>
        )}

        <div
          className={`flex flex-1 items-center gap-1 min-w-0 ${wrap ? 'flex-wrap' : 'overflow-x-auto'}`}
        >
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className={`inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 ${tagPad} text-[12px] font-medium text-accent max-w-[180px]`}
            >
              <span className="truncate">{item}</span>
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                aria-label={tr('removeField', '移除')}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>

        {toggleStyle === 'chevron' && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
            className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
    </div>
  );
}
