import { forwardRef, type SVGProps } from 'react';

export interface StrataLogoProps extends SVGProps<SVGSVGElement> {
  /**
   * Accessible name. If provided, exposed as `role="img"` with `aria-label`.
   * If omitted, marked `aria-hidden` (decorative) and MUST be accompanied by
   * visible text.
   */
  label?: string;
  /** Pixel size; defaults to 1em (inherits font-size). */
  size?: number | string;
  /** Render the single-color symbolic variant */
  symbolic?: boolean;
}

export const StrataLogo = forwardRef<SVGSVGElement, StrataLogoProps>(function StrataLogo(
  { label, size = '1em', symbolic = false, ...rest },
  ref,
) {
  const commonProps = {
    ref,
    width: size,
    height: size,
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false }),
    ...rest,
  };

  if (symbolic) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        {...commonProps}
      >
        <title>{label ?? 'Strata logo'}</title>
        <rect x="1" y="2" width="9" height="3" rx="1" />
        <rect x="3" y="7" width="9" height="3" rx="1" />
        <rect x="5" y="12" width="9" height="3" rx="1" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" {...commonProps}>
      <title>{label ?? 'Strata logo'}</title>
      <path d="M20,26 H84 L92,46 H28 Z" fill="var(--color-brand-teal, #39D0C6)" />
      <path d="M28,54 H92 L100,74 H36 Z" fill="var(--color-brand-sandstone, #E28C3C)" />
      <path d="M36,82 H100 L108,102 H44 Z" fill="var(--color-brand-terracotta, #C54B3A)" />
    </svg>
  );
});
