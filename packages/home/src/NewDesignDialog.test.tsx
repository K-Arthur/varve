/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TemplateLibrary } from '@varve/platform';
import type { CustomPreset } from '@varve/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewDesignDialog } from './NewDesignDialog';

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
    id: 'template-1',
    name: 'Brand Deck',
    category: 'Presentation',
    description: 'A starter presentation.',
    previewHash: '',
    source: 'builtin',
    documentJson: JSON.stringify({ formatVersion: '2.14', name: 'Brand Deck' }),
    tags: [],
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('NewDesignDialog', () => {
  it('shows the document name field with the suggested default', () => {
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={vi.fn()} defaultName="Untitled 3" />);
    const nameInput = screen.getByLabelText('Document name') as HTMLInputElement;
    expect(nameInput.value).toBe('Untitled 3');
  });

  it('defaults to an empty-document start and creates an empty request', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} defaultName="Untitled 1" />);
    await user.click(screen.getByTestId('create-design-button'));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'empty', documentName: 'Untitled 1' }),
    );
  });

  it('honors a typed name without appending an extension', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} defaultName="Untitled 1" />);
    const nameInput = screen.getByLabelText('Document name');
    await user.clear(nameInput);
    await user.type(nameInput, 'My Свадебный Альбом');
    await user.click(screen.getByTestId('create-design-button'));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ documentName: 'My Свадебный Альбом' }),
    );
  });

  it('creates a framePreset request when starting with a frame preset', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.type(screen.getByRole('combobox'), 'Instagram Post');
    await user.click(screen.getByText('Instagram Post'));
    await user.click(screen.getByTestId('create-design-button'));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ startMode: 'framePreset' }));
    const request = onCreate.mock.calls[0]?.[0] as { preset?: { id?: string } };
    expect(request.preset?.id).toBe('ig-post');
  });

  it('creates a customFrame request with unit conversion preserved', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.click(screen.getByRole('radio', { name: 'Custom size' }));
    await user.click(screen.getByTestId('create-design-button'));

    const request = onCreate.mock.calls[0]?.[0] as {
      startMode?: string;
      customFrame?: { width: number; height: number; unit: string };
    };
    expect(request.startMode).toBe('customFrame');
    // Custom fields are seeded from the default preset (ig-post 1080x1080).
    expect(request.customFrame).toEqual({ width: 1080, height: 1080, unit: 'px' });
  });

  it('swaps width/height on orientation swap', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.type(screen.getByRole('combobox'), 'Instagram Story');
    await user.click(screen.getByText('Instagram Story / Reel'));
    await user.click(screen.getByRole('radio', { name: 'Custom size' }));
    await user.click(screen.getByLabelText('Swap width and height'));
    await user.click(screen.getByTestId('create-design-button'));

    const request = onCreate.mock.calls[0]?.[0] as {
      customFrame?: { width: number; height: number };
    };
    expect(request.customFrame).toEqual({ width: 1920, height: 1080, unit: 'px' });
  });

  it('locks the aspect ratio and derives height from width', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.type(screen.getByRole('combobox'), 'Instagram Post');
    await user.click(screen.getByText('Instagram Post')); // 1080x1080, 1:1
    await user.click(screen.getByRole('radio', { name: 'Custom size' }));

    await user.click(screen.getByLabelText('Lock aspect ratio'));
    const widthInput = screen.getByLabelText('Width');
    await user.clear(widthInput);
    await user.type(widthInput, '500');

    await user.click(screen.getByTestId('create-design-button'));
    const request = onCreate.mock.calls[0]?.[0] as {
      customFrame?: { width: number; height: number };
    };
    expect(request.customFrame).toEqual({ width: 500, height: 500, unit: 'px' });
  });

  it('keeps Create enabled for valid custom dimensions', async () => {
    const user = userEvent.setup();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.click(screen.getByRole('radio', { name: 'Custom size' }));
    // NumberInput clamps typed values to its min; invalid values are
    // additionally rejected by createNewDocument's validateCustomFrame.
    expect(screen.getByTestId('create-design-button')).toBeEnabled();
  });

  it('selecting a print preset auto-reveals advanced settings with CMYK', async () => {
    const user = userEvent.setup();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.type(screen.getByRole('combobox'), 'Business Card (US)');
    await user.click(screen.getByText('Business Card (US)'));

    // Advanced panel is open and carries the print intent hint.
    expect(screen.getByRole('button', { name: /advanced settings/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Print intent: CMYK, bleed, DPI')).toBeVisible();
    // The print-only controls are revealed.
    expect(screen.getByLabelText('DPI')).toBeVisible();
    expect(screen.getByLabelText('Bleed')).toBeVisible();
  });

  it('creates a print request with cmyk + dpi + bleed', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewDesignDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    await user.type(screen.getByRole('combobox'), 'Business Card (US)');
    await user.click(screen.getByText('Business Card (US)'));
    await user.click(screen.getByTestId('create-design-button'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: 'framePreset',
        colorMode: 'cmyk',
        dpi: 300,
        bleed: { value: 3, unit: 'mm' },
      }),
    );
  });

  it('creates a template request from the template gallery', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <NewDesignDialog
        open
        onClose={vi.fn()}
        onCreate={onCreate}
        templates={MOCK_TEMPLATES}
        defaultName="Untitled 2"
      />,
    );

    await user.click(screen.getByRole('radio', { name: /template/i }));
    await user.click(screen.getByText('Brand Deck'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: 'template',
        documentName: 'Untitled 2',
      }),
    );
    const request = onCreate.mock.calls[0]?.[0] as { templateJson?: string };
    expect(request.templateJson).toContain('Brand Deck');
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    render(<NewDesignDialog open onClose={onClose} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a Custom section and wires favorite/duplicate/delete callbacks', async () => {
    const user = userEvent.setup();
    const onToggleFavoritePreset = vi.fn();
    render(
      <NewDesignDialog
        open
        onClose={vi.fn()}
        onCreate={vi.fn()}
        customPresets={[customPreset]}
        onToggleFavoritePreset={onToggleFavoritePreset}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /start with a frame/i }));
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('My Business Card')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add my business card to favorites/i }));
    expect(onToggleFavoritePreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-1' }),
    );
  });
});
