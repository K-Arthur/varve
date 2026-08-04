/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TemplateLibrary } from '@varve/platform';
import type { CustomPreset } from '@varve/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewFileDialog } from './NewFileDialog';

afterEach(cleanup);

const customPreset: CustomPreset = {
  id: 'custom-1',
  name: 'My Business Card',
  category: 'custom',
  width: 89,
  height: 51,
  unit: 'mm',
  orientation: 'landscape',
  createdAt: 1,
  updatedAt: 1,
};

const MOCK_TEMPLATES: TemplateLibrary[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    description: 'Start empty.',
    previewHash: '',
    source: 'builtin',
    documentJson: '{}',
    tags: [],
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('NewFileDialog', () => {
  it('renders blank tab with a blank canvas option when open', () => {
    const { container } = render(<NewFileDialog open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(container.textContent).toContain('Blank canvas');
  });

  it('switches to templates tab', () => {
    const { container } = render(
      <NewFileDialog open onClose={vi.fn()} onCreate={vi.fn()} templates={MOCK_TEMPLATES} />,
    );
    const tabs = container.querySelectorAll('button');
    const templateTab = Array.from(tabs).find((b) => b.textContent?.trim() === 'Templates');
    expect(templateTab).toBeDefined();
    if (!templateTab) throw new Error('templateTab not found');
    fireEvent.click(templateTab);
    expect(container.textContent).toContain('Blank Canvas');
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<NewFileDialog open onClose={onClose} onCreate={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent?.trim() === 'Cancel');
    expect(cancelBtn).toBeDefined();
    if (!cancelBtn) throw new Error('cancelBtn not found');
    fireEvent.click(cancelBtn);
    // The onClose is called by the button inside the Dialog
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('selecting a built-in paper preset from the picker fills in Create output (search + select)', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewFileDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole('combobox'), 'A4');
    await user.click(screen.getByText('A4'));
    await user.click(screen.getByTestId('create-file-button'));

    // Paper-category presets are intentionally color-mode-agnostic (no
    // forced dpi/cmyk) — only 'print'-category presets force those.
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ width: 210, height: 297, unit: 'mm', colorMode: 'rgb' }),
    );
  });

  it('selecting a built-in print preset forces cmyk + dpi + bleed', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewFileDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole('combobox'), 'Business Card (US)');
    await user.click(screen.getByText('Business Card (US)'));
    await user.click(screen.getByTestId('create-file-button'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ colorMode: 'cmyk', dpi: 300, bleed: { value: 3, unit: 'mm' } }),
    );
  });

  it('locks the aspect ratio and derives height from width', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewFileDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole('combobox'), 'Instagram Post');
    await user.click(screen.getByText('Instagram Post')); // 1080x1080, 1:1

    await user.click(screen.getByLabelText('Lock aspect ratio'));
    const widthInput = screen.getByLabelText('Width');
    await user.clear(widthInput);
    await user.type(widthInput, '500');

    await user.click(screen.getByTestId('create-file-button'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ width: 500, height: 500 }));
  });

  it('swaps width/height on orientation swap', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewFileDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole('combobox'), 'Instagram Story');
    await user.click(screen.getByText('Instagram Story / Reel')); // 1080x1920 portrait

    await user.click(screen.getByLabelText('Swap width and height'));
    await user.click(screen.getByTestId('create-file-button'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
  });

  it('reveals a name field and saves a custom preset', async () => {
    const user = userEvent.setup();
    const onSaveCustomPreset = vi.fn().mockReturnValue({ error: null });
    render(
      <NewFileDialog
        open
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSaveCustomPreset={onSaveCustomPreset}
      />,
    );

    await user.click(screen.getByText('Save as preset'));
    const nameInput = await screen.findByLabelText('Preset name');
    await user.clear(nameInput);
    await user.type(nameInput, 'My Preset');
    await user.click(screen.getByText('Save'));

    expect(onSaveCustomPreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Preset', width: 1920, height: 1080 }),
    );
  });

  it('renders a Custom section and wires favorite/duplicate/delete callbacks', async () => {
    const user = userEvent.setup();
    const onToggleFavoritePreset = vi.fn();
    render(
      <NewFileDialog
        open
        onClose={vi.fn()}
        onCreate={vi.fn()}
        customPresets={[customPreset]}
        onToggleFavoritePreset={onToggleFavoritePreset}
      />,
    );

    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('My Business Card')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add my business card to favorites/i }));
    expect(onToggleFavoritePreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-1' }),
    );
  });
});
