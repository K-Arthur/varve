/**
 * CanvasOverlays — extracted overlay composition from CanvasArea.
 *
 * Renders all overlay components (rulers, guides, selections, edit overlays,
 * accessibility tree, etc.) that sit on top of the main canvas content layer.
 *
 * Research basis: Extracted from CanvasArea (3415 lines) to reduce cognitive
 * load and make overlay composition independently testable.
 */

import type { CollabUser } from '@varve/collab';
import type { MeshWarp } from '@varve/engine';
import type { Document, Fill, IsometricGrid, NodeId, SceneNode } from '@varve/scene';
import { activePageNodes, walkNodes } from '@varve/scene';
import type { RulerMode } from '@varve/shared';
import { computeFloatingOrigin, isWorldRectInViewport, worldToScreen } from '@varve/shared';

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
import { CreateTableFromDataDialog } from './CreateTableFromDataDialog';
import { CropOverlay } from './CropOverlay';
import { DocumentGridOverlay } from './DocumentGridOverlay/DocumentGridOverlay';
import { FloatingTextBar } from './FloatingTextBar/FloatingTextBar';
import { GradientHandleOverlay } from './GradientHandleOverlay';
import { GuideOverlay } from './GuideOverlay/GuideOverlay';
import { MeshWarpOverlay } from './MeshWarpOverlay';
import { MotionPathOverlay } from './MotionPathOverlay';
import { NodeEditOverlay } from './NodeEditOverlay';
import { OnionSkinOverlay } from './OnionSkinOverlay';
import { PagePrintOverlays } from './PagePrintOverlays';
import { PageToolOverlay } from './PageToolOverlay';
import { Ruler } from './Ruler/Ruler';
import { SelectionQuickBarHost } from './SelectionQuickBar/SelectionQuickBarHost';
import { SnapGuidesOverlay } from './SnapGuidesOverlay';
import { MeasureOverlay } from './SpecPanel/MeasureOverlay';
import { TableCellEditor } from './TableEditOverlay/TableCellEditor';
import { TableEditOverlay } from './TableEditOverlay/TableEditOverlay';
import { TextEditOverlay } from './TextEditOverlay';
import { TextThreadOverlay } from './TextThreadOverlay';
import { VariantBox } from './VariantBox/VariantBox';
import { WarpOverlay } from './WarpOverlay';
import { ZoomIndicator } from './ZoomIndicator';

