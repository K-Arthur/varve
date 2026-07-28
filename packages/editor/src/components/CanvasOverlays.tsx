/**
 * CanvasOverlays — extracted overlay composition from CanvasArea.
 *
 * Renders all overlay components (rulers, guides, selections, edit overlays,
 * accessibility tree, etc.) that sit on top of the main canvas content layer.
 *
 * Research basis: Extracted from CanvasArea (3415 lines) to reduce cognitive
 * load and make overlay composition independently testable.
 */

import type { CollabUser } from '@strata/collab';
import type { MeshWarp } from '@strata/engine';
import type { Document, Fill, NodeId, SceneNode } from '@strata/scene';
import { activePageNodes, walkNodes } from '@strata/scene';
import type { RulerMode } from '@strata/shared';
import {
  computeFloatingOrigin,
  isWorldRectInViewport,
  simpleWorldToScreen,
  worldToScreen,
} from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { CanvasNameLabels } from '../canvas/CanvasNameLabels';
import { useEditor } from '../context';
import type { GridOverlayMode } from '../context/types';
import { DebugOverlayHost } from '../debug/DebugOverlayHost';
import { SelectionOverlay } from '../SelectionOverlay';
import { nodeWorldBounds } from '../scene/world';
import type { CropTool } from '../tools/CropTool';
import type { SnapGuide } from '../tools/snapping';
import { AlignmentGuideOverlay, AlignmentHandleOverlay } from './AlignmentOverlay';
import { CanvasAccessibilityTree } from './CanvasAccessibilityTree';
import { CollabCursorOverlay, type RemoteCursor } from './CollabCursorOverlay/CollabCursorOverlay';
import { ColorBlindnessOverlay, type ColorBlindnessView } from './ColorBlindnessOverlay';
import { CropOverlay } from './CropOverlay';
import { DocumentGridOverlay } from './DocumentGridOverlay/DocumentGridOverlay';
import { FloatingTextBar } from './FloatingTextBar/FloatingTextBar';
import { GradientHandleOverlay } from './GradientHandleOverlay';
import { GuideOverlay } from './GuideOverlay/GuideOverlay';
import { MeshWarpOverlay } from './MeshWarpOverlay';
import { MotionPathOverlay } from './MotionPathOverlay';
import { NodeEditOverlay } from './NodeEditOverlay';
import { OnionSkinOverlay } from './OnionSkinOverlay';
import { Ruler } from './Ruler/Ruler';
import { SelectionQuickBarHost } from './SelectionQuickBar/SelectionQuickBarHost';
import { SnapGuidesOverlay } from './SnapGuidesOverlay';
import { MeasureOverlay } from './SpecPanel/MeasureOverlay';
import { TextEditOverlay } from './TextEditOverlay';
import { VariantBox } from './VariantBox/VariantBox';
import { ZoomIndicator } from './ZoomIndicator';

export interface CanvasOverlaysProps {
  // ─── Canvas refs ────────────────────────────────────────────────────────
  contentCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  announcerRef: React.RefObject<HTMLDivElement | null>;

  // ─── Editor state (from useEditor().state) ──────────────────────────────
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  tool: string;
  selection: readonly NodeId[];
  document: Document;
  canvasMode: 'full' | 'outline' | 'preview';
  gridOverlayMode: GridOverlayMode;
  colorBlindnessView: ColorBlindnessView;
  guidesVisible: boolean;
  selectedGuideId: string | null;
  unitType: 'px' | 'pt' | 'mm' | 'cm' | 'in' | '%';
  rulerMode?: RulerMode;

  // ─── Collab ─────────────────────────────────────────────────────────────
  collabUsers: CollabUser[];
  stubRemoteCursors: RemoteCursor[];

  // ─── Snap guides ────────────────────────────────────────────────────────
  snapGuides: SnapGuide[];

  // ─── Node-edit state ────────────────────────────────────────────────────
  nodeEditTargetId: string | null;
  nodeEditSelectedAnchors: ReadonlySet<number>;

  // ─── Text-edit state ────────────────────────────────────────────────────
  textEditTargetId: string | null;
  setTextEditTargetId: (id: string | null) => void;
  setNodeEditTargetId: (id: string | null) => void;

  // ─── Warp mesh ──────────────────────────────────────────────────────────
  warpMesh: MeshWarp | null;
  setWarpMesh: (mesh: MeshWarp | null) => void;

  // ─── Hovered node ───────────────────────────────────────────────────────
  hoveredNode: SceneNode | null;

