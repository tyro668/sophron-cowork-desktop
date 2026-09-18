import type { AppLogoVariant } from '../../shared/contracts';
import { cn } from './ui/cn';
import markSrc from '../assets/logo.png';
import foldSrc from '../assets/logo-fold.png';

const masks: Record<AppLogoVariant, string> = {
  mark: `url("${markSrc}") center / contain no-repeat`,
  fold: `url("${foldSrc}") center / contain no-repeat`,
};

export function BrandMark({
  variant,
  className,
  label,
}: {
  variant: AppLogoVariant;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block flex-shrink-0', className)}
      style={{
        backgroundColor: 'var(--color-brand-mark)',
        WebkitMask: masks[variant],
        mask: masks[variant],
      }}
    />
  );
}
