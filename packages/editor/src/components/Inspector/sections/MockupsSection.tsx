/**
 * MockupsSection — inspector controls for a selected mockup frame.
 *
 * Surface: template identity + licence, binding status per surface (live /
 * snapshot / missing), fit and alignment controls, and lifecycle actions
 * (detach, remove, reveal in library). Geometry overrides (quad corners,
 * slot rect) are editable via the canvas overlay; numeric fields land in a
 * follow-up milestone.
 */

import {
  clearMockup,
  type FrameNode,
  getMockupTemplate,
  isMockupFrame,
  type MockupInstanceData,
  setMockupBinding,
  setMockupSurfaceOverride,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { requestMockupsTab } from '../../../mockup/mockupTabStore';
import './MockupsSection.css';

const FIT_LABELS: Record<string, string> = {
  contain: 'Contain',
  cover: 'Cover',
  stretch: 'Stretch',
  native: 'Native',
};

export function MockupsSection({ node }: { node: FrameNode }): React.ReactElement | null {
  const editor = useEditor();
  const mockup = node.mockup as MockupInstanceData | undefined;
  const [localFit, setLocalFit] = useState<string | null>(null);

  const template = useMemo(
    () => (mockup ? getMockupTemplate(editor.state.document, mockup.templateId) : undefined),
    [editor.state.document, mockup],
  );

  useEffect(() => {
    setLocalFit(null);
  }, [node.id]);

  if (!mockup) return null;

  const surfaceEntries = template?.surfaces ?? [];
  const firstSurface = surfaceEntries[0];

  const currentFit =
    localFit ??
    (firstSurface ? (mockup.overrides?.[firstSurface.id]?.fit ?? firstSurface.fit) : undefined);

  const updateFit = (fit: string): void => {
    setLocalFit(fit);
    if (firstSurface) {
      editor.updateDoc((doc) =>
        setMockupSurfaceOverride(doc, node.id, firstSurface.id, { fit: fit as never }),
      );
    }
  };

  const replaceSource = (surfaceId: string): void => {
    const selection = editor.state.selection;
    const sourceId = selection.find((id) => id !== node.id);
    if (!sourceId) return;
    editor.updateDoc((doc) =>
      setMockupBinding(doc, node.id, surfaceId, { mode: 'live', nodeId: sourceId }),
    );
  };

  const revealInLibrary = (): void => {
    requestMockupsTab();
    if (!editor.state.libraryPanelVisible) {
      editor.toggleLibraryPanel();
    }
  };

  const removeMockup = (): void => {
    editor.updateDoc((doc) => clearMockup(doc, node.id));
  };

  const missingSources = surfaceEntries.filter((surface) => {
    const binding = mockup.surfaceBindings[surface.id];
    if (!binding) return true;
    if (binding.mode === 'live' && binding.nodeId && !editor.state.document.nodes[binding.nodeId]) {
      return true;
    }
    return false;
  });

  return (
    <div className="mockups-section">
      {missingSources.length > 0 && (
        <p className="mockups-section__warning" role="alert">
          {missingSources.length} surface{missingSources.length === 1 ? '' : 's'} lost its source
          (deleted node). Select another node and press Replace.
        </p>
      )}

      <div className="mockups-section__row">
        <span className="mockups-section__label">Template</span>
        <span className="mockups-section__value">{template?.name ?? 'Missing template'}</span>
      </div>

      {template?.licence && (
        <div className="mockups-section__row">
          <span className="mockups-section__label">Licence</span>
          <span
            className="mockups-section__value"
            title={`${template.licence.creator} — ${template.licence.attribution ?? ''}`}
          >
            {template.licence.spdx ?? template.licence.title}
          </span>
        </div>
      )}

      {firstSurface && (
        <div className="mockups-section__row">
          <span className="mockups-section__label">Fit</span>
          <fieldset className="mockups-section__fits">
            <legend className="visually-hidden">Fit mode</legend>
            {Object.entries(FIT_LABELS).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={`mockups-section__fit ${currentFit === id ? 'mockups-section__fit--active' : ''}`}
                aria-pressed={currentFit === id}
                onClick={() => updateFit(id)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
      )}

      {surfaceEntries.map((surface) => {
        const binding = mockup.surfaceBindings[surface.id];
        const isMissing =
          !binding ||
          (binding.mode === 'live' &&
            binding.nodeId &&
            !editor.state.document.nodes[binding.nodeId]);
        return (
          <div className="mockups-section__row" key={surface.id}>
            <span className="mockups-section__label">{surface.name}</span>
            <span className="mockups-section__value">
              {isMissing ? (
                <span className="mockups-section__missing">Missing source</span>
              ) : binding?.mode === 'live' ? (
                'Linked to node'
              ) : (
                'Embedded snapshot'
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => replaceSource(surface.id)}>
              Replace
            </Button>
          </div>
        );
      })}

      <div className="mockups-section__actions">
        <Button size="sm" variant="ghost" onClick={revealInLibrary}>
          Reveal in library
        </Button>
        <Button size="sm" variant="ghost" onClick={removeMockup}>
          Remove mockup
        </Button>
      </div>

      <p className="mockups-section__note">
        Editing the linked source updates this mockup automatically. Move the mockup frame on the
        canvas; corner handles are available for perspective surfaces.
      </p>
    </div>
  );
}

/** True when the selected single node is a mockup frame. */
export function isMockupSelection(node: unknown): node is FrameNode {
  return isMockupFrame(node);
}
