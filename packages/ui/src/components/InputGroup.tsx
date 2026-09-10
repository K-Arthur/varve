import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export type InputGroupOrientation = 'horizontal' | 'vertical';
export type InputGroupAddonAlign = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';

export interface InputGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  orientation?: InputGroupOrientation;
  /** Adds the invalid state to the shared group boundary. */
  invalid?: boolean;
}

export function InputGroup({
  children,
  orientation = 'horizontal',
  invalid,
  className = '',
  ...rest
}: InputGroupProps) {
  const classes = ['varve-input-group', `varve-input-group--${orientation}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      {...rest}
      className={classes}
      data-slot="input-group"
      data-invalid={invalid ? 'true' : undefined}
    >
      {children}
    </div>
  );
}

export interface InputGroupInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  className?: string;
}

export const InputGroupInput = forwardRef<HTMLInputElement, InputGroupInputProps>(
  function InputGroupInput({ className = '', ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        className={`varve-input-group__input${className ? ` ${className}` : ''}`}
        data-slot="input-group-input"
      />
    );
  },
);

export interface InputGroupAddonProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  align?: InputGroupAddonAlign;
}

export function InputGroupAddon({
  children,
  align = 'inline-start',
  className = '',
  ...rest
}: InputGroupAddonProps) {
  return (
    <div
      {...rest}
      className={`varve-input-group__addon varve-input-group__addon--${align}${className ? ` ${className}` : ''}`}
      data-align={align}
      data-slot="input-group-addon"
    >
      {children}
    </div>
  );
}

export interface InputGroupTextProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function InputGroupText({ children, className = '', ...rest }: InputGroupTextProps) {
  return (
    <span
      {...rest}
      className={`varve-input-group__text${className ? ` ${className}` : ''}`}
      data-slot="input-group-text"
    >
      {children}
    </span>
  );
}

export interface InputGroupButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  children: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  size?: 'sm' | 'icon';
}

export function InputGroupButton({
  children,
  type = 'button',
  size = 'sm',
  className = '',
  ...rest
}: InputGroupButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`varve-input-group__button varve-input-group__button--${size}${className ? ` ${className}` : ''}`}
      data-slot="input-group-button"
    >
      {children}
    </button>
  );
}
