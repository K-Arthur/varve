import {
  clearMasterPageLayout,
  clearPageLayout,
  createDefaultLayoutGrid,
  type LayoutGrid,
  type PageLayoutSettings,
  setDocumentPageLayout,
  setMasterPageLayout,
  setPageLayout,
} from '@varve/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  BUILT_IN_GUIDE_LAYOUT_PRESETS,
  type GuideLayoutPreset,
  materializeGuideLayoutPreset,
  readPersonalGuideLayoutPresets,
} from './guideLayoutPresets';
import './GuideLayoutsDialogHost.css';

const OPEN_EVENT = 'varve:open-guide-layouts';
type GuideLayoutTarget = 'selection' | 'page' | 'master' | 'document';

interface OpenRequest {
  target: GuideLayoutTarget;
  masterId?: string;
}

interface Draft {
  mode: LayoutGrid['layoutMode'];
  count: string;
  gutter: string;
  trackSize: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  cellSize: string;
  offsetX: string;
  offsetY: string;
}

const DEFAULT_DRAFT: Draft = {
  mode: 'columns',
  count: '12',
  gutter: '24',
  trackSize: '',
  marginTop: '24',
  marginRight: '24',
  marginBottom: '24',
  marginLeft: '24',
  cellSize: '8',
  offsetX: '0',
  offsetY: '0',
};

function readNumber(value: string, label: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min)
    throw new Error(`${label} must be ${min} or greater`);
  return parsed;
}

function draftFromGrid(grid: LayoutGrid | undefined): Draft {
  if (!grid) return DEFAULT_DRAFT;
  const margins = grid.margins ?? {
    top: grid.margin[0],
    right: grid.margin[1],
    bottom: grid.margin[2],
    left: grid.margin[3],
  };
  return {
    ...DEFAULT_DRAFT,
    mode: grid.layoutMode,
    count: String(
      grid.count ?? (grid.layoutMode === 'rows' ? grid.rowCount : grid.columnCount) ?? 1,
    ),
    gutter: String(grid.gutter ?? 0),
    trackSize: String(
      grid.trackSize ?? (grid.layoutMode === 'rows' ? grid.rowHeight : grid.columnWidth) ?? '',
    ),
    marginTop: String(margins.top),
    marginRight: String(margins.right),
    marginBottom: String(margins.bottom),
    marginLeft: String(margins.left),
    cellSize: String(grid.cellSize ?? 8),
    offsetX: String(grid.offsetX ?? 0),
    offsetY: String(grid.offsetY ?? 0),
  };
}

function layoutFromDraft(draft: Draft, id: string, name: string): LayoutGrid {
  const count = Math.max(1, Math.round(readNumber(draft.count, 'Track count', 1)));
  const gutter = readNumber(draft.gutter, 'Gutter');
  const margins = {
    top: readNumber(draft.marginTop, 'Top margin'),
    right: readNumber(draft.marginRight, 'Right margin'),
    bottom: readNumber(draft.marginBottom, 'Bottom margin'),
    left: readNumber(draft.marginLeft, 'Left margin'),
  };
  const common: LayoutGrid = {
    ...createDefaultLayoutGrid(),
    id,
    name,
    layoutMode: draft.mode,
    count,
    gutter,
    margin: [margins.top, margins.right, margins.bottom, margins.left],
    margins,
    alignment: 'stretch',
    sizing: draft.trackSize.trim() ? 'fixed' : 'stretch',
    ...(draft.trackSize.trim() ? { trackSize: readNumber(draft.trackSize, 'Track size', 1) } : {}),
  };
  if (draft.mode === 'uniform') {
    return {
      ...common,
      cellSize: readNumber(draft.cellSize, 'Cell size', 1),
      offsetX: readNumber(draft.offsetX, 'Horizontal offset'),
      offsetY: readNumber(draft.offsetY, 'Vertical offset'),
      count: undefined,
      sizing: undefined,
      trackSize: undefined,
    };
  }
  return draft.mode === 'rows'
    ? { ...common, rowCount: count, rowHeight: common.trackSize }
    : { ...common, columnCount: count, columnWidth: common.trackSize };
}

