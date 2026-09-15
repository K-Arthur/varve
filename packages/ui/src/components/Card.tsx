import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type CardVariant =
  | 'subtle'
  | 'outline'
  | 'surface'
  | 'interactive'
  | 'selectable'
  | 'media'
  | 'status'
  | 'prominent';
export type CardDensity = 'compact' | 'standard';
export type CardOrientation = 'vertical' | 'horizontal';
export type CardElement = 'div' | 'article' | 'section' | 'li';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** A semantic container only; interactive behavior belongs to a real child control. */
  as?: CardElement;
  variant?: CardVariant;
  density?: CardDensity;
  orientation?: CardOrientation;
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

function slotClass(name: string, className: string | undefined): string {
  return ['varve-card__slot', `varve-card__${name}`, className].filter(Boolean).join(' ');
}

/** @maturity beta
 *
 * Beta composable card surface. It owns surface geometry and state styling;
 * product components own semantics, data, and interaction behavior.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    as = 'div',
    variant = 'surface',
    density = 'standard',
    orientation = 'vertical',
    selected = false,
    disabled = false,
    loading = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  // The constrained element union keeps callers from accidentally turning a
  // card into a nested interactive control. A div ref is retained for the
  // dominant grid-cell use case; semantic article/section/li cards do not
  // require a ref in the current consumers.
  const Component = as as 'div';
  const classes = ['varve-card', `varve-card--${variant}`, className].filter(Boolean).join(' ');

  return (
    <Component
      ref={ref}
      className={classes}
      data-variant={variant}
      data-density={density}
      data-orientation={orientation}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      data-loading={loading || undefined}
      aria-busy={loading ? 'true' : undefined}
      aria-disabled={disabled ? 'true' : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
});

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={slotClass('header', className)} {...rest}>
      {children}
    </div>
  );
});

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  children?: ReactNode;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { as = 'h3', className, children, ...rest },
  ref,
) {
  const Heading = as;
  return (
    <Heading ref={ref} className={slotClass('title', className)} {...rest}>
      {children}
    </Heading>
  );
});

export interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
}

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, children, ...rest }, ref) {
    return (
      <p ref={ref} className={slotClass('description', className)} {...rest}>
        {children}
      </p>
    );
  },
);

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(function CardContent(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={slotClass('content', className)} {...rest}>
      {children}
    </div>
  );
});

export interface CardMediaProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardMedia = forwardRef<HTMLDivElement, CardMediaProps>(function CardMedia(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={slotClass('media', className)} {...rest}>
      {children}
    </div>
  );
});

export interface CardActionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardAction = forwardRef<HTMLDivElement, CardActionProps>(function CardAction(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={slotClass('action', className)} {...rest}>
      {children}
    </div>
  );
});

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={slotClass('footer', className)} {...rest}>
      {children}
    </div>
  );
});
