import { useId } from 'react';

export type VennRegion = 'both' | 'overlap' | 'left' | 'right' | 'left-only';

interface VennDiagramIconProps {
  region: VennRegion;
  className?: string;
  fillOpacity?: number;
  outlineOpacity?: number;
  leftOutlineOpacity?: number;
  rightOutlineOpacity?: number;
  outlineWidth?: number;
  showOutlines?: boolean;
}

export function VennDiagramIcon({
  region,
  className = 'h-6 w-auto shrink-0',
  fillOpacity = 0.55,
  outlineOpacity = 0.3,
  leftOutlineOpacity = outlineOpacity,
  rightOutlineOpacity = outlineOpacity,
  outlineWidth = 1.2,
  showOutlines = true,
}: VennDiagramIconProps) {
  const id = useId();
  const clipId = `venn-clip-${id}`;
  const maskId = `venn-mask-${id}`;

  return (
    <svg viewBox="0 0 48 32" className={className} data-venn-region={region} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="16" r="11" />
        </clipPath>
        <mask id={maskId}>
          <rect x="0" y="0" width="48" height="32" fill="white" />
          <circle cx="32" cy="16" r="11" fill="black" />
        </mask>
      </defs>

      {(region === 'left' || region === 'both') && (
        <circle cx="16" cy="16" r="11" fill="currentColor" opacity={fillOpacity} />
      )}
      {region === 'right' || region === 'both' ? (
        <circle cx="32" cy="16" r="11" fill="currentColor" opacity={fillOpacity} />
      ) : null}
      {region === 'overlap' && (
        <circle
          cx="16"
          cy="16"
          r="11"
          fill="currentColor"
          opacity={fillOpacity}
          clipPath={`url(#${clipId})`}
        />
      )}
      {region === 'left-only' && (
        <circle
          cx="16"
          cy="16"
          r="11"
          fill="currentColor"
          opacity={fillOpacity}
          mask={`url(#${maskId})`}
        />
      )}

      {showOutlines && (
        <>
          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke="currentColor"
            strokeWidth={outlineWidth}
            opacity={leftOutlineOpacity}
          />
          <circle
            cx="32"
            cy="16"
            r="11"
            fill="none"
            stroke="currentColor"
            strokeWidth={outlineWidth}
            opacity={rightOutlineOpacity}
          />
        </>
      )}
    </svg>
  );
}
