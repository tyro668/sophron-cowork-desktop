import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { GlassExpressionEditor } from './GlassExpressionEditor';

interface GlassExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  placeholder?: string;
  excludeFunctionCategories?: string[];
}

export function GlassExpressionInput({
  value,
  onChange,
  fieldCompletions,
  columnTypes,
  placeholder,
  excludeFunctionCategories,
}: GlassExpressionInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="relative h-7 w-full cursor-pointer rounded-md border border-border-muted bg-background/42 text-[12px] text-text-primary outline-none hover:border-accent/40 transition-colors"
      >
        <span className="block truncate px-1.5 leading-7">
          {value || <span className="text-text-muted">{placeholder ?? '输入表达式'}</span>}
        </span>
        <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-tl bg-background/60 text-text-muted opacity-50 hover:opacity-100 transition-opacity">
          <Pencil className="h-3 w-3" />
        </span>
      </div>
      {open && (
        <GlassExpressionEditor
          value={value}
          onChange={onChange}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          onClose={() => setOpen(false)}
          excludeFunctionCategories={excludeFunctionCategories}
        />
      )}
    </>
  );
}
