import { forwardRef } from 'react';
import { Icon, type IconName, SolidIcon, type SolidIconName } from '../icons';
import { Button, type ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  icon: IconName | SolidIconName;
  label: string;
  pressed?: boolean;
  /** Use SolidIcon (filled) instead of Icon (outline) */
  solid?: boolean;
  /** Optional override for the spoken name outside the busy state. */
  'aria-label'?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = 'ghost',
    size = 'icon',
    pressed,
    solid = false,
    loading = false,
    loadingLabel,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  return (
    <Button
      {...rest}
      ref={ref}
      className={`varve-iconbtn ${rest.className ?? ''}`.trim()}
      variant={variant}
      size={size}
      loading={loading}
      loadingLabel={loadingLabel ?? `${ariaLabel ?? label}, loading`}
      aria-pressed={pressed ?? undefined}
      aria-label={ariaLabel ?? label}
    >
      {solid ? (
        <SolidIcon name={icon as SolidIconName} size="1.15em" />
      ) : (
        <Icon name={icon as IconName} size="1.15em" />
      )}
    </Button>
  );
});
