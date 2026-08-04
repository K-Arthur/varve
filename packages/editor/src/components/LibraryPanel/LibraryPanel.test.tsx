/**
 * LibraryPanel tests.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { createDocument, createLibrary } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { LibraryPanel } from './LibraryPanel';

describe('LibraryPanel', () => {
  const mockInstallLibrary = vi.fn();
  const mockUninstallLibrary = vi.fn();
  const doc = createDocument('Test');
  const library = createLibrary('Test Library', 'A test library', '1.0.0');
  doc.installedLibraries = [
    {
      id: library.id,
      name: library.name,
      version: library.version,
      installedAt: new Date().toISOString(),
    },
  ];

  it('renders empty state when no libraries are installed', () => {
    render(
      <LibraryPanel
        doc={createDocument('Empty')}
        onInstallLibrary={mockInstallLibrary}
        onUninstallLibrary={mockUninstallLibrary}
      />,
    );

    expect(screen.getByText('No libraries installed')).toBeInTheDocument();
    expect(screen.getByText(/Import a library from clipboard or file/)).toBeInTheDocument();
  });

  it('renders list of installed libraries', () => {
    render(
      <LibraryPanel
        doc={doc}
        onInstallLibrary={mockInstallLibrary}
        onUninstallLibrary={mockUninstallLibrary}
      />,
    );

    expect(screen.getByText('Test Library')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('calls onInstallLibrary when install from clipboard button is clicked', async () => {
    const mockClipboardReadText = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ library: createLibrary('New Library') }));
    Object.defineProperty(global.navigator, 'clipboard', {
      value: {
        readText: mockClipboardReadText,
        writeText: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    render(
      <LibraryPanel
        doc={createDocument('Empty')}
        onInstallLibrary={mockInstallLibrary}
        onUninstallLibrary={mockUninstallLibrary}
      />,
    );

    const installButton = screen.getByText('Paste from Clipboard');
    fireEvent.click(installButton);

    await vi.waitFor(() => {
      expect(mockClipboardReadText).toHaveBeenCalled();
      expect(mockInstallLibrary).toHaveBeenCalled();
    });
  });

  it('calls onUninstallLibrary when uninstall button is clicked', () => {
    render(
      <LibraryPanel
        doc={doc}
        onInstallLibrary={mockInstallLibrary}
        onUninstallLibrary={mockUninstallLibrary}
      />,
    );

    const uninstallButton = screen.getByText('Uninstall');
    fireEvent.click(uninstallButton);

    expect(mockUninstallLibrary).toHaveBeenCalledWith(library.id);
  });

  it('selects a library when clicked', () => {
    render(
      <LibraryPanel
        doc={doc}
        onInstallLibrary={mockInstallLibrary}
        onUninstallLibrary={mockUninstallLibrary}
      />,
    );

    const libraryItems = screen.getAllByText('Test Library');
    const libraryItem = libraryItems[0]; // Get the first one (in the list)
    if (libraryItem) {
      fireEvent.click(libraryItem);
    }

    // Check that the details section is now visible
    expect(screen.getByText('Version: 1.0.0')).toBeInTheDocument();
  });
});
