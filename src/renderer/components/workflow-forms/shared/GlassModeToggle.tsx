import { FormInput, Code2 } from 'lucide-react';

interface GlassModeToggleProps {
  mode: 'form' | 'dsl';
  onChange: (mode: 'form' | 'dsl') => void;
  formLabel?: string;
  dslLabel?: string;
}

export function GlassModeToggle({
  mode,
  onChange,
  formLabel = '表单',
  dslLabel = 'DSL',
}: GlassModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg bg-surface-active p-0.5">
      <button
        type="button"
        onClick={() => onChange('form')}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
          mode === 'form'
            ? 'bg-[var(--glass-card-strong)] text-accent shadow-soft'
            : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <FormInput className="h-3.5 w-3.5" />
        {formLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('dsl')}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
          mode === 'dsl'
            ? 'bg-[var(--glass-card-strong)] text-accent shadow-soft'
            : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <Code2 className="h-3.5 w-3.5" />
        {dslLabel}
      </button>
    </div>
  );
}
