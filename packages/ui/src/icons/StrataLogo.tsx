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
        <path d="M 2 2 H 11 L 14 5 H 5 Z M 5 6 H 14 L 11 9 H 2 Z M 2 10 H 11 L 14 13 H 5 Z" />
      </svg>
    );
  }

  // Master full-color mark using CSS tokens
  // Uses var(--color-brand-teal), var(--color-brand-sandstone), var(--color-brand-terracotta)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" {...commonProps}>
      <title>{label ?? 'Strata logo'}</title>
      <path d="M 16 20 H 88 L 112 44 H 40 Z" fill="var(--color-brand-teal)" />
      <path d="M 40 52 H 112 L 88 76 H 16 Z" fill="var(--color-brand-sandstone)" />
      <path d="M 16 84 H 88 L 112 108 H 40 Z" fill="var(--color-brand-terracotta)" />
    </svg>
  );
});
