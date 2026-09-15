import { VennDiagramIcon, type VennRegion } from '../shared/VennDiagramIcon';

export type JoinVennType = 'left' | 'inner' | 'full' | 'right' | 'cross' | 'semi' | 'anti' | 'asof';

const JOIN_VENN_REGIONS: Record<Exclude<JoinVennType, 'cross' | 'asof'>, VennRegion> = {
  left: 'left',
  inner: 'overlap',
  full: 'both',
  right: 'right',
  semi: 'overlap',
  anti: 'left-only',
};

// Shared geometry keeps the selected regions comparable across join types.
export function JoinVennSVG({
  type,
  selected,
  className = 'h-6 w-auto shrink-0',
}: {
  type: JoinVennType;
  selected: boolean;
  className?: string;
}) {
  const opacity = selected ? 0.55 : 0.2;

  if (type === 'cross') {
    return (
      <svg viewBox="0 0 48 32" className={className}>
        <line
          x1="14"
          y1="10"
          x2="34"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.3"
          opacity={opacity}
        />
        <line
          x1="34"
          y1="10"
          x2="14"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.3"
          opacity={opacity}
        />
      </svg>
    );
  }
  if (type === 'asof') {
    return (
      <svg viewBox="0 0 48 32" className={className}>
        <line x1="6" y1="16" x2="42" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <circle cx="14" cy="16" r="2.5" fill="currentColor" opacity={opacity} />
        <circle cx="24" cy="16" r="2.5" fill="currentColor" opacity={opacity} />
        <circle cx="34" cy="16" r="2.5" fill="currentColor" opacity={opacity} />
        <polygon points="42,16 38,13 38,19" fill="currentColor" opacity={opacity} />
      </svg>
    );
  }

  const semiOutlineOpacity =
    type === 'semi'
      ? {
          leftOutlineOpacity: selected ? 0.65 : 0.4,
          rightOutlineOpacity: selected ? 0.18 : 0.14,
        }
      : {};

  return (
    <VennDiagramIcon
      region={JOIN_VENN_REGIONS[type]}
      className={className}
      fillOpacity={opacity}
      {...semiOutlineOpacity}
    />
  );
}
