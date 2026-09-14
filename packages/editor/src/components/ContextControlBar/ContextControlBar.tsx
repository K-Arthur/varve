/**
 * ContextControlBar — Affinity-style context-sensitive properties sub-bar.
 *
 * Renders a compact secondary bar directly below the menubar, whose contents change
 * depending on the active selection:
 *
 *   - Nothing selected  → quick-access tool buttons (Frame, Rect, Text, Pen)
 *   - Image selected    → Crop, Remove BG, separator, Opacity
 *   - Shape/Vector      → Fill swatch, Stroke swatch, Stroke width, Flip H/V
 *   - Text layer        → Font family, Weight, and Size controls
 *   - Frame             → Preset label, Orientation swap, Clip toggle
 *   - Multi-select      → Group, Align H center, Align V center, Boolean Union
 *
 * Each control uses existing @varve/ui primitives (Icon, Tooltip) and reads
 * from useEditor() — no new context, no new provider, no new imports in hub
 * files (ContextControlBar is re-exported from the Menubar barrel so Shell
 * can import it on the same line without adding a new import statement).
 */

import type { FrameNode, SceneNode, TextNode } from '@varve/scene';
import { isExportRegion, isImageShape } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { Icon, Select, Tooltip } from '@varve/ui';
import { useEffect, useMemo, useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import { FontSelector } from '../FontBrowser/FontSelector';
import { fontFamilyChanges, fontWeightChanges, fontWeightOptions } from '../Typography/fontWeight';
import {
  applyTypographyChanges,
  type TypographyCommandSurface,
  type TypographyTextChanges,
} from '../Typography/typographyCommand';
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
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`ccb__btn${active ? ' ccb__btn--active' : ''}`}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
      >
        <Icon name={icon as Parameters<typeof Icon>[0]['name']} size={14} />
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
          <Icon name="Frame" size={13} />
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
          <Icon name="Square" size={13} />
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
          <Icon name="Type" size={13} />
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
          <Icon name="Pen" size={13} />
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
  const fontFamily = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const fontWeight = node.fontWeight ?? 400;
  const weightOptions = fontWeightOptions(node);
  const applyChanges = (changes: TypographyTextChanges) =>
    applyTypographyChanges(typographySurface, node.id, changes);
  return (
    <>
      <span className="ccb__label">Text</span>
      <Divider />
      <FontSelector
        className="ccb__font-selector"
        value={fontFamily}
        fontReference={node.fontReference}
        onChange={(family) => applyChanges(fontFamilyChanges(family, node.fontFamily))}
      />
      <Select
        label="Font weight"
        className="ccb__weight-select"
        value={String(fontWeight)}
        options={weightOptions.map((option) => ({
          value: String(option.value),
          label: option.label,
          disabled: option.disabled,
          disabledReason: option.disabledReason,
        }))}
        onChange={(value) => applyChanges(fontWeightChanges(node, Number(value)))}
      />
      <TextSizeControl node={node} applyChanges={applyChanges} />
    </>
  );
}

function TextSizeControl({
  node,
  applyChanges,
}: {
  node: TextNode;
  applyChanges: (changes: TypographyTextChanges) => void;
}) {
  const [draft, setDraft] = useState(String(node.fontSize ?? 16));
  const value = node.fontSize ?? 16;

  useEffect(() => setDraft(String(value)), [value]);

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

function ShapeSection({
  setSelectedFlipH,
  setSelectedFlipV,
}: {
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
}) {
  return (
    <>
      <span className="ccb__label">Shape</span>
      <Divider />
      <Tooltip label="Flip horizontal">
        <button
          type="button"
          className="ccb__btn"
          aria-label="Flip horizontal"
          onClick={setSelectedFlipH}
        >
          <Icon name="FlipHorizontal2" size={14} />
        </button>
      </Tooltip>
      <Tooltip label="Flip vertical">
        <button
          type="button"
          className="ccb__btn"
          aria-label="Flip vertical"
          onClick={setSelectedFlipV}
        >
          <Icon name="FlipVertical2" size={14} />
        </button>
      </Tooltip>
    </>
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
  } = useEditor();
  const sel = state.selection;
  const doc = state.document;

  const typographySurface = useMemo<TypographyCommandSurface>(
    () => ({
      selectedIds: state.selection,
      selectionRange: state.selectionRange,
      pendingFormat: state.pendingFormat,
      updateNode,
      applyFormatToSelection,
      setPendingFormat,
      groupCompoundOperation,
    }),
    [
      applyFormatToSelection,
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
        <ShapeSection setSelectedFlipH={setSelectedFlipH} setSelectedFlipV={setSelectedFlipV} />
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
  ]);

  return (
    <div className="context-control-bar" role="toolbar" aria-label="Contextual properties">
      {content}
    </div>
  );
}
