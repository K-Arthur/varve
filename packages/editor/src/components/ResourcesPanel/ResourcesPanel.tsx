/**
 * ResourcesPanel — tabbed resources surface: Libraries and Icons.
 *
 * Replaces the standalone Library panel as the primary discovery surface
 * for reusable content. Both tabs stay mounted (CSS-hidden when inactive)
 * so icon search state survives tab switches while the panel is open.
 */

import type { Document, Library } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useState } from 'react';
import { useEditor } from '../../context';
import { LibraryPanel } from '../LibraryPanel/LibraryPanel';
import './ResourcesPanel.css';

/** Re-exported so Shell mounts the quick-insert dialog without a new import. */
export { IconBrowserDialog };

export interface ResourcesPanelProps {
  doc: Document;
  onInstallLibrary: (library: Library) => void;
  onUninstallLibrary: (libraryId: string) => void;
  onInsertIcon?: (payload: IconInsertPayload) => void;
}

type ResourcesTab = 'libraries' | 'icons';

export function ResourcesPanel({ doc, onInstallLibrary, onUninstallLibrary }: ResourcesPanelProps) {
  const [activeTab, setActiveTab] = useState<ResourcesTab>('icons');
  const editor = useEditor();

  return (
    <section className="resources-panel" aria-label="Resources">
      <div className="resources-panel__tabs" role="tablist" aria-label="Resources">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'icons'}
          className={`resources-panel__tab ${activeTab === 'icons' ? 'resources-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('icons')}
        >
          <Icon name="Shapes" size={14} />
          Icons
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'libraries'}
          className={`resources-panel__tab ${activeTab === 'libraries' ? 'resources-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('libraries')}
        >
          <Icon name="Library" size={14} />
          Libraries
        </button>
      </div>

      <div
        className={`resources-panel__pane ${activeTab === 'icons' ? '' : 'resources-panel__pane--hidden'}`}
        role="tabpanel"
        aria-label="Icons"
      >
        <IconBrowser
          onInsert={(payload) => {
            void editor?.insertIconAsset({
              name: payload.name,
              providerId: payload.providerId,
              prefix: payload.prefix,
              svg: payload.svg,
              licence: payload.licence,
              spdxId: payload.spdxId,
              licenceUrl: payload.licenceUrl,
              attributionText: payload.attributionText,
              author: payload.author,
              sourceUrl: payload.sourceUrl,
              sourceVersion: payload.sourceVersion,
              paletteType: payload.paletteType,
            });
          }}
        />
      </div>
      <div
        className={`resources-panel__pane ${activeTab === 'libraries' ? '' : 'resources-panel__pane--hidden'}`}
        role="tabpanel"
        aria-label="Libraries"
      >
        <LibraryPanel
          doc={doc}
          onInstallLibrary={onInstallLibrary}
          onUninstallLibrary={onUninstallLibrary}
        />
      </div>
    </section>
  );
}
