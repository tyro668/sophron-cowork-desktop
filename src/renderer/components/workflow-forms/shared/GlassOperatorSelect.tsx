import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * 运算符分组（组之间显示分割线）
 */
interface GlassOperatorGroup {
  /** 分组 key（仅用于 React 渲染，不显示） */
  key: string;
  /** 该组的运算符选项 */
  items: GlassOperatorOption[];
}

interface GlassOperatorOption {
  /** 运算符值，如 "="、"in"、"matches" */
  value: string;
  /** 已翻译的显示文本 */
  label: string;
}

interface GlassOperatorSelectProps {
  value: string;
  /** 分组列表，每组的 items.label 需由调用方预翻译 */
  groups: GlassOperatorGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, onClose]);
}

export function GlassOperatorSelect({
  value,
  groups,
  disabled,
  onChange,
  className,
}: GlassOperatorSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    for (const g of groups) {
      for (const o of g.items) {
        if (o.value === value) return o.label;
      }
    }
    return value;
  }, [value, groups]);

  useClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center rounded border border-border-muted bg-background/42 text-text-secondary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ''}`}
      >
        <span className="flex-1 px-2 text-center whitespace-nowrap">{selectedLabel}</span>
        <ChevronDown
          className={`mr-1 h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-full max-h-60 overflow-y-auto rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          {groups.map((g, gi) => (
            <div key={g.key}>
              {gi > 0 && <div className="mx-3 my-0.5 border-t border-border-muted" />}
              {g.items.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`w-full whitespace-nowrap px-3 py-1.5 text-center text-[12px] transition-colors hover:bg-surface-hover ${
                    o.value === value ? 'text-accent font-medium' : 'text-text-secondary'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
