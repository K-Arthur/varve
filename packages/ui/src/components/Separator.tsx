import type { HTMLAttributes, ReactNode } from 'react';
import './Separator.css';

export type SeparatorOrientation = 'horizontal' | 'vertical';
export type SeparatorVariant = 'solid' | 'dashed' | 'fade';
export type SeparatorTone = 'subtle' | 'default' | 'strong' | 'accent';

export interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: SeparatorOrientation;
  decorative?: boolean;
  variant?: SeparatorVariant;
  tone?: SeparatorTone;
}

export function Separator({
  orientation = 'horizontal',
  decorative = false,
  variant = 'solid',
  tone = 'default',
  className = '',
  ...props
}: SeparatorProps) {
  return (
    <hr
      {...props}
      className={[
        'varve-separator',
        `varve-separator--${orientation}`,
        `varve-separator--${variant}`,
        `varve-separator--${tone}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-orientation={orientation}
      {...(decorative ? { role: 'presentation', 'aria-hidden': true } : {})}
    />
  );
}

export interface SeparatorWithContentProps
  extends Omit<SeparatorProps, 'orientation' | 'children' | 'role'> {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

export function SeparatorWithContent({
  children,
  align = 'center',
  className = '',
  ...props
}: SeparatorWithContentProps) {
  return (
    <div
      className={['varve-separator-content', `varve-separator-content--${align}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Separator {...props} decorative />
      <span className="varve-separator-content__value">{children}</span>
      <Separator {...props} decorative />
    </div>
  );
}

export interface AnimatedSeparatorProps extends Omit<SeparatorProps, 'children'> {
  active?: boolean;
}

export function AnimatedSeparator({
  active = true,
  className = '',
  ...props
}: AnimatedSeparatorProps) {
  return (
    <Separator
      {...props}
      className={[
        'varve-separator--animated',
        active && 'varve-separator--animated-active',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
