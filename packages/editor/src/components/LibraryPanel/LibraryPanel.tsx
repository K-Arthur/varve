/**
 * LibraryPanel — browse, install, and update library components.
 *
 * Provides UI for managing installed libraries, checking for updates,
 * and installing new libraries from JSON (clipboard or file).
 *
 * Research basis: Figma Team Libraries, Penpot shared libraries.
 */

import type { Document, Library } from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useId, useRef, useState } from 'react';
import './LibraryPanel.css';

export interface LibraryPanelProps {
  doc: Document;
  onInstallLibrary: (library: Library) => void;
  onUninstallLibrary: (libraryId: string) => void;
}

export function LibraryPanel({ doc, onInstallLibrary, onUninstallLibrary }: LibraryPanelProps) {
  const installedLibraries = doc.installedLibraries ?? [];
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const detailsId = useId();
  const importFileButtonRef = useRef<HTMLButtonElement>(null);

  const selectedLibrary = installedLibraries.find((lib) => lib.id === selectedLibraryId);

  const handleInstallFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pkg = JSON.parse(text) as { library: Library };
      if (pkg.library) {
        onInstallLibrary(pkg.library);
      }
    } catch (err) {
      console.error('Failed to install from clipboard:', err);
    }
  }, [onInstallLibrary]);

  const handleInstallFromFile = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const pkg = JSON.parse(text) as { library: Library };
      if (pkg.library) {
        onInstallLibrary(pkg.library);
      }
    };
    input.click();
  }, [onInstallLibrary]);

  return (
    <section className="library-panel" aria-label="Library manager">
      <div className="library-panel__header">
        <h2 className="library-panel__title">Library</h2>
        <div className="library-panel__actions">
          <Button variant="ghost" size="sm" onClick={handleInstallFromClipboard}>
            Paste from Clipboard
          </Button>
          <Button
            ref={importFileButtonRef}
            variant="ghost"
            size="sm"
            onClick={handleInstallFromFile}
          >
            Import File
          </Button>
        </div>
      </div>

      {installedLibraries.length === 0 ? (
        <div className="library-panel__empty">
          <p className="library-panel__empty-title">No libraries installed</p>
          <p className="library-panel__empty-desc">
            Import a library from clipboard or file to get started.
          </p>
        </div>
      ) : (
        <div className="library-panel__list">
          {installedLibraries.map((lib) => (
            <div
              key={lib.id}
              className={`library-panel__item ${selectedLibraryId === lib.id ? 'library-panel__item--selected' : ''}`}
            >
              <button
                type="button"
                className="library-panel__item-select"
                aria-label={`View ${lib.name} details`}
                aria-expanded={selectedLibraryId === lib.id}
                aria-controls={selectedLibraryId === lib.id ? detailsId : undefined}
                onClick={() => setSelectedLibraryId(lib.id)}
              >
                <span className="library-panel__item-info">
                  <span className="library-panel__item-name">{lib.name}</span>
                  <span className="library-panel__item-version">v{lib.version}</span>
                </span>
              </button>
              <span className="library-panel__item-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Uninstall ${lib.name}`}
                  onClick={(event) => {
                    const row = event.currentTarget.closest('.library-panel__item');
                    if (row?.contains(document.activeElement)) {
                      const next = row.nextElementSibling?.querySelector<HTMLButtonElement>(
                        '.library-panel__item-select',
                      );
                      const previous = row.previousElementSibling?.querySelector<HTMLButtonElement>(
                        '.library-panel__item-select',
                      );
                      (next ?? previous ?? importFileButtonRef.current)?.focus();
                    }
                    onUninstallLibrary(lib.id);
                  }}
                >
                  Uninstall
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {selectedLibrary && (
        <div className="library-panel__details" id={detailsId}>
          <h3 className="library-panel__details-title">{selectedLibrary.name}</h3>
          <p className="library-panel__details-version">Version: {selectedLibrary.version}</p>
          <p className="library-panel__details-installed">
            Installed: {new Date(selectedLibrary.installedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </section>
  );
}
