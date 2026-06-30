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
        <path d="M 5 3 H 14 L 11 6 H 2 Z M 2 6 H 11 L 14 9 H 5 Z M 5 9 H 14 L 11 12 H 2 Z" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" {...commonProps}>
      <path d="M 40 28 H 112 L 88 52 H 16 Z" fill="var(--color-brand-teal)" />
      <path d="M 16 52 H 88 L 112 76 H 40 Z" fill="var(--color-brand-sandstone)" />
      <path d="M 40 76 H 112 L 88 100 H 16 Z" fill="var(--color-brand-terracotta)" />
    </svg>
  );
});