  // ─── Canvas size ────────────────────────────────────────────────────────
  canvasSize: { width: number; height: number };

  // ─── Crop tool ──────────────────────────────────────────────────────────
  cropTool: CropTool | null;
  buildToolCtx: (ev: PointerEvent) => import('../tools').ToolContext;

  // ─── Rename dialog ──────────────────────────────────────────────────────
  renameDialog: { defaultValue: string } | null;
  setRenameDialog: (v: { defaultValue: string } | null) => void;
  renameDialogRef: React.RefObject<HTMLDialogElement | null>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;

  // ─── Artboard ───────────────────────────────────────────────────────────
  artboardRect: { x: number; y: number; w: number; h: number } | null;
}

/**
 * All overlay rendering extracted from CanvasArea's JSX return.
 * Keeps the same rendering order and conditional logic.
 */
export function CanvasOverlays({
  contentCanvasRef,
  announcerRef,
  zoom,
  pan,
  cameraRotation,
  tool,
  selection,
  document: doc,
  canvasMode,
  gridOverlayMode,
  colorBlindnessView,
  guidesVisible,
  selectedGuideId,
  unitType,
  rulerMode,
  collabUsers,
  stubRemoteCursors,
  snapGuides,
  nodeEditTargetId,
  nodeEditSelectedAnchors,
  textEditTargetId,
  setTextEditTargetId,
  setNodeEditTargetId,
  warpMesh,
  setWarpMesh,
  hoveredNode,
  canvasSize,
  cropTool,
  buildToolCtx,
  renameDialog,
  setRenameDialog,
  renameDialogRef,
  renameInputRef,
  artboardRect,
}: CanvasOverlaysProps) {
  const editor = useEditor();
  const showOverlays = canvasMode !== 'preview';

  // ─── Baseline / isometric overlay settings ────────────────────────────
  // Drive the overlay from the document's BaselineGrid settings when present
  // so step and offset are configurable; fall back to the classic defaults.
  const baselineGrid = doc.gridSettings?.baselineGrids
    ? Object.values(doc.gridSettings.baselineGrids)[0]
    : undefined;

  // ─── DocumentGridOverlay ──────────────────────────────────────────────
  const showGridOverlay = gridOverlayMode !== 'none';

  // ─── ColorBlindnessOverlay ────────────────────────────────────────────
  const showColorBlindness = colorBlindnessView !== 'none';

  // ─── NodeEditOverlay ──────────────────────────────────────────────────
  const nodeEditNode = tool === 'nodeEdit' && nodeEditTargetId ? doc.nodes[nodeEditTargetId] : null;
  const nodeEditWorldMat =
    nodeEditNode?.kind === 'shape' && nodeEditNode.shape.kind === 'path' && nodeEditTargetId
      ? editor.getWorldTransform(nodeEditTargetId)
      : null;

  // ─── GradientHandleOverlay ────────────────────────────────────────────
  const showGradientHandles = selection.length >= 1;

  // ─── MeshWarpOverlay ──────────────────────────────────────────────────
  const showMeshWarp = warpMesh !== null && selection.length >= 1;

  // ─── VariantBox ───────────────────────────────────────────────────────
  const renderVariantBox = (() => {
    if (selection.length !== 1) return null;
    const singleId = selection[0] as NodeId;
    const singleNode = doc.nodes[singleId];
    if (singleNode?.kind !== 'frame') return null;
    const frame = singleNode;
    if (!frame.componentId) return null;
    const component = doc.components[frame.componentId];
    const hasVariants = component?.variants && component.variants.length > 0;
    if (!hasVariants) return null;
    const worldB = editor.getWorldBounds(singleId);
    if (!worldB) return null;
    const { x: screenX, y: screenY } = editor.worldToCanvas(worldB.x, worldB.y);
    const screenW = worldB.w * zoom;
    const screenH = worldB.h * zoom;
    return (
      <VariantBox
        nodeId={singleId}
        document={doc}
        onSetVariant={editor.setVariantForInstance}
        onCreateVariant={editor.createVariant}
        onSetPropertyOverride={editor.setPropertyOverride}
        screenBounds={{ x: screenX, y: screenY, w: screenW, h: screenH }}
        onClose={() => editor.announce('Closed variant panel')}
      />
    );
  })();

  // ─── CropOverlay ──────────────────────────────────────────────────────
  const renderCropOverlay = (() => {
    if (tool !== 'crop' || !cropTool) return null;
    const cropNodeId = cropTool.getNodeId();
    if (!cropNodeId) return null;
    const worldB = editor.getWorldBounds(cropNodeId);
    if (!worldB) return null;
    const { x: screenX, y: screenY } = editor.worldToCanvas(worldB.x, worldB.y);
    // Find image src for preview overlay
    const cropNode = doc.nodes[cropNodeId];
    const cropImageFill =
      cropNode && 'fills' in cropNode
        ? (cropNode.fills ?? []).find((f) => f.type === 'image')?.image
        : undefined;
    const imageSrc = cropImageFill?.src;
    const imageWidth = cropImageFill?.imageWidth;
    const imageHeight = cropImageFill?.imageHeight;
    // Extract shape info for non-rectangular clipping in the preview canvas
    const shapeKind =
      cropNode && 'shape' in cropNode
        ? ((cropNode.shape as { kind?: string }).kind ?? 'rect')
        : 'rect';
    const shapeParams =
      cropNode && 'shape' in cropNode ? (cropNode.shape as Record<string, unknown>) : {};
    return (
      <CropOverlay
        tool={cropTool}
        screenBounds={{
          x: screenX,
          y: screenY,
          w: worldB.w * zoom,
          h: worldB.h * zoom,
        }}
        imageSrc={imageSrc}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        shapeKind={shapeKind}
        shapeParams={shapeParams}
        onDone={() => cropTool.applyCrop(buildToolCtx(new PointerEvent('pointerup')))}
        onCancel={() => cropTool.cancel(buildToolCtx(new PointerEvent('pointerup')))}
      />
    );
  })();

  // ─── TextEditOverlay + FloatingTextBar ────────────────────────────────
  const renderTextEdit = (() => {
    if (!textEditTargetId) return null;
    const n = doc.nodes[textEditTargetId];
    if (n?.kind !== 'text') return null;
    const canvasRect = contentCanvasRef.current?.getBoundingClientRect();
    const canvasLeft = canvasRect?.left ?? 0;
    const canvasTop = canvasRect?.top ?? 0;
    const textWorldMat = editor.getWorldTransform(textEditTargetId);
    const worldX = textWorldMat[4];
    const worldY = textWorldMat[5];
    const textCam = { zoom, pan, rotation: cameraRotation ?? 0 };
    const textViewport = {
      width: canvasRect?.width ?? 1920,
      height: canvasRect?.height ?? 1080,
    };
    const textOrigin = computeFloatingOrigin(textCam, textViewport);
    const [textCanvasX, textCanvasY] = worldToScreen(
      textCam,
      worldX,
      worldY,
      textViewport,
      textOrigin,
    );
    const textScreenX = textCanvasX + canvasLeft;
    const textScreenY = textCanvasY + canvasTop;
    const textScreenW =
      (n.w ??
        (n.text.length > 0 ? n.text.length * (n.fontSize ?? 16) * 0.6 : (n.fontSize ?? 16) * 3)) *
      zoom;
    const textScreenH = (n.h ?? (n.fontSize ?? 16) * 1.4) * zoom;
    const textScreenRect = {
      x: textScreenX,
      y: textScreenY,
      w: Math.max(textScreenW, 20),
      h: Math.max(textScreenH, 20),
    };
    return (
      <>
        <TextEditOverlay
          node={n}
          zoom={zoom}
          pan={pan}
          cameraRotation={cameraRotation}
          canvasElement={contentCanvasRef.current}
          worldX={worldX}
          worldY={worldY}
          worldTransform={textWorldMat}
          onCommit={() => setTextEditTargetId(null)}
          onUpdateText={(text) =>
            editor.updateNode(textEditTargetId, (node) =>
              node.kind === 'text' ? { ...node, text } : node,
            )
          }
        />
        <FloatingTextBar
          node={n}
          textScreenRect={textScreenRect}
          onUpdate={(id, changes) =>
            editor.updateNode(id, (node) => (node.kind === 'text' ? { ...node, ...changes } : node))
          }
          onClose={() => setTextEditTargetId(null)}
        />
      </>
    );
  })();

  // ─── Empty canvas state ────────────────────────────────────────────────
  const isEmpty =
    tool !== 'inspect' &&
    Object.keys(doc.nodes).filter((id) => {
      const n = doc.nodes[id];
      return n && n.kind !== 'group';
    }).length === 0;

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Motion Mode overlays (onion skin + motion path) */}
      {canvasSize.width > 0 && (
        <>
          <OnionSkinOverlay canvasSize={canvasSize} zoom={zoom} pan={pan} />
          <MotionPathOverlay
            canvasSize={canvasSize}
            zoom={zoom}
            pan={pan}
            worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
          />
        </>
      )}
      {/* Grid overlays */}
      {showGridOverlay && (
        <DocumentGridOverlay
          mode={gridOverlayMode}
          zoom={zoom}
          pan={pan}
          cameraRotation={cameraRotation}
          width={canvasSize.width}
          height={canvasSize.height}
          baselineStep={baselineGrid?.baselineStep}
          offset={baselineGrid?.offset}
        />
      )}
      {showColorBlindness && (
        <ColorBlindnessOverlay
          type={colorBlindnessView as Exclude<ColorBlindnessView, 'none'>}
          sourceCanvas={contentCanvasRef.current}
        />
      )}
      <CollabCursorOverlay
        users={collabUsers}
        cursors={stubRemoteCursors}
        worldToScreen={(wx, wy) => editor.worldToCanvas(wx, wy)}
      />
      <DebugOverlayHost />
      <Ruler
        zoom={zoom}
        pan={pan}
        cameraRotation={cameraRotation}
        unitType={unitType}
        rulerMode={rulerMode}
        artboard={artboardRect}
        pageRulerOrigin={doc.pages?.find((p) => p.id === doc.activePageId)?.rulerOrigin}
        onAddGuide={(axis, position) => editor.addGuide(axis, position)}
        onMoveGuide={(id, position) => editor.moveGuide(id, position)}
        canvasWidth={canvasSize.width}
        canvasHeight={canvasSize.height}
        themeRevision={editor.state.themeRevision}
      />
      <GuideOverlay
        guides={editor.guides}
        zoom={zoom}
        pan={pan}
        cameraRotation={cameraRotation}
        visible={guidesVisible}
        selectedGuideId={selectedGuideId}
        onMoveGuide={(id, position) => editor.moveGuide(id, position)}
        onRemoveGuide={(id) => editor.removeGuide(id)}
        onToggleLock={(id) => editor.toggleGuideLock(id)}
        onDuplicateGuide={(id, position) => editor.duplicateGuide(id, position)}
        onSelectGuide={(id) => editor.setSelectedGuideId(id)}
      />
      <SnapGuidesOverlay
        guides={snapGuides}
        zoom={zoom}
        pan={pan}
        cameraRotation={cameraRotation}
      />
      <AlignmentGuideOverlay />
      {selection.length >= 2 && <AlignmentHandleOverlay />}
      {showGradientHandles && (
        <GradientHandleOverlay
          zoom={zoom}
          pan={pan}
          selectedIds={[...selection]}
          doc={doc}
          getWorldTransform={editor.getWorldTransform}
          onUpdateGradient={(nodeId, fillIndex, gradient) => {
            const node = doc.nodes[nodeId];
            if (!node) return;
            const nodeAny = node as unknown as Record<string, unknown>;
            const current: Fill[] = Array.isArray(nodeAny.fills) ? (nodeAny.fills as Fill[]) : [];
            const next = [...current];
            if (fillIndex >= 0 && fillIndex < next.length) {
              next[fillIndex] = { ...next[fillIndex], gradient } as Fill;
              editor.updateSelectedFillAt(fillIndex, next[fillIndex] as Fill);
            }
          }}
        />
      )}
      {showMeshWarp && warpMesh && (
        <MeshWarpOverlay
          zoom={zoom}
          pan={pan}
          mesh={warpMesh}
          srcW={
            warpMesh.cols > 0
              ? warpMesh.vertices.reduce<number>((max, v) => Math.max(max, v.x), 0)
              : 100
          }
          srcH={
            warpMesh.rows > 0
              ? warpMesh.vertices.reduce<number>((max, v) => Math.max(max, v.y), 0)
              : 100
          }
          onMeshChange={setWarpMesh}
          onDragStart={() => editor.beginTransaction()}
          onDragEnd={() => editor.commitTransaction()}
          cameraRotation={cameraRotation}
        />
      )}
      {nodeEditNode?.kind === 'shape' &&
        nodeEditNode.shape.kind === 'path' &&
        nodeEditTargetId &&
        nodeEditWorldMat && (
          <NodeEditOverlay
            node={nodeEditNode}
            selectedAnchors={nodeEditSelectedAnchors}
            zoom={zoom}
            pan={pan}
            worldTransform={nodeEditWorldMat}
          />
        )}
      <SelectionOverlay canvasRef={contentCanvasRef} />
      {showOverlays && hoveredNode && !selection.includes(hoveredNode.id) && (
        <HoverOutline node={hoveredNode} zoom={zoom} pan={pan} />
      )}
      <CanvasNameLabels
        doc={doc}
        zoom={zoom}
        pan={pan}
        cameraRotation={cameraRotation}
        selection={[...selection]}
      />
      {renderVariantBox}
      <SelectionQuickBarHost
        textEditTargetId={textEditTargetId}
        setTextEditTargetId={setTextEditTargetId}
        setNodeEditTargetId={setNodeEditTargetId}
        containerHeight={canvasSize.height}
      />
      {renderCropOverlay}
      {renderTextEdit}
      {isEmpty && (
        <div className="editor-canvas__empty">
          <EmptyState
            illustration={
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <title>Empty canvas</title>
                <path
                  d="M24 20 L24 16 C24 14.9 24.9 14 26 14 L44 14 C45.1 14 46 14.9 46 16 L46 40 C46 41.1 45.1 42 44 42 L40 42"
                  opacity="0.4"
                />
                <path
                  d="M18 24 L26 24 C27.1 24 28 24.9 28 26 L28 48 C28 49.1 27.1 50 26 50 L18 50 C16.9 50 16 49.1 16 48 L16 26 C16 24.9 16.9 24 18 24Z"
                  opacity="0.3"
                />
                <line x1="22" y1="30" x2="30" y2="30" opacity="0.2" />
                <line x1="22" y1="34" x2="30" y2="34" opacity="0.2" />
                <line x1="22" y1="38" x2="28" y2="38" opacity="0.2" />
                <path
                  d="M38 26 L42 22 M42 22 L46 26 M42 22 L42 34"
                  opacity="0.5"
                  strokeLinecap="round"
                />
              </svg>
            }
            headline="Empty canvas"
            description="Click a tool and drag on the canvas to create your first shape"
          />
        </div>
      )}
      {showOverlays && tool === 'inspect' && (
        <MeasureOverlay
          zoom={zoom}
          pan={pan}
          selectedNodes={editor.selectedNodes()}
          doc={doc}
          hoveredNode={hoveredNode}
        />
      )}
      <ZoomIndicator zoom={zoom} />
      <div
        className="editor-canvas__announcer"
        ref={announcerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom, pan }}
        viewport={canvasSize}
        walkNodes={(d) => walkNodes(d, activePageNodes(d))}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />
      {/* Accessible rename dialog — replaces blocking prompt() call */}
      <dialog
        ref={renameDialogRef}
        className="strata-dialog strata-dialog--sm"
        aria-labelledby="rename-dialog-title"
        onClose={() => setRenameDialog(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setRenameDialog(null);
        }}
      >
        <h2 id="rename-dialog-title" className="strata-dialog__title">
          Rename layer
        </h2>
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            const name = renameInputRef.current?.value.trim();
            if (name) editor.renameSelected(name);
            setRenameDialog(null);
          }}
        >
          <input
            ref={renameInputRef}
            className="canvas-rename__input"
            type="text"
            defaultValue={renameDialog?.defaultValue ?? ''}
            aria-label="Layer name"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="strata-dialog__actions">
            <button
              type="button"
              className="strata-btn strata-btn--ghost"
              onClick={() => setRenameDialog(null)}
            >
              Cancel
            </button>
            <button type="submit" className="strata-btn strata-btn--primary">
              Rename
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * HoverOutline — renders a thin outline around the hovered node to preview
 * what a click will select. Uses the same world-to-screen transform as the
 * selection overlay for pixel-perfect alignment.
 */
function HoverOutline({
  node,
  zoom,
  pan,
}: {
  node: SceneNode;
  zoom: number;
  pan: { x: number; y: number };
}) {
  const editor = useEditor();
  const bounds = editor.getWorldBounds(node.id);
  if (!bounds) return null;
  const [sx, sy] = simpleWorldToScreen(bounds.x, bounds.y, zoom, pan);
  const w = bounds.w * zoom;
  const h = bounds.h * zoom;
  const rotationDeg = (node.rotation * 180) / Math.PI;
  const centerX = sx + w / 2;
  const centerY = sy + h / 2;

  return (
    <svg
      role="presentation"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        touchAction: 'none',
      }}
    >
      <rect
        x={sx}
        y={sy}
        width={w}
        height={h}
        transform={rotationDeg ? `rotate(${rotationDeg}, ${centerX}, ${centerY})` : undefined}
        fill="none"
        stroke="var(--color-interactive-default)"
        strokeWidth={1}
        strokeDasharray="3 2"
        opacity={0.6}
      />
    </svg>
  );
}