export interface CanvasOverlaysProps {
  contentCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  announcerRef: React.RefObject<HTMLDivElement | null>;
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
  bleedGuidesVisible: boolean;
  layoutGridVisible: boolean;
  selectedGuideId: string | null;
  unitType: 'px' | 'pt' | 'mm' | 'cm' | 'in' | '%';
  rulerMode?: RulerMode;
  collabUsers: CollabUser[];
  stubRemoteCursors: RemoteCursor[];
  snapGuides: SnapGuide[];
  nodeEditTargetId: string | null;
  nodeEditSelectedAnchors: ReadonlySet<number>;
  textEditTargetId: string | null;
  setTextEditTargetId: (id: string | null) => void;
  setNodeEditTargetId: (id: string | null) => void;
  warpMesh: MeshWarp | null;
  setWarpMesh: (mesh: MeshWarp | null) => void;
  hoveredNode: SceneNode | null;
  canvasSize: { width: number; height: number };
  cropTool: CropTool | null;
  buildToolCtx: (ev: PointerEvent) => import('../tools').ToolContext;
  renameDialog: { defaultValue: string } | null;
  setRenameDialog: (v: { defaultValue: string } | null) => void;
  renameDialogRef: React.RefObject<HTMLDialogElement | null>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  artboardRect: { x: number; y: number; w: number; h: number } | null;
}

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
  bleedGuidesVisible,
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

  const baselineGrid = doc.gridSettings?.baselineGrids
    ? Object.values(doc.gridSettings.baselineGrids)[0]
    : undefined;

  const showGridOverlay = gridOverlayMode !== 'none';
  const isometricGrid: IsometricGrid | null = (() => {
    if (gridOverlayMode !== 'isometric') return null;
    const grids = doc.gridSettings?.isometricGrids;
    if (!grids) return null;
    const entries = Object.values(grids);
    return entries[0] ?? null;
  })();

  const showColorBlindness = colorBlindnessView !== 'none';

  const nodeEditNode = tool === 'nodeEdit' && nodeEditTargetId ? doc.nodes[nodeEditTargetId] : null;
  const nodeEditWorldMat =
    nodeEditNode?.kind === 'shape' && nodeEditNode.shape.kind === 'path' && nodeEditTargetId
      ? editor.getWorldTransform(nodeEditTargetId)
      : null;

  const showGradientHandles = selection.length >= 1;

  const showMeshWarp = warpMesh !== null && selection.length >= 1;

  const renderVariantBox = (() => {
    if (selection.length !== 1) return null;
    const singleId = selection[0] as NodeId;
    const singleNode = doc.nodes[singleId];
    if (singleNode?.kind !== 'frame') return null;
    const frame = singleNode;
    if (!frame.componentId) return null;
    const component = doc.components[frame.componentId];
    if (!component) return null;
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

  const renderCropOverlay = (() => {
    if (tool !== 'crop' || !cropTool) return null;
    const cropNodeId = cropTool.getNodeId();
    if (!cropNodeId) return null;
    const worldB = editor.getWorldBounds(cropNodeId);
    if (!worldB) return null;
    const { x: screenX, y: screenY } = editor.worldToCanvas(worldB.x, worldB.y);
    const cropNode = doc.nodes[cropNodeId];
    const cropImageFill =
      cropNode && 'fills' in cropNode
        ? (cropNode.fills ?? []).find((f) => f.type === 'image')?.image
        : undefined;
    const imageSrc = cropImageFill?.src;
    const imageWidth = cropImageFill?.imageWidth;
    const imageHeight = cropImageFill?.imageHeight;
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

  return (
    <>
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
          isometricGrid={isometricGrid}
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
      {editor.state.warpEdit && (
        <WarpOverlay zoom={zoom} pan={pan} cameraRotation={cameraRotation} />
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
      {editor.state.createTableFromDataOpen && <CreateTableFromDataDialog />}
      {editor.state.tableEdit?.editingCellId && (
        <TableCellEditor
          cellId={editor.state.tableEdit.editingCellId}
          zoom={zoom}
          worldToScreen={(wx, wy) => {
            const pt = editor.worldToCanvas(wx, wy);
            return [pt.x, pt.y] as [number, number];
          }}
          onDone={() => {
            const te = editor.state.tableEdit;
            if (te) editor.setTableEdit({ ...te, editingCellId: null });
          }}
        />
      )}
      {editor.state.tableEdit && (
        <TableEditOverlay
          zoom={zoom}
          pan={pan}
          cameraRotation={cameraRotation ?? 0}
          worldToScreen={(wx, wy) => {
            const pt = editor.worldToCanvas(wx, wy);
            return [pt.x, pt.y] as [number, number];
          }}
        />
      )}
      {renderCropOverlay}
      {renderTextEdit}
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
      <PageToolOverlay
        document={doc}
        activePageId={editor.state.document.activePageId ?? null}
        tool={tool}
        zoom={zoom}
        worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
      />
      <TextThreadOverlay
        document={doc}
        selection={selection}
        worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
      />
      {bleedGuidesVisible && (
        <PagePrintOverlays
          document={doc}
          zoom={zoom}
          worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
        />
      )}
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
      <dialog
        ref={renameDialogRef}
        className="varve-dialog varve-dialog--sm"
        aria-labelledby="rename-dialog-title"
        onClose={() => setRenameDialog(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setRenameDialog(null);
        }}
      >
        <h2 id="rename-dialog-title" className="varve-dialog__title">
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
          <div className="varve-dialog__actions">
            <button
              type="button"
              className="varve-btn varve-btn--ghost"
              onClick={() => setRenameDialog(null)}
            >
              Cancel
            </button>
            <button type="submit" className="varve-btn varve-btn--primary">
              Rename
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
