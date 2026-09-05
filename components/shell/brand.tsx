import { cn } from '@/lib/utils';

/**
 * The wordmark.
 *
 * The glyph is three ascending bars with a forward lean — momentum as
 * accumulating progress rather than a generic checkmark. Drawn as inline SVG
 * with `currentColor` so it inherits text color and needs no separate dark-mode
 * asset.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-6', className)}
      aria-hidden
      focusable="false"
    >
      <rect x="3" y="14" width="4" height="7" rx="1.6" fill="currentColor" opacity="0.45" />
      <rect x="9.4" y="9" width="4" height="12" rx="1.6" fill="currentColor" opacity="0.72" />
      <rect x="15.8" y="3" width="4" height="18" rx="1.6" fill="currentColor" />
    </svg>
  );
}

export function BrandLockup({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark className="text-primary size-[1.375rem]" />
      {showWordmark ? (
        <span className="text-ink text-[0.9375rem] font-semibold tracking-[-0.02em]">Momentum</span>
      ) : null}
    </span>
  );
}
