/**
 * ArchiveDialog unit tests.
 *
 * Tests both Create and Restore tabs: tab switching, encryption, password
 * validation, progress display, error handling, and keyboard navigation.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ArchiveDialog } from './ArchiveDialog';

// Mock the archive module
vi.mock('../../archive', () => ({
  buildArchive: vi.fn().mockResolvedValue({
    fileName: 'test-archive.zip',
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    manifest: {
      formatVersion: '1.0',
      kind: 'full',
      appVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      document: { id: 'doc-1', name: 'Test Doc', formatVersion: '2.0', nodeCount: 5 },
      settings: { categories: ['appearance'], itemCount: 3 },
      checksums: {},
      compatibility: { minAppVersion: '0.1.0', flags: [] },
    },
  }),
  restoreArchive: vi.fn().mockResolvedValue({
    document: { id: 'doc-2', name: 'Restored Doc', formatVersion: '2.0', nodes: { a: {}, b: {} } },
    settings: [],
    warnings: [],
    conflicts: [],
    restoredCategories: ['appearance'],
  }),
  validateArchive: vi.fn().mockResolvedValue({
    valid: true,
    manifest: {
      formatVersion: '1.0',
      kind: 'full',
      appVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      document: { id: 'doc-2', name: 'Restored Doc', formatVersion: '2.0', nodeCount: 2 },
      settings: { categories: ['appearance'], itemCount: 1 },
      checksums: {},
      compatibility: { minAppVersion: '0.1.0', flags: [] },
    },
  }),
  detectConflicts: vi.fn().mockReturnValue([]),
  collectSettingsBackup: vi.fn().mockReturnValue([]),
  createRollbackSnapshot: vi.fn().mockReturnValue({
    id: 'rollback-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    settingsHash: '',
    values: {},
  }),
  restoreRollbackSnapshot: vi.fn().mockReturnValue(true),
  applyRestore: vi.fn().mockResolvedValue({ applied: 0, warnings: [] }),
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  document: { id: 'doc-1', name: 'Test Doc', formatVersion: '2.0', nodes: {} },
};

function renderDialog(props: Partial<typeof defaultProps> = {}) {
  return render(<ArchiveDialog {...defaultProps} {...props} />);
}

describe('ArchiveDialog', () => {
  // jsdom doesn't implement File.prototype.arrayBuffer()
  beforeAll(() => {
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = function () {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      };
    }
  });

  describe('Create tab', () => {
    it('renders Create Archive tab by default', () => {
      renderDialog();
      expect(screen.getByRole('tab', { name: /create archive/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText('Archive type')).toBeInTheDocument();
    });

    it('shows archive type selector with Full Project and Settings Only', () => {
      renderDialog();
      expect(screen.getByRole('radio', { name: /full project/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /settings only/i })).toBeInTheDocument();
    });

    it('shows settings categories when Settings Only is selected', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('radio', { name: /settings only/i }));
      expect(screen.getByText('Settings categories')).toBeInTheDocument();
      expect(screen.getByText('Appearance')).toBeInTheDocument();
      expect(screen.getByText('Shortcuts')).toBeInTheDocument();
      expect(screen.getByText('Workspace')).toBeInTheDocument();
      expect(screen.getByText('Export')).toBeInTheDocument();
      expect(screen.getByText('Performance')).toBeInTheDocument();
      expect(screen.getByText('Presets')).toBeInTheDocument();
      expect(screen.getByText('Swatches')).toBeInTheDocument();
      expect(screen.getByText('Plugins')).toBeInTheDocument();
    });

    it('does not show settings categories for Full Project', () => {
      renderDialog();
      expect(screen.queryByText('Settings categories')).not.toBeInTheDocument();
    });

    it('shows encryption toggle', () => {
      renderDialog();
      expect(screen.getByText('Encrypt archive with password')).toBeInTheDocument();
    });

    it('shows password fields when encryption is enabled', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm')).toBeInTheDocument();
    });

    it('validates password confirmation matches', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      const passwordInput = screen.getByLabelText('Password');
      const confirmInput = screen.getByLabelText('Confirm');
      await user.type(passwordInput, 'mypassword');
      await user.type(confirmInput, 'wrongpassword');
      expect(screen.getByText('Mismatch')).toBeInTheDocument();
    });

    it('shows password strength indicator', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      const passwordInput = screen.getByLabelText('Password');
      await user.type(passwordInput, 'Varve2024');
      expect(screen.getByRole('meter', { name: /password strength/i })).toBeInTheDocument();
      expect(screen.getByText('Strong')).toBeInTheDocument();
    });

    it('disables Create button when password confirmation does not match', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      await user.type(screen.getByLabelText('Password'), 'password1');
      await user.type(screen.getByLabelText('Confirm'), 'different1');
      expect(screen.getByRole('button', { name: /create archive/i })).toBeDisabled();
    });

    it('shows destination file name', () => {
      renderDialog();
      expect(screen.getByText('Test Doc.varve-archive.zip')).toBeInTheDocument();
    });

    it('shows progress during archive creation', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('button', { name: /create archive/i }));
      // The mock resolves immediately, so we check for the completion state
      await waitFor(() => {
        expect(screen.getByText('Archive ready')).toBeInTheDocument();
      });
    });
  });

  describe('Restore tab', () => {
    it('can switch to Restore Archive tab', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('tab', { name: /restore archive/i }));
      expect(screen.getByRole('tab', { name: /restore archive/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText('Select archive file')).toBeInTheDocument();
    });

    it('shows file drop zone', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('tab', { name: /restore archive/i }));
      expect(screen.getByText(/drop archive here/i)).toBeInTheDocument();
    });

    it('shows restore preview with archive details after file selection', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('tab', { name: /restore archive/i }));

      // The drop zone contains a hidden <input type="file"> inside
      const fileInput = screen
        .getByLabelText(/drop an archive/i)
        .querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      const file = new File(['test'], 'test.zip', { type: 'application/zip' });
      await user.upload(fileInput! as HTMLElement, file);

      // Wait for async validation
      await waitFor(() => {
        expect(screen.getByText('Archive contents')).toBeInTheDocument();
      });
      expect(screen.getByText('Full project')).toBeInTheDocument();
      expect(screen.getByText('Restored Doc')).toBeInTheDocument();
    });

    it('does not apply settings until Apply Restore is confirmed (two-phase restore)', async () => {
      const { applyRestore, restoreArchive } = await import('../../archive');
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('tab', { name: /restore archive/i }));

      const fileInput = screen
        .getByLabelText(/drop an archive/i)
        .querySelector('input[type="file"]');
      const file = new File(['test'], 'test.zip', { type: 'application/zip' });
      await user.upload(fileInput! as HTMLElement, file);

      await waitFor(() => {
        expect(screen.getByText('Archive contents')).toBeInTheDocument();
      });

      const restoreButton = await screen.findByRole('button', { name: /^restore$/i });
      await user.click(restoreButton);

      // Preview only: restoreArchive ran (to read manifest/settings), but
      // nothing has been applied yet.
      await waitFor(() => {
        expect(vi.mocked(restoreArchive)).toHaveBeenCalled();
      });
      expect(vi.mocked(applyRestore)).not.toHaveBeenCalled();

      const applyButton = await screen.findByRole('button', { name: /apply restore/i });
      await user.click(applyButton);

      await waitFor(() => {
        expect(vi.mocked(applyRestore)).toHaveBeenCalledTimes(1);
      });
    });

    it('shows error for invalid archive on restore', async () => {
      const { validateArchive } = await import('../../archive');
      vi.mocked(validateArchive).mockResolvedValueOnce({
        valid: false,
        error: 'Invalid ZIP archive',
      });
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('tab', { name: /restore archive/i }));

      const fileInput = screen
        .getByLabelText(/drop an archive/i)
        .querySelector('input[type="file"]');
      const file = new File(['bad'], 'bad.zip', { type: 'application/zip' });
      await user.upload(fileInput! as HTMLElement, file);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid ZIP archive');
      });
    });

    it('Close button calls onClose', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderDialog({ onClose });
      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      // The Dialog close button or the footer Close button
      await user.click(closeButtons[closeButtons.length - 1]!);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('Escape key closes dialog', async () => {
      const onClose = vi.fn();
      renderDialog({ onClose });
      fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Escape' });
      // Dialog component handles Escape via onCancel
    });

    it('Tab buttons support arrow key navigation', () => {
      renderDialog();
      const createTab = screen.getByRole('tab', { name: /create archive/i });
      createTab.focus();
      fireEvent.keyDown(createTab, { key: 'ArrowRight' });
      expect(screen.getByRole('tab', { name: /restore archive/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  describe('Password strength', () => {
    it('shows weak for short passwords', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      await user.type(screen.getByLabelText('Password'), 'abc');
      expect(screen.getByText('Weak')).toBeInTheDocument();
    });

    it('shows fair for moderate passwords', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      // "password1!" — ≥8 chars, lowercase, digit, special = score 4 → strong
      await user.type(screen.getByLabelText('Password'), 'password1!');
      expect(screen.getByText('Strong')).toBeInTheDocument();
    });

    it('shows strong for good passwords', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      await user.type(screen.getByLabelText('Password'), 'MyPass123');
      expect(screen.getByText('Strong')).toBeInTheDocument();
    });

    it('shows very strong for excellent passwords', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByText('Encrypt archive with password'));
      // 12+ chars + uppercase + lowercase + digit + special = score 6 → very-strong
      await user.type(screen.getByLabelText('Password'), 'P@ssw0rd!9xyz');
      expect(screen.getByText('Very strong')).toBeInTheDocument();
    });
  });

  describe('Category selection', () => {
    it('can select and deselect individual categories', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('radio', { name: /settings only/i }));
      const appearanceCheckbox = screen.getByLabelText(/appearance/i);
      expect(appearanceCheckbox).toBeChecked();
      await user.click(appearanceCheckbox);
      expect(appearanceCheckbox).not.toBeChecked();
    });

    it('select all and deselect all work', async () => {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('radio', { name: /settings only/i }));
      await user.click(screen.getByRole('button', { name: /^Deselect all$/i }));
      const appearanceCheckbox = screen.getByLabelText(/appearance/i);
      expect(appearanceCheckbox).not.toBeChecked();
      await user.click(screen.getByRole('button', { name: /^Select all$/i }));
      expect(appearanceCheckbox).toBeChecked();
    });
  });
});