function pageLayoutFromDraft(draft: Draft): PageLayoutSettings {
  const count = Math.max(1, Math.round(readNumber(draft.count, 'Track count', 1)));
  return {
    margins: {
      top: readNumber(draft.marginTop, 'Top margin'),
      outside: readNumber(draft.marginRight, 'Outside margin'),
      bottom: readNumber(draft.marginBottom, 'Bottom margin'),
      inside: readNumber(draft.marginLeft, 'Inside margin'),
    },
    columns: {
      count: draft.mode === 'rows' ? 1 : count,
      gutter: readNumber(draft.gutter, 'Column gutter'),
    },
    rows: {
      count: draft.mode === 'columns' ? 1 : count,
      gutter: readNumber(draft.gutter, 'Row gutter'),
    },
    display: true,
    snapEnabled: true,
  };
}

function cloneGuideMap(doc: import('@varve/scene').Document) {
  return Object.fromEntries(
    Object.entries(doc.gridSettings?.layoutGrids ?? {}).map(([owner, layouts]) => [
      owner,
      layouts.map((layout) => ({
        ...layout,
        margin: [...layout.margin] as [number, number, number, number],
        ...(layout.margins ? { margins: { ...layout.margins } } : {}),
      })),
    ]),
  );
}

export function GuideLayoutsDialogHost() {
  const editor = useEditor();
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [replaceAll, setReplaceAll] = useState(false);
  const [presetId, setPresetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [personalPresets, setPersonalPresets] = useState<GuideLayoutPreset[]>([]);
  const lastPreviewSignatureRef = useRef<string | null>(null);
  const snapshotRef = useRef<{
    documentId: string;
    target: GuideLayoutTarget;
    frameIds: string[];
    pageId?: string;
    masterId?: string;
    guides: ReturnType<typeof cloneGuideMap>;
    pageLayout?: PageLayoutSettings;
    masterLayout?: PageLayoutSettings;
    documentLayout?: PageLayoutSettings;
  } | null>(null);
  const previewingRef = useRef(false);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<Partial<OpenRequest>>).detail;
      const target = detail?.target ?? 'selection';
      const frameIds =
        target === 'selection'
          ? editor.state.selection.filter((id) => editor.state.document.nodes[id]?.kind === 'frame')
          : [];
      const masterId =
        detail?.masterId ??
        editor.state.document.pages?.find((page) => page.id === editor.state.document.activePageId)
          ?.masterPageId;
      snapshotRef.current = {
        documentId: editor.state.document.id,
        target,
        frameIds,
        ...(editor.state.document.activePageId
          ? { pageId: editor.state.document.activePageId }
          : {}),
        ...(masterId ? { masterId } : {}),
        guides: cloneGuideMap(editor.state.document),
        pageLayout: editor.state.document.pages?.find(
          (page) => page.id === editor.state.document.activePageId,
        )?.layout,
        masterLayout: masterId ? editor.state.document.masters?.[masterId]?.layout : undefined,
        documentLayout: editor.state.document.pageLayout,
      };
      const firstGrid = frameIds.flatMap(
        (id) => editor.state.document.gridSettings?.layoutGrids?.[id] ?? [],
      )[0];
      setDraft(draftFromGrid(firstGrid));
      setReplaceAll(false);
      setPresetId('');
      setError(null);
      setPersonalPresets(readPersonalGuideLayoutPresets());
      setRequest({ target, ...(masterId ? { masterId } : {}) });
      lastPreviewSignatureRef.current = null;
      editor.beginTransaction('preview');
      previewingRef.current = true;
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, [editor]);

  const presets = useMemo(
    () => [...BUILT_IN_GUIDE_LAYOUT_PRESETS, ...personalPresets],
    [personalPresets],
  );

  const applyPreview = useCallback(
    (nextDraft: Draft, selectedPreset?: GuideLayoutPreset) => {
      const snapshot = snapshotRef.current;
      if (!snapshot || snapshot.documentId !== editor.state.document.id) return;
      try {
        if (snapshot.target === 'selection') {
          // Validate typed values even when the selection snapshot is empty;
          // Apply must never become enabled merely because there is no target
          // left to preview.
          if (!selectedPreset) layoutFromDraft(nextDraft, 'validation', 'Guide layout');
          const layoutsByFrame = selectedPreset
            ? new Map(
                snapshot.frameIds.map((id) => [id, materializeGuideLayoutPreset(selectedPreset)]),
              )
            : null;
          editor.updateDoc((doc) => {
            const layoutGrids = cloneGuideMap(doc);
            for (const frameId of snapshot.frameIds) {
              const node = doc.nodes[frameId];
              if (node?.kind !== 'frame') continue;
              const existing = snapshot.guides[frameId] ?? [];
              if (replaceAll && existing.some((layout) => layout.locked)) {
                throw new Error('Unlock existing layouts before replacing all.');
              }
              const authored = layoutsByFrame?.get(frameId) ?? [
                layoutFromDraft(nextDraft, `${frameId}:layout:preview`, 'Guide layout'),
              ];
              const reminted = authored.map((layout, index) => ({
                ...layout,
                id: `${frameId}:layout:${index + 1}`,
                frameId,
              }));
              layoutGrids[frameId] = replaceAll
                ? reminted
                : [
                    ...existing,
                    ...reminted.filter(
                      (candidate) => !existing.some((item) => item.id === candidate.id),
                    ),
                  ];
            }
            return {
              ...doc,
              gridSettings: { ...(doc.gridSettings ?? {}), layoutGrids },
            };
          });
        } else {
          const layout = pageLayoutFromDraft(nextDraft);
          editor.updateDoc((doc) => {
            if (snapshot.target === 'page') {
              const pageId = snapshot.pageId;
              return pageId ? setPageLayout(doc, pageId, layout) : doc;
            }
            if (snapshot.target === 'master' && snapshot.masterId) {
              return setMasterPageLayout(doc, snapshot.masterId, layout);
            }
            return setDocumentPageLayout(doc, layout);
          });
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Enter valid guide values.');
      }
    },
    [editor, replaceAll],
  );

  useEffect(() => {
    if (!request || !previewingRef.current) return;
    const signature = JSON.stringify({ target: request, draft, presetId, replaceAll });
    if (lastPreviewSignatureRef.current === signature) return;
    lastPreviewSignatureRef.current = signature;
    if (presetId) {
      const preset = presets.find((candidate) => candidate.id === presetId);
      if (preset) applyPreview(draft, preset);
      return;
    }
    applyPreview(draft);
  }, [applyPreview, draft, presetId, presets, request]);

  const close = useCallback(
    (apply: boolean) => {
      if (!request) return;
      if (apply && !error) editor.commitTransaction();
      else {
        const snapshot = snapshotRef.current;
        editor.abortTransaction((_, current) => {
          if (!snapshot) return current;
          if (snapshot.target === 'selection') {
            return {
              ...current,
              gridSettings: { ...(current.gridSettings ?? {}), layoutGrids: snapshot.guides },
            };
          }
          if (snapshot.target === 'page' && snapshot.pageId) {
            return {
              ...current,
              pages: current.pages?.map((page) =>
                page.id === snapshot.pageId ? { ...page, layout: snapshot.pageLayout } : page,
              ),
            };
          }
          if (
            snapshot.target === 'master' &&
            snapshot.masterId &&
            current.masters?.[snapshot.masterId]
          ) {
            return {
              ...current,
              masters: {
                ...current.masters,
                [snapshot.masterId]: {
                  ...current.masters[snapshot.masterId]!,
                  layout: snapshot.masterLayout,
                },
              },
            };
          }
          return { ...current, pageLayout: snapshot.documentLayout };
        });
      }
      previewingRef.current = false;
      snapshotRef.current = null;
      lastPreviewSignatureRef.current = null;
      setRequest(null);
      setError(null);
    },
    [editor, error, request],
  );

  if (!request) return null;
  const targetLabel =
    request.target === 'selection'
      ? `${snapshotRef.current?.frameIds.length ?? 0} frame(s)`
      : request.target;
  return (
    <dialog
      className="guide-layout-dialog"
      open
      aria-labelledby="guide-layout-title"
      onCancel={() => close(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
        }
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          close(true);
        }}
      >
        <header className="guide-layout-dialog__header">
          <div>
            <h2 id="guide-layout-title">Guide Layouts</h2>
            <p>{targetLabel} · changes preview on canvas and apply as one undo step.</p>
          </div>
          <button
            type="button"
            className="guide-layout-dialog__close"
            onClick={() => close(false)}
            aria-label="Cancel"
          >
            Close
          </button>
        </header>
        <div className="guide-layout-dialog__body">
          {request.target === 'selection' && (
            <label className="guide-layout-dialog__field">
              Preset
              <select
                value={presetId}
                onChange={(event) => {
                  setPresetId(event.target.value);
                  setError(null);
                }}
              >
                <option value="">Custom layout</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="guide-layout-dialog__field">
            Layout type
            <select
              value={draft.mode}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  mode: event.target.value as Draft['mode'],
                }))
              }
            >
              <option value="columns">Columns</option>
              <option value="rows">Rows</option>
              <option value="uniform">Uniform square lattice</option>
            </select>
          </label>
          <div className="guide-layout-dialog__grid">
            <label>
              Count
              <input
                inputMode="numeric"
                value={draft.count}
                onChange={(event) => setDraft((value) => ({ ...value, count: event.target.value }))}
              />
            </label>
            <label>
              Gutter
              <input
                inputMode="decimal"
                value={draft.gutter}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, gutter: event.target.value }))
                }
              />
            </label>
            {draft.mode === 'uniform' ? (
              <>
                <label>
                  Cell size
                  <input
                    inputMode="decimal"
                    value={draft.cellSize}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, cellSize: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Offset X
                  <input
                    inputMode="decimal"
                    value={draft.offsetX}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, offsetX: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Offset Y
                  <input
                    inputMode="decimal"
                    value={draft.offsetY}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, offsetY: event.target.value }))
                    }
                  />
                </label>
              </>
            ) : (
              <label>
                Fixed track size
                <input
                  inputMode="decimal"
                  placeholder="Stretch"
                  value={draft.trackSize}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, trackSize: event.target.value }))
                  }
                />
              </label>
            )}
          </div>
          <fieldset>
            <legend>Margins</legend>
            <div className="guide-layout-dialog__grid guide-layout-dialog__grid--margins">
              <label>
                Top
                <input
                  inputMode="decimal"
                  value={draft.marginTop}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, marginTop: event.target.value }))
                  }
                />
              </label>
              <label>
                Right
                <input
                  inputMode="decimal"
                  value={draft.marginRight}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, marginRight: event.target.value }))
                  }
                />
              </label>
              <label>
                Bottom
                <input
                  inputMode="decimal"
                  value={draft.marginBottom}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, marginBottom: event.target.value }))
                  }
                />
              </label>
              <label>
                Left
                <input
                  inputMode="decimal"
                  value={draft.marginLeft}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, marginLeft: event.target.value }))
                  }
                />
              </label>
            </div>
          </fieldset>
          {request.target === 'selection' && (
            <label className="guide-layout-dialog__check">
              <input
                type="checkbox"
                checked={replaceAll}
                onChange={(event) => setReplaceAll(event.target.checked)}
              />{' '}
              Replace all existing layouts{' '}
              {replaceAll ? '(locked layouts block Apply)' : '(Add to existing)'}
            </label>
          )}
          {error && (
            <p className="guide-layout-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="guide-layout-dialog__footer">
          <button type="button" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={Boolean(error)}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function openGuideLayouts(target: GuideLayoutTarget = 'selection', masterId?: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenRequest>(OPEN_EVENT, {
      detail: { target, ...(masterId ? { masterId } : {}) },
    }),
  );
}

export { clearMasterPageLayout, clearPageLayout };
