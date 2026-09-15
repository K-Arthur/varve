/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageFillData } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResizeDialog } from './ImageResizeDialog';

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const fill = {
  src: 'data:image/png;base64,AAAA',
  imageWidth: 200,
  imageHeight: 100,
  fit: 'fill',
} as unknown as ImageFillData;

describe('ImageResizeDialog', () => {
  it('exposes the linear-light choice and persists it in the apply request', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ImageResizeDialog nodeId="photo" fill={fill} onClose={() => {}} onApply={onApply} />);

    await user.click(screen.getByRole('combobox', { name: 'Resize working space' }));
    await user.click(screen.getByRole('option', { name: 'Linear light (photo edges)' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'photo',
        resample: 'bicubic',
        workingSpace: 'linear-srgb',
      }),
    );
  });

  it('moves initial focus to the width field', () => {
    render(<ImageResizeDialog nodeId="photo" fill={fill} onClose={() => {}} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Width')).toHaveFocus();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ImageResizeDialog nodeId="photo" fill={fill} onClose={onClose} onApply={vi.fn()} />);
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
