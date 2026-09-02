import type { FileRejection, FileSelectionOptions } from '@varve/shared';
import { validateFileSelection } from '@varve/shared';
import { type ReactNode, useCallback, useRef } from 'react';
import { Icon, type IconName } from '../icons';
import { Button, type ButtonProps } from './Button';

export interface FilePickerButtonProps
  extends Omit<ButtonProps, 'children' | 'onClick' | 'type'>,
    FileSelectionOptions {
  /** Called with accepted files in the order selected by the user. */
  onFiles: (files: File[]) => void | Promise<void>;
  /** Called for files rejected before feature-level parsing. */
  onReject?: (rejections: FileRejection<File>[]) => void;
  /** Visible button content. Defaults to `actionLabel`. */
  children?: ReactNode;
  actionLabel?: string;
  icon?: IconName;
  /** Accessible name for the hidden input; the button remains the primary label. */
  inputLabel?: string;
}

/**
 * Compact, keyboard-accessible browse fallback for local file operations.
 * The input is reset after every change so selecting the same file again works.
 */
export function FilePickerButton({
  onFiles,
  onReject,
  accept,
  multiple = false,
  maxFiles,
  maxSize,
  minSize,
  children,
  actionLabel = 'Browse',
  icon = 'FileUp',
  inputLabel,
  disabled,
  ...buttonProps
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const files = Array.from(input.files ?? []);
      input.value = '';
      const result = validateFileSelection(files, { accept, maxFiles, maxSize, minSize });
      if (result.rejected.length > 0) onReject?.(result.rejected);
      if (result.accepted.length > 0) void onFiles(result.accepted);
    },
    [accept, maxFiles, maxSize, minSize, onFiles, onReject],
  );

  return (
    <>
      <Button
        {...buttonProps}
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name={icon} label={undefined} />
        {children ?? actionLabel}
      </Button>
      <input
        ref={inputRef}
        className="varve-visually-hidden"
        type="file"
        accept={typeof accept === 'string' ? accept : accept?.join(',')}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        aria-label={inputLabel ?? actionLabel}
        onChange={handleChange}
      />
    </>
  );
}
