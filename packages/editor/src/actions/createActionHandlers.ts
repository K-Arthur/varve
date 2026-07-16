import { exportDocumentToSvg } from '@strata/codegen';
import type { EditorContextValue, ToolId } from '../context';

export interface ActionHandlerCallbacks {
  onOpenFile?: () => void;
  onImportFile?: () => void;
  onBackToHome?: () => void;
  onOpenSettings?: () => void;
  onStartTour?: () => void;
  onOpenPalette?: () => void;
  onOpenHelp?: () => void;
  onOpenHelpCenter?: () => void;
  onWhatIsThis?: () => void;
  onOpenAbout?: () => void;
  onBatchBgRemove?: () => void;
}

export function createActionHandlers(
  editor: EditorContextValue,
  callbacks?: ActionHandlerCallbacks,
): Record<string, () => void> {
  const e = editor;
  const cb = callbacks ?? {};

  const setTool = (tool: ToolId) => () => e.setTool(tool);

  return {
    // ── Edit ──
    undo: () => e.undo(),
    redo: () => e.redo(),
    delete: () => e.removeSelected(),
    copy: () => e.copySelected(),
    cut: () => e.cutSelected(),
    paste: () => e.paste(),
    duplicate: () => e.duplicateSelected(),
    selectAll: () => {
      const nodes = e.rootNodes();
      if (nodes.length === 0) return;
      e.setSelection(nodes[0]?.id ?? null);
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i];
        if (n) e.toggleSelection(n.id, true);
      }
      e.announceSelection(nodes);
    },
    selectionHistoryBack: () => e.selectPreviousSelection(),
    selectionHistoryForward: () => e.selectNextSelection(),
    flipH: () => e.setSelectedFlipH(),
    flipV: () => e.setSelectedFlipV(),

    // ── File ──
    newDocument: () => e.newDocument(),
    open: () => cb.onOpenFile?.(),
    import: () => cb.onImportFile?.(),
    save: () => e.save(),
    saveAs: () => e.saveAs(),
    exportSvg: () => {
      const svg = exportDocumentToSvg(e.state.document);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${e.state.document.name || 'untitled'}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    },
    export: () => e.setShowExportDialog(true),
    home: () => cb.onBackToHome?.(),
    settings: () => cb.onOpenSettings?.(),

    // ── View / Zoom ──
    zoomReset: () => e.zoomTo(1),
    zoomIn: () => e.zoomIn(),
    zoomOut: () => e.zoomOut(),
    zoom50: () => e.zoomTo(0.5),
    zoom75: () => e.zoomTo(0.75),
    zoom100: () => e.zoomTo(1),
    zoom150: () => e.zoomTo(1.5),
    zoom200: () => e.zoomTo(2),
    zoom400: () => e.zoomTo(4),
    fitAll: () => e.fitAll(),
    fitSelection: () => e.revealSelection({ fit: true }),
    fitActivePage: () => e.fitActivePage(),
    fitActiveFrame: () => e.fitActiveFrame(),
    resetViewRotation: () => e.resetViewRotation(),
    rotateViewCW: () => e.rotateViewBy(Math.PI / 12),
    rotateViewCCW: () => e.rotateViewBy(-Math.PI / 12),
    toggleRulerMode: () => e.setRulerMode(e.state.rulerMode === 'artboard' ? 'global' : 'artboard'),
    gridOverlayBaseline: () =>
      e.setGridOverlayMode(e.state.gridOverlayMode === 'baseline' ? 'none' : 'baseline'),
    gridOverlayIsometric: () =>
      e.setGridOverlayMode(e.state.gridOverlayMode === 'isometric' ? 'none' : 'isometric'),
    toggleSnap: () => e.setSnapEnabled(!e.state.snapEnabled),
    toggleGuidesVisible: () => e.toggleGuidesVisible(),
    lockAllGuides: () => e.toggleLockAllGuides(),
    clearAllGuides: () => e.clearAllGuides(),
    softProof: () => e.setSoftProofEnabled(!e.state.softProofEnabled),
    toggleLeftPanel: () => e.toggleLeftPanel(),
    toggleRightPanel: () => e.toggleRightPanel(),
    toggleTimelinePanel: () => e.toggleTimelinePanel(),
    toggleDistractionFree: () => e.toggleDistractionFreeMode(),
    toggleBeforeAfterCompare: () => e.toggleBeforeAfterCompare(),
    workspaceDesign: () => e.setWorkspaceMode('design'),
    workspacePrint: () => e.setWorkspaceMode('print'),
    workspaceDrawing: () => e.setWorkspaceMode('drawing'),
    workspaceImage: () => e.setWorkspaceMode('image'),
    resetWorkspace: () => e.resetWorkspaceToDefault(),
    canvasModeOutline: () => e.setCanvasMode('outline'),
    canvasModePreview: () => e.setCanvasMode('preview'),
    canvasModeFull: () => {
      if (e.state.canvasMode !== 'full') e.setCanvasMode('full');
    },
    inspectMode: () => e.setTool(e.state.tool === 'inspect' ? 'select' : ('inspect' as ToolId)),
    togglePixelGrid: () => e.setPixelGridEnabled(!e.state.pixelGridEnabled),
    colorBlindnessNone: () => e.setColorBlindnessView('none'),
    colorBlindnessProtanopia: () => e.setColorBlindnessView('protanopia'),
    colorBlindnessDeuteranopia: () => e.setColorBlindnessView('deuteranopia'),
    colorBlindnessTritanopia: () => e.setColorBlindnessView('tritanopia'),

    // ── Tools ──
    toolSelect: setTool('select'),
    toolFrame: setTool('frame'),
    toolRect: setTool('rect'),
    toolEllipse: setTool('ellipse'),
    toolLine: setTool('line'),
    toolArrow: setTool('arrow'),
    toolPen: setTool('pen'),
    toolPencil: setTool('pencil'),
    toolText: setTool('text'),
    toolHand: setTool('hand'),
    toolZoom: setTool('zoom'),
    toolInspect: setTool('inspect'),
    toolPaint: setTool('paint'),
    toolEraser: setTool('eraser'),

    // ── Object ──
    group: () => e.groupSelected(),
    ungroup: () => e.ungroupSelected(),
    bringFront: () => e.arrangeSelected('front'),
    sendBack: () => e.arrangeSelected('back'),
    bringForward: () => e.arrangeSelected('forward'),
    sendBackward: () => e.arrangeSelected('backward'),
    alignLeft: () => e.alignSelected('left'),
    alignCenterH: () => e.alignSelected('centerH'),
    alignRight: () => e.alignSelected('right'),
    alignTop: () => e.alignSelected('top'),
    alignCenterV: () => e.alignSelected('centerV'),
    alignBottom: () => e.alignSelected('bottom'),
    distributeHorizontal: () => e.distributeSelected('horizontal'),
    distributeVertical: () => e.distributeSelected('vertical'),
    booleanUnion: () => e.booleanOp('union'),
    booleanSubtract: () => e.booleanOp('subtract'),
    booleanIntersect: () => e.booleanOp('intersect'),
    booleanExclude: () => e.booleanOp('exclude'),
    nudgeUp: () => {},
    nudgeDown: () => {},
    nudgeLeft: () => {},
    nudgeRight: () => {},
    bindField: () => {
      if (e.focusedField) e.setBindingField(e.focusedField);
    },
    enterFrame: () => {},
    editText: () => {},

    // ── Tabs ──
    tabNew: () => e.newTab(),
    tabClose: () => {
      if (!e.closeTab(e.state.activeId)) {
        const sess = e.state.sessions.find((s) => s.id === e.state.activeId);
        if (confirm(`Close "${sess?.name ?? 'Untitled'}"? Unsaved changes will be lost.`)) {
          e.closeTab(e.state.activeId, true);
        }
      }
    },
    tabNext: () => {
      const { sessions, activeId } = e.state;
      const idx = sessions.findIndex((s) => s.id === activeId);
      const next = sessions[(idx + 1) % sessions.length];
      if (next) e.switchTab(next.id);
    },
    tabPrev: () => {
      const { sessions, activeId } = e.state;
      const idx = sessions.findIndex((s) => s.id === activeId);
      const prev = sessions[(idx - 1 + sessions.length) % sessions.length];
      if (prev) e.switchTab(prev.id);
    },

    // ── UI ──
    shortcutPalette: () => cb.onOpenPalette?.(),
    quickActions: () => {},
    present: () => {
      if (e.state.prototypeMode) {
        e.stopPresentation();
      } else {
        e.startPresentation();
      }
    },
    new: () => e.newDocument(),

    // ── Help ──
    openHelp: () => cb.onOpenHelp?.(),
    openHelpCenter: () => cb.onOpenHelpCenter?.(),
    whatIsThis: () => cb.onWhatIsThis?.(),
    about: () => cb.onOpenAbout?.(),
    startTour: () => cb.onStartTour?.(),

    // ── Other ──
    batchBgRemove: () => cb.onBatchBgRemove?.(),
  };
}
