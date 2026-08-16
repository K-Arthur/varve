/**
 * ResourcesPanel — tabbed resources surface: Libraries and Icons.
 *
 * Replaces the standalone Library panel as the primary discovery surface
 * for reusable content. Both tabs stay mounted (CSS-hidden when inactive)
 * so icon search state survives tab switches while the panel is open.
 */

import type { Document, Library } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { getMockupsTabRequest, subscribeMockupsTab } from '../../mockup/mockupTabStore';
import { AIPanel } from '../AIPanel';
import { IconBrowser } from '../IconBrowser/IconBrowser';
import { IconBrowserDialog } from '../IconBrowser/IconBrowserDialog';
import { LibraryPanel } from '../LibraryPanel/LibraryPanel';
import { MockupsPanel } from '../Mockups/MockupsPanel';
import { PanelDragHandle } from '../PanelDragHandle';
import { PanelWidthDragEdge } from './PanelWidthDragEdge';
import './ResourcesPanel.css';

/** Re-exported so Shell mounts the quick-insert dialog without a new import. */
export { IconBrowserDialog };

export interface ResourcesPanelProps {
  doc: Document;
  onInstallLibrary: (library: Library) => void;
  onUninstallLibrary: (libraryId: string) => void;
}

type ResourcesTab = 'libraries' | 'icons' | 'mockups' | 'assistant';

/** Tab order must match the rendered order for Arrow/Home/End navigation. */
const TAB_ORDER: readonly ResourcesTab[] = ['icons', 'libraries', 'mockups', 'assistant'];

export function ResourcesPanel({ doc, onInstallLibrary, onUninstallLibrary }: ResourcesPanelProps) {
  const [activeTab, setActiveTab] = useState<ResourcesTab>('icons');
  const editor = useEditor();
  const baseId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);

  const tabId = (tab: ResourcesTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: ResourcesTab) => `${baseId}-panel-${tab}`;

  // APG Tabs: roving tabindex + Arrow/Home/End. Previously every tab stayed in
  // the Tab sequence with no arrow support, so the widget announced itself as
  // a tablist but behaved like a row of plain buttons.
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const current = TAB_ORDER.indexOf(activeTab);
      let next = current;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (current + 1) % TAB_ORDER.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = TAB_ORDER.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const nextTab = TAB_ORDER[next];
      if (!nextTab) return;
      setActiveTab(nextTab);
      tablistRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(nextTab))}`)?.focus();
    },
    [activeTab, baseId],
  );

  // Mockups tab requests from context menu / command palette switch here.
  // A request may land before this panel mounts (the request opens the
  // panel), so replay the current request on mount as well.
  useEffect(() => {
    if (getMockupsTabRequest()) setActiveTab('mockups');
    return subscribeMockupsTab(() => setActiveTab('mockups'));
  }, []);

  return (
    <section className="resources-panel" aria-label="Resources">
      <PanelWidthDragEdge />
      <PanelDragHandle
        panelTypeId="library"
        panelInstanceId="library-primary"
        currentWindowId="main"
        title="Assets"
      >
        <div
          className="resources-panel__tabs"
          role="tablist"
          aria-label="Resources"
          ref={tablistRef}
          onKeyDown={handleTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            id={tabId('icons')}
            aria-selected={activeTab === 'icons'}
            aria-controls={panelId('icons')}
            tabIndex={activeTab === 'icons' ? 0 : -1}
            className={`resources-panel__tab ${activeTab === 'icons' ? 'resources-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('icons')}
          >
            <Icon name="Shapes" size={14} />
            Icons
          </button>
          <button
            type="button"
            role="tab"
            id={tabId('libraries')}
            aria-selected={activeTab === 'libraries'}
            aria-controls={panelId('libraries')}
            tabIndex={activeTab === 'libraries' ? 0 : -1}
            className={`resources-panel__tab ${activeTab === 'libraries' ? 'resources-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('libraries')}
          >
            <Icon name="Library" size={14} />
            Libraries
          </button>
          <button
            type="button"
            role="tab"
            id={tabId('mockups')}
            aria-selected={activeTab === 'mockups'}
            aria-controls={panelId('mockups')}
            tabIndex={activeTab === 'mockups' ? 0 : -1}
            className={`resources-panel__tab ${activeTab === 'mockups' ? 'resources-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('mockups')}
          >
            <Icon name="Smartphone" size={14} />
            Mockups
          </button>
          <button
            type="button"
            role="tab"
            id={tabId('assistant')}
            aria-selected={activeTab === 'assistant'}
            aria-controls={panelId('assistant')}
            tabIndex={activeTab === 'assistant' ? 0 : -1}
            className={`resources-panel__tab ${activeTab === 'assistant' ? 'resources-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('assistant')}
          >
            <Icon name="Bot" size={14} />
            Assistant
          </button>
        </div>
      </PanelDragHandle>

      <div
        className={`resources-panel__pane ${activeTab === 'icons' ? '' : 'resources-panel__pane--hidden'}`}
        role="tabpanel"
        id={panelId('icons')}
        aria-labelledby={tabId('icons')}
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
        id={panelId('libraries')}
        aria-labelledby={tabId('libraries')}
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
        id={panelId('mockups')}
        aria-labelledby={tabId('mockups')}
      >
        <MockupsPanel />
      </div>
      <div
        className={`resources-panel__pane ${activeTab === 'assistant' ? '' : 'resources-panel__pane--hidden'}`}
        role="tabpanel"
        id={panelId('assistant')}
        aria-labelledby={tabId('assistant')}
      >
        <AIPanel />
      </div>
    </section>
  );
}
