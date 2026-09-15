/**
 * ContextControlBar — Affinity-style context-sensitive properties sub-bar.
 *
 * Renders a compact secondary bar directly below the menubar, whose contents change
 * depending on the active selection:
 *
 *   - Nothing selected  → quick-access tool buttons (Frame, Rect, Text, Pen)
 *   - Image selected    → Crop, Remove BG, Vectorize
 *   - Shape/Vector      → Fill swatch, Stroke swatch, Stroke width, Flip H/V
 *   - Text layer        → Font family, Weight, Bold/Italic, Size
 *   - Frame             → Orientation swap, Clip toggle
 *   - Multi-select      → Group, Align H center, Boolean Union
 *
 * Each control uses existing @varve/ui primitives and the editor's existing
 * commands — no new context, no new provider, no new imports in hub files
 * (ContextControlBar is re-exported from the Menubar barrel so Shell can
 * import it on the same line without adding a new import statement).
 *
 * Scope note: this bar is a *convenience* surface. Anything it does not
 * expose (gradients, layered fills, stroke alignment/caps, per-side weights,
 * corner radius) stays in the Inspector, which remains the complete editor.
 */

import type { FrameNode, SceneNode, TextNode } from '@varve/scene';
import { isExportRegion, isImageShape } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { Icon, Select, Toolbar, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type ToolId, useEditor } from '../../context';
import { getTextEditSessionNodeId, subscribeTextEditSession } from '../../context/textEditSession';
import { type FontFaceSelection, FontSelector } from '../FontBrowser/FontSelector';
import {
  fontFamilyChanges,
  fontStyleAvailable,
  fontStyleChanges,
  fontWeightChanges,
  fontWeightOptions,
} from '../Typography/fontWeight';
import {
  applyTypographyChanges,
  type TypographyCommandSurface,
  type TypographyTextChanges,
  typographyDisplayValues,
} from '../Typography/typographyCommand';
import { useTypographyPreview } from '../Typography/useTypographyPreview';
import { ShapeQuickControls } from './ShapeQuickControls';
import './ContextControlBar.css';

/* ── Small helpers ───────────────────────────────────────────────── */

function Divider() {
  return <span aria-hidden className="ccb__divider" />;
}

function CcbButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  title,
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`ccb__btn${active ? ' ccb__btn--active' : ''}`}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        title={title}
        onClick={onClick}
      >
        <Icon name={icon as Parameters<typeof Icon>[0]['name']} size={16} />
      </button>
    </Tooltip>
  );
}

/* ── Context sections ────────────────────────────────────────────── */

function EmptySection({ setTool }: { setTool: (id: ToolId) => void }) {
  return (
    <>
      <span className="ccb__hint">No selection —</span>
      <Tooltip label="Create frame (F)">
        <button
          type="button"
          className="ccb__tool-pill"
          aria-label="Create frame"
          onClick={() => setTool('frame')}
        >
          <Icon name="Frame" size={16} />
          <span>Frame</span>
          <kbd className="ccb__kbd">F</kbd>
        </button>
      </Tooltip>
      <Tooltip label="Draw rectangle (R)">
        <button
          type="button"
          className="ccb__tool-pill"
          aria-label="Draw rectangle"
          onClick={() => setTool('rect')}
        >
          <Icon name="Square" size={16} />
          <span>Rect</span>
          <kbd className="ccb__kbd">R</kbd>
        </button>
      </Tooltip>
      <Tooltip label="Add text (T)">
        <button
          type="button"
          className="ccb__tool-pill"
          aria-label="Add text"
          onClick={() => setTool('text')}
        >
          <Icon name="Type" size={16} />
          <span>Text</span>
          <kbd className="ccb__kbd">T</kbd>
        </button>
      </Tooltip>
      <Tooltip label="Pen tool (P)">
        <button
          type="button"
          className="ccb__tool-pill"
          aria-label="Pen tool"
          onClick={() => setTool('pen')}
        >
          <Icon name="Pen" size={16} />
          <span>Pen</span>
          <kbd className="ccb__kbd">P</kbd>
        </button>
      </Tooltip>
    </>
  );
}

