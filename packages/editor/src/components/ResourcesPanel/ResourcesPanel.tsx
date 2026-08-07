/**
 * ResourcesPanel — tabbed resources surface: Libraries and Icons.
 *
 * Replaces the standalone Library panel as the primary discovery surface
 * for reusable content. Both tabs stay mounted (CSS-hidden when inactive)
 * so icon search state survives tab switches while the panel is open.
 */

import type { Document, Library } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { getMockupsTabRequest, subscribeMockupsTab } from '../../mockup/mockupTabStore';
import { IconBrowser } from '../IconBrowser/IconBrowser';
import { IconBrowserDialog } from '../IconBrowser/IconBrowserDialog';
import { LibraryPanel } from '../LibraryPanel/LibraryPanel';
import { MockupsPanel } from '../Mockups/MockupsPanel';
import { PanelDragHandle } from '../PanelDragHandle';
import './ResourcesPanel.css';

/** Re-exported so Shell mounts the quick-insert dialog without a new import. */
export { IconBrowserDialog };

export interface ResourcesPanelProps {
  doc: Document;
  onInstallLibrary: (library: Library) => void;
  onUninstallLibrary: (libraryId: string) => void;
}

type ResourcesTab = 'libraries' | 'icons' | 'mockups';

export function ResourcesPanel({ doc, onInstallLibrary, onUninstallLibrary }: ResourcesPanelProps) {
  const [activeTab, setActiveTab] = useState<ResourcesTab>('icons');
  const editor = useEditor();

  // Mockups tab requests from context menu / command palette switch here.
  // A request may land before this panel mounts (the request opens the
  // panel), so replay the current request on mount as well.
  useEffect(() => {
    if (getMockupsTabRequest()) setActiveTab('mockups');
    return subscribeMockupsTab(() => setActiveTab('mockups'));
  }, []);

  return (
    <section className="resources-panel" aria-label="Resources">
      <PanelDragHandle
        panelTypeId="library"
        panelInstanceId="library-primary"
        currentWindowId="main"
        title="Assets"
      >
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
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mockups'}
            className={`resources-panel__tab ${activeTab === 'mockups' ? 'resources-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('mockups')}
          >
            <Icon name="Smartphone" size={14} />
            Mockups
          </button>
        </div>
      </PanelDragHandle>

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
      <div
        className={`resources-panel__pane ${activeTab === 'mockups' ? '' : 'resources-panel__pane--hidden'}`}
        role="tabpanel"
        aria-label="Mockups"
      >
        <MockupsPanel />
      </div>
    </section>
  );
}
