/**
 * MockupsSection — inspector controls for a selected mockup frame.
 *
 * Two levels of editing, kept visually distinct:
 * - Instance: template identity/licence, template replacement (slot-identity
 *   remap with explicit unbound reporting), duplicate linked/independent,
 *   flatten to image, remove.
 * - Surface: choose an edit target, replace/reconnect/snapshot/clear its
 *   source, and tune placement (fit, alignment, rotation, flips), appearance
 *   (shadow, glow) and geometry (rect or quad, numerically or on canvas).
 *
 * All mutations go through editor transactions; snapshots and flattening are
 * the only asynchronous actions and report failures inline.
 */

import {
  canBindMockupSource,
  clearMockup,
  clearMockupBinding,
  type Document,
  type FrameNode,
  getMockupTemplate,
  isMockupFrame,
  type MockupInstanceData,
  type MockupSurfaceDefinition,
  type MockupTemplateAsset,
  planMockupTemplateRemap,
  replaceMockupSurfaceOverride,
  setMockupBinding,
  setMockupSurfaceOverride,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import {
  addTemplateSurfaceFromSelection,
  applyMockupTemplateToInstance,
  assignSurfaceMaskFromSelection,
  clearSurfaceMask,
  duplicateTemplateSurface,
  moveTemplateSurface,
  removeTemplateSurface,
  renameTemplateSurface,
  resetSurfaceMaskOptions,
  setSurfaceMaskOptions,
  templatesForDocument,
} from '../../../mockup/mockupActions';
import {
  duplicateMockupInstance,
  flattenMockupToImage,
  reconnectMockupSurface,
  snapshotMockupSurface,
} from '../../../mockup/mockupCapture';
import {
  clearMockupSurfaceSelection,
  selectMockupSurface,
  subscribeMockupSurfaceSelection,
} from '../../../mockup/mockupSurfaceSelection';
import { requestMockupsTab } from '../../../mockup/mockupTabStore';
import { DisclosureSection } from '../controls/DisclosureSection';
import type { SectionId } from '../sectionRegistry';
import { MockupVariantsPanel } from './MockupVariantsPanel';
import './MockupsSection.css';

const FIT_LABELS: Record<string, string> = {
  contain: 'Contain',
  cover: 'Cover',
  stretch: 'Stretch',
  native: 'Native',
};

const ALIGN_X: Array<'min' | 'center' | 'max'> = ['min', 'center', 'max'];
const ALIGN_Y: Array<'min' | 'center' | 'max'> = ['min', 'center', 'max'];

type BusyAction = 'snapshot' | 'duplicate-linked' | 'duplicate-independent' | 'flatten' | null;

export function MockupsSection({
  node,
  sectionId,
}: {
  node: FrameNode;
  sectionId?: SectionId;
}): React.ReactElement | null {
  const editor = useEditor();
  const mockup = node.mockup as MockupInstanceData | undefined;
  const doc = editor.state.document;
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSurfaceId(null);
    setPickerOpen(false);
    setVariantsOpen(false);
    setStatus(null);
  }, [node.id]);

  useEffect(
    () =>
      subscribeMockupSurfaceSelection((selection) => {
        setSelectedSurfaceId(selection?.frameId === node.id ? selection.surfaceId : null);
      }),
    [node.id],
  );

  const template = useMemo(
    () => (mockup ? getMockupTemplate(doc, mockup.templateId) : undefined),
    [doc, mockup],
  );

  if (!mockup) return null;

  const surfaceEntries = template?.surfaces ?? [];

  const selectSurface = (surfaceId: string): void => {
    setStatus(null);
    if (selectedSurfaceId === surfaceId) {
      setSelectedSurfaceId(null);
      clearMockupSurfaceSelection();
      return;
    }
    setSelectedSurfaceId(surfaceId);
    selectMockupSurface({ frameId: node.id, surfaceId });
  };

  const replaceSource = (surfaceId: string): void => {
    const sourceId = editor.state.selection.find((id) => id !== node.id);
    if (!sourceId) return;
    if (!canBindMockupSource(doc, node.id, sourceId).ok) {
      setStatus(
        'That source cannot be linked here (a mockup cannot contain itself or an ancestor).',
      );
      return;
    }
    editor.beginTransaction();
    try {
      editor.updateDoc((current) =>
        setMockupBinding(current, node.id, surfaceId, { mode: 'live', nodeId: sourceId }),
      );
    } finally {
      editor.commitTransaction();
    }
  };

  const clearSource = (surfaceId: string): void => {
    editor.beginTransaction();
    try {
      editor.updateDoc((current) => clearMockupBinding(current, node.id, surfaceId));
    } finally {
      editor.commitTransaction();
    }
  };

  const editSource = (surfaceId: string): void => {
    const binding = mockup.surfaceBindings[surfaceId];
    if (binding?.mode !== 'live' || !binding.nodeId) return;
    if (!doc.nodes[binding.nodeId]) return;
    editor.setSelection(binding.nodeId);
  };

  const runBusy = async (
    action: BusyAction,
    task: () => Promise<boolean | null>,
  ): Promise<void> => {
    setBusy(action);
    setStatus(null);
    try {
      const ok = await task();
      if (ok === false || ok === null) setStatus('Action could not complete for this surface.');
    } finally {
      setBusy(null);
    }
  };

  const removeMockup = (): void => {
    editor.beginTransaction();
    try {
      editor.updateDoc((current) => clearMockup(current, node.id));
    } finally {
      editor.commitTransaction();
    }
  };

  const revealInLibrary = (): void => {
    requestMockupsTab();
    if (!editor.state.libraryPanelVisible) editor.toggleLibraryPanel();
  };

  return (
    <DisclosureSection title="Mockup" sectionId={sectionId ?? 'mockups'}>
      <div className="mockups-section">
        {status && (
          <p className="mockups-section__status" role="status">
            {status}
          </p>
        )}

        <div className="mockups-section__row">
          <span className="mockups-section__label">Template</span>
          <span className="mockups-section__value">
            {template?.name ?? 'Missing template'}
            {template?.library ? ' · library' : ''}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPickerOpen((open) => !open)}>
            Replace
          </Button>
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

        {template && (
          <div className="mockups-section__actions mockups-section__actions--authoring">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null || !editor.state.selection.some((id) => id !== node.id)}
              onClick={() => {
                if (!addTemplateSurfaceFromSelection(editor, node.id)) {
                  setStatus(
                    'Select a separate frame, group, image, or vector node to add as a surface.',
                  );
                }
              }}
              title="Adds a new flat surface from the selected node and links that node as its artwork"
            >
              Add surface from selection
            </Button>
          </div>
        )}

        {pickerOpen && (
          <TemplatePicker
            doc={doc}
            frameId={node.id}
            currentTemplateId={mockup.templateId}
            onClose={() => setPickerOpen(false)}
            onStatus={setStatus}
          />
        )}

        <ul className="mockups-section__surfaces">
          {surfaceEntries.map((surface) => {
            const binding = mockup.surfaceBindings[surface.id];
            const isMissing =
              !binding ||
              (binding.mode === 'live' && !!binding.nodeId && !doc.nodes[binding.nodeId]) ||
              (binding.mode === 'snapshot' && !!binding.assetId && !doc.assets?.[binding.assetId]);
            const isSelected = surface.id === selectedSurfaceId;
            const sourceName =
              binding?.mode === 'live' && binding.nodeId
                ? (doc.nodes[binding.nodeId]?.name ?? 'Missing source')
                : binding?.mode === 'snapshot'
                  ? isMissing
                    ? 'Missing snapshot'
                    : 'Embedded snapshot'
                  : 'No source';
            return (
              <li
                key={surface.id}
                className={`mockups-section__surface ${isSelected ? 'mockups-section__surface--active' : ''}`}
              >
                <button
                  type="button"
                  className="mockups-section__surface-header"
                  aria-expanded={isSelected}
                  onClick={() => selectSurface(surface.id)}
                >
                  <span className="mockups-section__surface-name">{surface.name}</span>
                  <span
                    className={`mockups-section__source ${isMissing ? 'mockups-section__missing' : ''}`}
                  >
                    {isMissing ? 'Missing source' : sourceName}
                  </span>
                </button>
                {isSelected && (
                  <SurfaceEditor
                    doc={doc}
                    frameId={node.id}
                    surface={surface}
                    mockup={mockup}
                    busy={busy}
                    canReplace={editor.state.selection.some((id) => id !== node.id)}
                    onReplace={() => replaceSource(surface.id)}
                    onClear={() => clearSource(surface.id)}
                    onEditSource={() => editSource(surface.id)}
                    onSnapshot={() =>
                      runBusy('snapshot', () => snapshotMockupSurface(editor, node.id, surface.id))
                    }
                    onReconnect={() => reconnectMockupSurface(editor, node.id, surface.id)}
                    onDuplicate={() => duplicateTemplateSurface(editor, node.id, surface.id)}
                    onSelectSurface={() =>
                      selectMockupSurface({ frameId: node.id, surfaceId: surface.id })
                    }
                    onStatus={setStatus}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <div className="mockups-section__actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setVariantsOpen((open) => !open)}
          >
            Export variants…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              runBusy('duplicate-linked', () =>
                duplicateMockupInstance(editor, node.id, 'linked').then((id) => id !== null),
              )
            }
          >
            Duplicate linked
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            title="Captures each bound source into an embedded snapshot so edits no longer propagate"
            onClick={() =>
              runBusy('duplicate-independent', () =>
                duplicateMockupInstance(editor, node.id, 'independent').then((id) => id !== null),
              )
            }
          >
            Duplicate independent
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            title="Rasterizes the whole mockup into one image node; vector editability is lost"
            onClick={() => runBusy('flatten', () => flattenMockupToImage(editor, node.id))}
          >
            Flatten to image
          </Button>
        </div>

        {variantsOpen && (
          <MockupVariantsPanel frameId={node.id} onClose={() => setVariantsOpen(false)} />
        )}

        <div className="mockups-section__actions">
          <Button size="sm" variant="ghost" onClick={revealInLibrary}>
            Reveal in library
          </Button>
          <Button size="sm" variant="ghost" onClick={removeMockup}>
            Remove mockup
          </Button>
        </div>

        <p className="mockups-section__note">
          Select a surface above to replace its artwork, tune placement, or jump to its outline on
          the canvas. Replace and mask actions use the current selection besides this mockup: select
          the artwork node (Shift-click to keep this mockup selected) and press Replace. Editing a
          linked source updates every surface bound to it.
        </p>
      </div>
    </DisclosureSection>
  );
}

interface SurfaceEditorProps {
  doc: Document;
  frameId: string;
  surface: MockupSurfaceDefinition;
  mockup: MockupInstanceData;
  busy: BusyAction;
  canReplace: boolean;
  onReplace: () => void;
  onClear: () => void;
  onEditSource: () => void;
  onSnapshot: () => void;
  onReconnect: () => boolean;
  onDuplicate: () => boolean;
  onSelectSurface: () => void;
  onStatus: (message: string | null) => void;
}

function SurfaceEditor({
  doc,
  frameId,
  surface,
  mockup,
  busy,
  canReplace,
  onReplace,
  onClear,
  onEditSource,
  onSnapshot,
  onReconnect,
  onDuplicate,
  onSelectSurface,
  onStatus,
}: SurfaceEditorProps): React.ReactElement {
  const editor = useEditor();
  const [nameDraft, setNameDraft] = useState(surface.name);
  const [maskBusy, setMaskBusy] = useState(false);
  useEffect(() => setNameDraft(surface.name), [surface.name]);
  const override = mockup.overrides?.[surface.id];
  const fit = override?.fit ?? surface.fit;
  const alignment = override?.alignment ?? surface.alignment;
  const cylindrical = override?.cylindrical ?? surface.cylindrical;
  const rotation = override?.rotation ?? 0;
  const flipH = override?.flipH ?? false;
  const flipV = override?.flipV ?? false;
  const shadowEnabled =
    override?.shadow === null ? false : (override?.shadow ?? surface.shadow) !== undefined;
  const glow = override?.screenGlow ?? surface.screenGlow ?? false;
  const binding = mockup.surfaceBindings[surface.id];
  const isSnapshot = binding?.mode === 'snapshot';
  const isMissing =
    !binding ||
    (binding?.mode === 'live' && !!binding.nodeId && !doc.nodes[binding.nodeId]) ||
    (binding?.mode === 'snapshot' && !!binding.assetId && !doc.assets?.[binding.assetId]);

  const patch = useCallback(
    (overridePatch: Parameters<typeof setMockupSurfaceOverride>[3]) => {
      editor.beginTransaction();
      try {
        editor.updateDoc((current) =>
          setMockupSurfaceOverride(current, frameId, surface.id, overridePatch),
        );
      } finally {
        editor.commitTransaction();
      }
    },
    [editor, frameId, surface.id],
  );

  const setGeometry = useCallback(
    (key: 'x' | 'y' | 'width' | 'height', value: number) => patch({ [key]: value }),
    [patch],
  );

  const reset = useCallback(() => {
    editor.beginTransaction();
    try {
      editor.updateDoc((current) =>
        replaceMockupSurfaceOverride(current, frameId, surface.id, null),
      );
    } finally {
      editor.commitTransaction();
    }
  }, [editor, frameId, surface.id]);

  const assignMask = useCallback(
    (kind: 'clip' | 'occlusion') => {
      setMaskBusy(true);
      void assignSurfaceMaskFromSelection(editor, frameId, surface.id, kind)
        .then((ok) => {
          if (!ok)
            onStatus('Mask capture could not complete; check the selected source and geometry.');
        })
        .finally(() => setMaskBusy(false));
    },
    [editor, frameId, onStatus, surface.id],
  );

  return (
    <div className="mockups-section__editor">
      <div className="mockups-section__source-actions">
        <Button size="sm" variant="ghost" disabled={!canReplace} onClick={onReplace}>
          Replace
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={binding?.mode !== 'live' || isMissing}
          onClick={onEditSource}
        >
          Edit source
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null || isSnapshot || isMissing}
          onClick={onSnapshot}
        >
          Snapshot
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!isSnapshot && !isMissing}
          onClick={() => {
            if (!onReconnect()) onStatus('Select a node to reconnect this surface.');
          }}
        >
          Reconnect
        </Button>
        <Button size="sm" variant="ghost" disabled={!binding} onClick={onClear}>
          Clear
        </Button>
        <Button size="sm" variant="ghost" onClick={onSelectSurface}>
          Canvas
        </Button>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Surface</span>
        <input
          className="mockups-section__name-input"
          aria-label={`Rename surface ${surface.name}`}
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => {
            const trimmed = nameDraft.trim();
            if (trimmed && trimmed !== surface.name) {
              renameTemplateSurface(editor, frameId, surface.id, trimmed);
            } else {
              setNameDraft(surface.name);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setNameDraft(surface.name);
          }}
        />
        <div className="mockups-section__inline">
          <button
            type="button"
            className="mockups-section__fit"
            aria-label="Move surface earlier"
            onClick={() => moveTemplateSurface(editor, frameId, surface.id, -1)}
          >
            Up
          </button>
          <button
            type="button"
            className="mockups-section__fit"
            aria-label="Move surface later"
            onClick={() => moveTemplateSurface(editor, frameId, surface.id, 1)}
          >
            Down
          </button>
          <button
            type="button"
            className="mockups-section__fit"
            aria-label={`Remove surface ${surface.name}`}
            disabled={templateSurfaceCount(doc, frameId) <= 1}
            onClick={() => removeTemplateSurface(editor, frameId, surface.id)}
          >
            Remove
          </button>
          <button
            type="button"
            className="mockups-section__fit"
            aria-label={`Duplicate surface ${surface.name}`}
            onClick={() => onDuplicate()}
          >
            Duplicate
          </button>
        </div>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Masks</span>
        <div className="mockups-section__inline">
          <button
            type="button"
            className={`mockups-section__fit ${surface.clipMaskAssetId ? 'mockups-section__fit--active' : ''}`}
            disabled={!canReplace || busy !== null || maskBusy}
            title="Clip artwork to the selected node's alpha coverage"
            onClick={() => assignMask('clip')}
          >
            Clip from selection
          </button>
          {surface.clipMaskAssetId && (
            <>
              <button
                type="button"
                className="mockups-section__fit"
                onClick={() => clearSurfaceMask(editor, frameId, surface.id, 'clip')}
              >
                Clear clip
              </button>
              <button
                type="button"
                className={`mockups-section__fit ${
                  (surface.clipMaskOptions ?? surface.maskOptions)?.invert
                    ? 'mockups-section__fit--active'
                    : ''
                }`}
                aria-pressed={(surface.clipMaskOptions ?? surface.maskOptions)?.invert === true}
                onClick={() =>
                  setSurfaceMaskOptions(editor, frameId, surface.id, 'clip', {
                    invert: !((surface.clipMaskOptions ?? surface.maskOptions)?.invert === true),
                  })
                }
              >
                Invert clip
              </button>
              <NumberField
                label="Clip feather"
                value={(surface.clipMaskOptions ?? surface.maskOptions)?.feather ?? 0}
                unit="px"
                onCommit={(value) =>
                  setSurfaceMaskOptions(editor, frameId, surface.id, 'clip', { feather: value })
                }
              />
              <button
                type="button"
                className="mockups-section__fit"
                onClick={() => resetSurfaceMaskOptions(editor, frameId, surface.id, 'clip')}
              >
                Reset clip
              </button>
            </>
          )}
          <button
            type="button"
            className={`mockups-section__fit ${surface.occlusionMaskAssetId ? 'mockups-section__fit--active' : ''}`}
            disabled={!canReplace || busy !== null || maskBusy}
            title="Reveal the base plate over artwork where the selected node covers it"
            onClick={() => assignMask('occlusion')}
          >
            Occluder from selection
          </button>
          {surface.occlusionMaskAssetId && (
            <>
              <button
                type="button"
                className="mockups-section__fit"
                onClick={() => clearSurfaceMask(editor, frameId, surface.id, 'occlusion')}
              >
                Clear occluder
              </button>
              <button
                type="button"
                className={`mockups-section__fit ${
                  (surface.occlusionMaskOptions ?? surface.maskOptions)?.invert
                    ? 'mockups-section__fit--active'
                    : ''
                }`}
                aria-pressed={
                  (surface.occlusionMaskOptions ?? surface.maskOptions)?.invert === true
                }
                onClick={() =>
                  setSurfaceMaskOptions(editor, frameId, surface.id, 'occlusion', {
                    invert: !(
                      (surface.occlusionMaskOptions ?? surface.maskOptions)?.invert === true
                    ),
                  })
                }
              >
                Invert occluder
              </button>
              <NumberField
                label="Occluder feather"
                labelWrap
                value={(surface.occlusionMaskOptions ?? surface.maskOptions)?.feather ?? 0}
                unit="px"
                onCommit={(value) =>
                  setSurfaceMaskOptions(editor, frameId, surface.id, 'occlusion', {
                    feather: value,
                  })
                }
              />
              <button
                type="button"
                className="mockups-section__fit"
                onClick={() => resetSurfaceMaskOptions(editor, frameId, surface.id, 'occlusion')}
              >
                Reset occluder
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Fit</span>
        <fieldset className="mockups-section__fits">
          <legend className="visually-hidden">Fit mode for {surface.name}</legend>
          {Object.entries(FIT_LABELS).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={`mockups-section__fit ${fit === id ? 'mockups-section__fit--active' : ''}`}
              aria-pressed={fit === id}
              onClick={() => patch({ fit: id as never })}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Align</span>
        <fieldset className="mockups-section__align" aria-label={`Alignment for ${surface.name}`}>
          <legend className="visually-hidden">Alignment for {surface.name}</legend>
          {ALIGN_Y.map((y) =>
            ALIGN_X.map((x) => (
              <button
                type="button"
                key={`${x}-${y}`}
                className={`mockups-section__align-cell ${alignment.x === x && alignment.y === y ? 'mockups-section__align-cell--active' : ''}`}
                aria-label={`Align ${x} ${y}`}
                aria-pressed={alignment.x === x && alignment.y === y}
                onClick={() => patch({ alignment: { x, y } })}
              />
            )),
          )}
        </fieldset>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Artwork</span>
        <div className="mockups-section__inline">
          <NumberField
            label="Rotation"
            value={rotation}
            unit="°"
            onCommit={(value) => patch({ rotation: value })}
          />
          <button
            type="button"
            className={`mockups-section__fit ${flipH ? 'mockups-section__fit--active' : ''}`}
            aria-pressed={flipH}
            onClick={() => patch({ flipH: !flipH })}
          >
            Flip H
          </button>
          <button
            type="button"
            className={`mockups-section__fit ${flipV ? 'mockups-section__fit--active' : ''}`}
            aria-pressed={flipV}
            onClick={() => patch({ flipV: !flipV })}
          >
            Flip V
          </button>
        </div>
      </div>

      <div className="mockups-section__row">
        <span className="mockups-section__label">Appearance</span>
        <div className="mockups-section__inline">
          <button
            type="button"
            className={`mockups-section__fit ${shadowEnabled ? 'mockups-section__fit--active' : ''}`}
            aria-pressed={shadowEnabled}
            onClick={() =>
              patch({ shadow: shadowEnabled ? null : { blur: 24, offsetY: 12, opacity: 0.3 } })
            }
          >
            Shadow
          </button>
          <button
            type="button"
            className={`mockups-section__fit ${glow ? 'mockups-section__fit--active' : ''}`}
            aria-pressed={glow}
            onClick={() => patch({ screenGlow: !glow })}
          >
            Glow
          </button>
          <Button size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
      </div>

      {surface.kind === 'cylindrical' && cylindrical && (
        <fieldset className="mockups-section__geometry mockups-section__cylinder">
          <legend className="mockups-section__legend">Cylinder mapping</legend>
          <div className="mockups-section__row">
            <span className="mockups-section__label">Axis</span>
            <div className="mockups-section__inline">
              {(['vertical', 'horizontal'] as const).map((axis) => (
                <button
                  type="button"
                  key={axis}
                  className={`mockups-section__fit ${cylindrical.axis === axis ? 'mockups-section__fit--active' : ''}`}
                  aria-pressed={cylindrical.axis === axis}
                  onClick={() => patch({ cylindrical: { ...cylindrical, axis } })}
                >
                  {axis === 'vertical' ? 'Vertical axis' : 'Horizontal axis'}
                </button>
              ))}
            </div>
          </div>
          <div className="mockups-section__row">
            <span className="mockups-section__label">Arc</span>
            <NumberField
              label="Cylinder wrap degrees"
              hideLabel
              value={cylindrical.wrapDegrees}
              unit="°"
              onCommit={(value) =>
                patch({
                  cylindrical: {
                    ...cylindrical,
                    wrapDegrees: Math.max(5, Math.min(180, value)),
                  },
                })
              }
            />
            <NumberField
              label="Cylinder seam"
              hideLabel
              value={cylindrical.seam}
              onCommit={(value) =>
                patch({ cylindrical: { ...cylindrical, seam: Math.max(0, Math.min(1, value)) } })
              }
            />
          </div>
          <div className="mockups-section__row">
            <span className="mockups-section__label">Crop</span>
            <div className="mockups-section__inline">
              {(['slot', 'visible'] as const).map((crop) => (
                <button
                  type="button"
                  key={crop}
                  className={`mockups-section__fit ${cylindrical.crop === crop ? 'mockups-section__fit--active' : ''}`}
                  aria-pressed={cylindrical.crop === crop}
                  onClick={() => patch({ cylindrical: { ...cylindrical, crop } })}
                >
                  {crop === 'slot' ? 'Fit arc to slot' : 'Natural arc bounds'}
                </button>
              ))}
            </div>
          </div>
          <p className="mockups-section__note">
            Front-facing orthographic arc only; no inferred backside, camera perspective, or 3D
            lighting.
          </p>
        </fieldset>
      )}

      {surface.kind === 'quad' && (override?.quad ?? surface.quad) ? (
        <fieldset className="mockups-section__geometry">
          <legend className="mockups-section__legend">Surface corners (template px)</legend>
          {(override?.quad ?? surface.quad)!.map((point, index) => (
            <div
              className="mockups-section__corner"
              key={['top-left', 'top-right', 'bottom-right', 'bottom-left'][index]}
            >
              <span className="mockups-section__corner-label">
                {['TL', 'TR', 'BR', 'BL'][index]}
              </span>
              <NumberField
                label={`Corner ${index + 1} X`}
                value={point.x}
                onCommit={(value) => {
                  const quad = (override?.quad ?? surface.quad)!.map((p, i) =>
                    i === index ? { ...p, x: value } : p,
                  );
                  patch({ quad: quad as never });
                }}
              />
              <NumberField
                label={`Corner ${index + 1} Y`}
                value={point.y}
                onCommit={(value) => {
                  const quad = (override?.quad ?? surface.quad)!.map((p, i) =>
                    i === index ? { ...p, y: value } : p,
                  );
                  patch({ quad: quad as never });
                }}
              />
            </div>
          ))}
        </fieldset>
      ) : (
        <div className="mockups-section__geometry">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <NumberField
              key={key}
              label={key}
              value={override?.[key] ?? surface[key]}
              onCommit={(value) => setGeometry(key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  labelWrap = false,
  hideLabel = false,
  value,
  unit,
  onCommit,
}: {
  label: string;
  labelWrap?: boolean;
  hideLabel?: boolean;
  value: number;
  unit?: string;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => {
    setDraft(String(Math.round(value * 100) / 100));
  }, [value]);
  const commit = (): void => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    else setDraft(String(Math.round(value * 100) / 100));
  };
  return (
    <label className="mockups-section__number">
      <span
        className={
          hideLabel
            ? 'varve-visually-hidden'
            : `mockups-section__number-label${
                labelWrap ? ' mockups-section__number-label--wrap' : ''
              }`
        }
      >
        {label}
      </span>
      <input
        type="number"
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(Math.round(value * 100) / 100));
          }
        }}
      />
      {unit ? <span aria-hidden="true">{unit}</span> : null}
    </label>
  );
}

function TemplatePicker({
  doc,
  frameId,
  currentTemplateId,
  onClose,
  onStatus,
}: {
  doc: Document;
  frameId: string;
  currentTemplateId: string;
  onClose: () => void;
  onStatus: (message: string | null) => void;
}): React.ReactElement {
  const editor = useEditor();
  const templates = useMemo(() => templatesForDocument(doc), [doc]);
  const [pending, setPending] = useState<MockupTemplateAsset | null>(null);

  const plan = useMemo(() => {
    if (!pending) return null;
    const embedded = doc.mockupTemplates?.[pending.id]
      ? doc
      : { ...doc, mockupTemplates: { ...doc.mockupTemplates, [pending.id]: pending } };
    return planMockupTemplateRemap(embedded, frameId, pending.id);
  }, [doc, pending, frameId]);

  const apply = (template: MockupTemplateAsset): void => {
    const result = applyMockupTemplateToInstance(editor, frameId, template);
    if (!result) {
      onStatus('Template could not be applied.');
      onClose();
      return;
    }
    const unbound = result.unboundSurfaceIds.length;
    onStatus(
      unbound > 0
        ? `Template applied; ${unbound} surface${unbound === 1 ? '' : 's'} need artwork.`
        : 'Template applied with sources remapped by slot.',
    );
    onClose();
  };

  return (
    <fieldset className="mockups-section__picker" aria-label="Replace template">
      <legend className="visually-hidden">Replace template</legend>
      {pending && plan && (
        <p className="mockups-section__picker-plan" role="status">
          {plan.remappedCount} of {plan.assignments.length} surface
          {plan.assignments.length === 1 ? '' : 's'} matched by slot.
          {plan.unboundSurfaceIds.length > 0
            ? ` Unbound: ${plan.unboundSurfaceIds
                .map((id) => plan.assignments.find((a) => a.surfaceId === id)?.surfaceName ?? id)
                .join(', ')}.`
            : ''}
          {plan.ambiguousSurfaceIds.length > 0
            ? ` Ambiguous: ${plan.ambiguousSurfaceIds
                .map((id) => plan.assignments.find((a) => a.surfaceId === id)?.surfaceName ?? id)
                .join(', ')}; review after applying.`
            : ''}
        </p>
      )}
      <ul className="mockups-section__picker-list">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className="mockups-section__picker-item"
              aria-current={template.id === currentTemplateId}
              onClick={() => setPending(template)}
            >
              {template.name}
            </button>
          </li>
        ))}
      </ul>
      {pending && (
        <div className="mockups-section__picker-actions">
          <Button size="sm" onClick={() => apply(pending)}>
            Apply {pending.name}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** True when the selected single node is a mockup frame. */
export function isMockupSelection(node: unknown): node is FrameNode {
  return isMockupFrame(node);
}

function templateSurfaceCount(doc: Document, frameId: string): number {
  const frame = doc.nodes[frameId];
  const templateId = frame && isMockupFrame(frame) ? frame.mockup.templateId : '';
  return doc.mockupTemplates?.[templateId]?.surfaces.length ?? 1;
}