function ImageSection({
  setTool,
  removeBackground,
  openVectorizeDialog,
}: {
  setTool: (id: ToolId) => void;
  removeBackground: (method: import('@varve/scene').BackgroundRemovalMethod) => Promise<void>;
  openVectorizeDialog: () => void;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemoveBackground = () => {
    setRemoving(true);
    // Failures surface through the editor's existing inference error path;
    // the local flag only drives the busy state of this trigger.
    void removeBackground('ai-balanced')
      .catch(() => undefined)
      .finally(() => setRemoving(false));
  };

  return (
    <>
      <span className="ccb__label">Image</span>
      <Divider />
      <CcbButton icon="Crop" label="Crop image (C)" shortcut="C" onClick={() => setTool('crop')} />
      <Tooltip label="Remove background (B)">
        <button
          type="button"
          className={`ccb__btn${removing ? ' ccb__btn--busy' : ''}`}
          aria-label="Remove background"
          aria-busy={removing}
          disabled={removing}
          onClick={handleRemoveBackground}
        >
          <Icon name="Eraser" size={14} />
        </button>
      </Tooltip>
      <CcbButton icon="Sparkles" label="Vectorize image" onClick={() => openVectorizeDialog()} />
    </>
  );
}

function TextSection({
  node,
  typographySurface,
}: {
  node: TextNode;
  typographySurface: TypographyCommandSurface;
}) {
  const display = typographyDisplayValues(
    node,
    typographySurface.selectionRange,
    typographySurface.pendingFormat,
  );
  const displayNode = { ...node, ...display.values };
  const effectiveNodes = display.effectiveNodes.length > 0 ? display.effectiveNodes : [displayNode];
  const fontFamily = displayNode.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const fontWeight = displayNode.fontWeight ?? 400;
  const weightOptions = fontWeightOptions(effectiveNodes);
  const isBold = fontWeight >= 600;
  const boldAvailable = display.mixed.fontWeight
    ? weightOptions.some((option) => option.value === 700 && !option.disabled)
    : isBold || weightOptions.some((option) => option.value === 700 && !option.disabled);
  const isItalic = (displayNode.fontStyle ?? 'normal') === 'italic';
  const italicAvailable = display.mixed.fontStyle
    ? fontStyleAvailable(effectiveNodes, 'italic')
    : isItalic || fontStyleAvailable(effectiveNodes, 'italic');
  const applyChanges = useCallback(
    (changes: TypographyTextChanges) => applyTypographyChanges(typographySurface, node.id, changes),
    [node.id, typographySurface],
  );
  const {
    previewChanges,
    commitChanges,
    clearPreview: clearFontPreview,
  } = useTypographyPreview(applyChanges, {
    beginPreview: typographySurface.beginPreview,
    commitPreview: typographySurface.commitPreview,
    abortPreview: typographySurface.abortPreview,
    resetKey: node.id,
  });

  const familyChanges = useCallback(
    (family: string) =>
      fontFamilyChanges(
        family,
        displayNode.fontFamily,
        displayNode.fontReference,
        displayNode.variableAxes,
      ),
    [displayNode.fontFamily, displayNode.fontReference, displayNode.variableAxes],
  );
  const previewFamily = useCallback(
    (family: string) => previewChanges(familyChanges(family)),
    [familyChanges, previewChanges],
  );
  const selectFamily = useCallback(
    (family: string) => commitChanges(familyChanges(family)),
    [commitChanges, familyChanges],
  );
  const selectFace = useCallback(
    (selection: FontFaceSelection) =>
      commitChanges({
        fontFamily: selection.family,
        fontWeight: selection.weight,
        fontStyle: selection.style,
        fontReference: selection.fontReference,
        variableAxes: selection.variableAxes,
      }),
    [commitChanges],
  );
  const previewFace = useCallback(
    (selection: FontFaceSelection) =>
      previewChanges({
        fontFamily: selection.family,
        fontWeight: selection.weight,
        fontStyle: selection.style,
        fontReference: selection.fontReference,
        variableAxes: selection.variableAxes,
      }),
    [previewChanges],
  );
  return (
    <>
      <span className="ccb__label">Text</span>
      <Divider />
      <FontSelector
        className="ccb__font-selector"
        value={fontFamily}
        fontReference={displayNode.fontReference}
        variableAxes={displayNode.variableAxes}
        mixed={display.mixed.fontFamily === true}
        onChange={selectFamily}
        onSelectFace={selectFace}
        onPreviewFamily={previewFamily}
        onPreviewFace={previewFace}
        onClearPreview={clearFontPreview}
      />
      <Select
        label="Font weight"
        className="ccb__weight-select"
        value={display.mixed.fontWeight ? '' : String(fontWeight)}
        placeholder={display.mixed.fontWeight ? 'Mixed' : undefined}
        options={weightOptions.map((option) => ({
          value: String(option.value),
          label: option.label,
          disabled: option.disabled,
          disabledReason: option.disabledReason,
        }))}
        onChange={(value) => applyChanges(fontWeightChanges(displayNode, Number(value)))}
      />
      <CcbButton
        icon="Bold"
        label="Bold"
        active={isBold}
        disabled={!boldAvailable}
        title={boldAvailable ? undefined : 'This font has no real bold face'}
        onClick={() => applyChanges(fontWeightChanges(displayNode, isBold ? 400 : 700))}
      />
      <CcbButton
        icon="Italic"
        label="Italic"
        active={isItalic}
        disabled={!italicAvailable}
        title={italicAvailable ? undefined : 'This font has no real italic face'}
        onClick={() => applyChanges(fontStyleChanges(displayNode, isItalic ? 'normal' : 'italic'))}
      />
      <TextSizeControl
        node={displayNode}
        mixed={display.mixed.fontSize === true}
        applyChanges={applyChanges}
      />
    </>
  );
}

function TextSizeControl({
  node,
  mixed = false,
  applyChanges,
}: {
  node: TextNode;
  mixed?: boolean;
  applyChanges: (changes: TypographyTextChanges) => void;
}) {
  const [draft, setDraft] = useState(mixed ? '' : String(node.fontSize ?? 16));
  const value = node.fontSize ?? 16;

  useEffect(() => setDraft(mixed ? '' : String(value)), [mixed, value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next <= 0 || next > 10000) {
      setDraft(String(value));
      return;
    }
    if (next !== value) {
      applyChanges({ fontSize: next });
    }
    setDraft(String(next));
  };

  return (
    <label className="ccb__size-control">
      <span className="ccb__field-label">Size</span>
      <input
        type="number"
        className="ccb__size-input"
        aria-label="Font size"
        min={1}
        max={10000}
        step={1}
        value={draft}
        placeholder={mixed ? 'Mixed' : undefined}
        data-mixed={mixed || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape' && draft !== String(value)) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(String(value));
          }
        }}
      />
    </label>
  );
}

