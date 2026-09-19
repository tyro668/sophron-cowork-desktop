import { X } from 'lucide-react';

/**
 * The single selected-value chip for every multi-select surface — bordered
 * rounded-md pill with an optional missing marker and remove button. New
 * consumers must reuse this instead of re-creating the markup so the style
 * can never drift between field pickers and value inputs.
 */
export function GlassValueChip({
  label,
  disabled,
  missing,
  missingTitle,
  onRemove,
  removeAriaLabel,
}: {
  label: string;
  disabled?: boolean;
  /** Renders the error border/background plus a `?` marker. */
  missing?: boolean;
  missingTitle?: string;
  onRemove?: () => void;
  removeAriaLabel?: string;
}) {
  return (
    <span
      title={missing ? missingTitle : undefined}
      className={`inline-flex h-6 max-w-[180px] shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] font-medium ${
        missing
          ? 'border-error/25 bg-error/10 text-error'
          : 'border-accent/20 bg-accent-muted text-accent'
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {missing && <span className="shrink-0 text-[9px]">?</span>}
      {onRemove && (
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={removeAriaLabel ?? label}
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
            missing ? 'hover:bg-error/15' : 'hover:bg-accent/15'
          }`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
