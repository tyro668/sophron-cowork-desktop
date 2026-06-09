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
    <div className="inline-flex rounded-md border border-border-muted/55 bg-background/24 p-0.5">
      <button
        type="button"
        onClick={() => onChange('form')}
        className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
          mode === 'form'
            ? 'bg-background/80 text-accent shadow-soft'
            : 'text-text-muted hover:bg-background/30 hover:text-text-secondary'
        }`}
      >
        <FormInput className="h-3 w-3" />
        {formLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('dsl')}
        className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
          mode === 'dsl'
            ? 'bg-background/80 text-accent shadow-soft'
            : 'text-text-muted hover:bg-background/30 hover:text-text-secondary'
        }`}
      >
        <Code2 className="h-3 w-3" />
        {dslLabel}
      </button>
    </div>
  );
}