function FrameSection({
  node,
  applyFramePreset,
  setNodeClipContent,
}: {
  node: FrameNode;
  applyFramePreset: (preset: { name: string; w: number; h: number }) => void;
  setNodeClipContent: (id: FrameNode['id'], clipContent: boolean) => void;
}) {
  const clipped = node.clipContent !== false;
  return (
    <>
      <span className="ccb__label">Frame</span>
      <Divider />
      <Tooltip label="Swap width and height">
        <button
          type="button"
          className="ccb__btn"
          aria-label="Swap orientation"
          onClick={() => applyFramePreset({ name: node.name, w: node.h, h: node.w })}
        >
          <Icon name="RotateCw" size={14} />
        </button>
      </Tooltip>
      <Tooltip label={clipped ? 'Clipping content' : 'Not clipping content'}>
        <button
          type="button"
          className={`ccb__btn${clipped ? ' ccb__btn--active' : ''}`}
          aria-label="Toggle clip content"
          aria-pressed={clipped}
          onClick={() => setNodeClipContent(node.id, !clipped)}
        >
          <Icon name="Crop" size={14} />
        </button>
      </Tooltip>
    </>
  );
}

function MultiSection({
  groupSelected,
  alignSelected,
  booleanOp,
}: {
  groupSelected: () => void;
  alignSelected: (axis: 'centerH' | 'centerV') => void;
  booleanOp: (op: 'union') => void;
}) {
  return (
    <>
      <span className="ccb__label">Multi</span>
      <Divider />
      <CcbButton
        icon="Group"
        label="Group selection (Ctrl+G)"
        shortcut="Ctrl+G"
        onClick={groupSelected}
      />
      <CcbButton
        icon="AlignCenterHorizontal"
        label="Align horizontal centers"
        onClick={() => alignSelected('centerH')}
      />
      <Divider />
      <CcbButton icon="Combine" label="Boolean union" onClick={() => booleanOp('union')} />
    </>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export function ContextControlBar() {
  const {
    state,
    setTool,
    groupSelected,
    setSelectedFlipH,
    setSelectedFlipV,
    applyFramePreset,
    setNodeClipContent,
    removeBackground,
    openVectorizeDialog,
    alignSelected,
    booleanOp,
    updateNode,
    applyFormatToSelection,
    setPendingFormat,
    groupCompoundOperation,
    beginTransaction,
    commitTransaction,
    abortTransaction,
  } = useEditor();
  const sel = state.selection;
  const doc = state.document;

  // While the in-canvas text editor is active, the floating text bar (mounted
  // beside the work) is the typography surface. Rendering the same controls
  // here as well duplicated every button in two places at once; keep the row
  // honest about where the controls are instead.
  const textEditNodeId = useSyncExternalStore(
    subscribeTextEditSession,
    getTextEditSessionNodeId,
    () => null,
  );

  const typographySurface = useMemo<TypographyCommandSurface>(
    () => ({
      selectedIds: state.selection,
      selectionRange: state.selectionRange,
      pendingFormat: state.pendingFormat,
      updateNode,
      applyFormatToSelection,
      setPendingFormat,
      groupCompoundOperation,
      beginPreview: beginTransaction ? () => beginTransaction('preview') : undefined,
      commitPreview: commitTransaction,
      abortPreview: abortTransaction,
    }),
    [
      abortTransaction,
      applyFormatToSelection,
      beginTransaction,
      commitTransaction,
      groupCompoundOperation,
      setPendingFormat,
      state.pendingFormat,
      state.selection,
      state.selectionRange,
      updateNode,
    ],
  );

  const selectedNodes: SceneNode[] = useMemo(
    () => sel.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)),
    [sel, doc],
  );

  const content = useMemo(() => {
    if (selectedNodes.length === 0) {
      return <EmptySection setTool={setTool} />;
    }

    if (selectedNodes.length > 1) {
      return (
        <MultiSection
          groupSelected={groupSelected}
          alignSelected={(axis) => alignSelected(axis, 'selection')}
          booleanOp={(op) => booleanOp(op)}
        />
      );
    }

    const node = selectedNodes[0]!;

    if (node.kind === 'shape' && isImageShape(node)) {
      return (
        <ImageSection
          setTool={setTool}
          removeBackground={removeBackground}
          openVectorizeDialog={openVectorizeDialog}
        />
      );
    }

    if (node.kind === 'text') {
      if (textEditNodeId === node.id) {
        return (
          <>
            <span className="ccb__label">Text</span>
            <span className="ccb__hint">
              Editing on canvas — formatting is on the floating text bar
            </span>
          </>
        );
      }
      return <TextSection node={node as TextNode} typographySurface={typographySurface} />;
    }

    if (node.kind === 'frame' && !isExportRegion(node)) {
      return (
        <FrameSection
          node={node as FrameNode}
          applyFramePreset={applyFramePreset}
          setNodeClipContent={setNodeClipContent}
        />
      );
    }

    if (node.kind === 'shape' || node.kind === 'path') {
      return (
        <ShapeQuickControls
          node={node}
          setSelectedFlipH={setSelectedFlipH}
          setSelectedFlipV={setSelectedFlipV}
        />
      );
    }

    // Fallback: generic node info
    return (
      <span className="ccb__hint">
        {node.kind.charAt(0).toUpperCase() + node.kind.slice(1)} selected
      </span>
    );
  }, [
    selectedNodes,
    setTool,
    groupSelected,
    setSelectedFlipH,
    setSelectedFlipV,
    applyFramePreset,
    setNodeClipContent,
    removeBackground,
    openVectorizeDialog,
    alignSelected,
    booleanOp,
    typographySurface,
    textEditNodeId,
  ]);

  return (
    <Toolbar label="Contextual properties" className="context-control-bar">
      {content}
    </Toolbar>
  );
}
