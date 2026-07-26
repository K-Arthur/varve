import { exportDocumentToSvg } from '@strata/codegen';
import { extractPalette as engineExtractPalette } from '@strata/engine';
import type { TextNode } from '@strata/scene';
import { executeNudge, getNudgeStep } from '../commands/nudge';
import type { EditorContextValue, ToolId } from '../context';
import { startTextEditing } from '../context';
import { harmonizeSpacing as applyHarmonize } from '../intelligence/spacingHarmonizer';

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
  onReopenLast?: () => void;
  onFindReplace?: () => void;
}

export function createActionHandlers(
  editor: EditorContextValue,
  callbacks?: ActionHandlerCallbacks,
): Record<string, () => void> {
  const e = editor;
  const cb = callbacks ?? {};

  const setTool = (tool: ToolId) => () => e.setTool(tool);
  const updateSelectedText = (update: (node: TextNode) => TextNode): void => {
    const selectedId = e.state.selection.length === 1 ? e.state.selection[0] : undefined;
    if (!selectedId) return;
    e.updateDoc((doc) => {
      const node = doc.nodes[selectedId];
      if (node?.kind !== 'text') return doc;
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [selectedId]: update(node),
        },
      };
    });
  };

  return {
    // ── Edit ──
    undo: () => e.undo(),
    redo: () => e.redo(),
    delete: () => e.removeSelected(),
    copy: () => e.copySelected(),
    cut: () => e.cutSelected(),
    paste: () => e.paste(),
    duplicate: () => e.duplicateSelected(),
    repeatDuplicate: () => e.repeatDuplicate(),
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
    reopenLast: () => cb.onReopenLast?.(),

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
    rulerModeArtboard: () => e.setRulerMode('artboard'),
    rulerModeGlobal: () => e.setRulerMode('global'),
    gridOverlayBaseline: () =>
      e.setGridOverlayMode(e.state.gridOverlayMode === 'baseline' ? 'none' : 'baseline'),
    gridOverlayIsometric: () =>
      e.setGridOverlayMode(e.state.gridOverlayMode === 'isometric' ? 'none' : 'isometric'),
    toggleSnap: () => e.setSnapEnabled(!e.state.snapEnabled),
    toggleGuidesVisible: () => e.toggleGuidesVisible(),
    toggleGuides: () => e.toggleGuidesVisible(),
    lockAllGuides: () => e.toggleLockAllGuides(),
    lockGuides: () => e.toggleLockAllGuides(),
    clearAllGuides: () => e.clearAllGuides(),
    clearGuides: () => e.clearAllGuides(),
    softProof: () => e.setSoftProofEnabled(!e.state.softProofEnabled),
    toggleLeftPanel: () => e.toggleLeftPanel(),
    toggleRightPanel: () => e.toggleRightPanel(),
    toggleTimelinePanel: () => e.toggleTimelinePanel(),
    toggleGraphEditor: () => e.toggleGraphEditor(),
    toggleStateMachinePanel: () => e.toggleStateMachinePanel(),
    toggleDistractionFree: () => e.toggleDistractionFreeMode(),
    toggleBeforeAfterCompare: () => e.toggleBeforeAfterCompare(),
    workspaceDesign: () => e.requestWorkspaceSwitch('design'),
    workspacePrint: () => e.requestWorkspaceSwitch('print'),
    workspaceDrawing: () => e.requestWorkspaceSwitch('drawing'),
    workspaceImage: () => e.requestWorkspaceSwitch('image'),
    workspaceMotion: () => e.requestWorkspaceSwitch('motion'),
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
    toolSmudge: setTool('smudge'),
    toolCrop: setTool('crop'),
    toolScale: setTool('scale'),
    toolSlice: setTool('slice'),
    toolCloneStamp: setTool('cloneStamp'),
    toolSam2Segment: setTool('sam2Segment'),

    // ── Object ──
    group: () => e.groupSelected(),
    ungroup: () => e.ungroupSelected(),
    createClippingMask: () => e.createClippingMaskFromSelected(),
    releaseClippingMask: () => e.releaseClippingMaskFromSelected(),
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
    harmonizeSpacing: () => {
      const sel = e.state.selection;
      if (sel.length < 3) return;
      e.updateDoc((doc) => applyHarmonize(doc, sel));
      e.announce?.('Spacing harmonized');
    },
    tidySelected: () => e.tidySelected?.(4),
    newAdjustmentLayer: () => e.createAdjustmentLayer(),
    openInspectorProperties: () => e.setInspectorTab('properties'),
    openAppearancePanel: () => e.setInspectorTab('appearance'),
    openAdjustmentsPanel: () => e.setInspectorTab('adjustments'),
    openPrototypePanel: () => e.setInspectorTab('prototype'),
    openDocumentPanel: () => {
      e.setSelection(null);
      e.setInspectorTab('properties');
    },
    openExportPanel: () => e.setInspectorTab('export'),
    openInspectPanel: () => {
      e.setTool('inspect');
      e.setInspectorTab('export');
    },
    openAuditPanel: () => e.setInspectorTab('audit'),
    runAudit: () => e.setInspectorTab('audit', 'audit'),
    auditSelection: () => e.setInspectorTab('audit', 'audit'),
    auditPage: () => e.setInspectorTab('audit', 'audit'),
    auditDocument: () => e.setInspectorTab('audit', 'audit'),
    scanDebt: () => e.setInspectorTab('audit', 'debt'),
    suggestNames: () => e.setInspectorTab('audit', 'naming'),
    detectDuplicates: () => e.setInspectorTab('audit', 'components'),
    booleanUnion: () => e.booleanOp('union'),
    booleanSubtract: () => e.booleanOp('subtract'),
    booleanIntersect: () => e.booleanOp('intersect'),
    booleanExclude: () => e.booleanOp('exclude'),
    upscaleImage: () => {
      const imageNode = e.state.selection
        .map((id) => e.state.document.nodes[id])
        .find(
          (n) => n?.kind === 'shape' && n.fills?.some((f) => f.type === 'image' && f.image?.src),
        );
      if (!imageNode) {
        e.announce?.('Select an image layer to upscale');
        return;
      }
      void e.upscaleSelectedImage({ scale: 4, method: 'ai' });
    },
    addAlphaMask: () => e.addMaskToSelected?.('alpha'),
    addClipMask: () => e.addMaskToSelected?.('clip'),
    addLuminanceMask: () => e.addMaskToSelected?.('luminance'),
    removeMask: () => e.removeMaskFromSelected?.(),
    toggleMask: () => e.toggleMask?.(),
    invertMask: () => e.invertMask?.(),
    rasterizeSelection: () => e.rasterizeSelected?.(1),
    mergeSelected: () => e.mergeSelected?.(),
    createMaster: () => {
      const page = e.state.document.pages?.find(
        (candidate) => candidate.id === e.state.currentPageId,
      );
      e.createMaster?.('Master', page?.width ?? 1920, page?.height ?? 1080);
    },
    applyMaster: () => {
      const activeId = e.state.currentPageId;
      const masterEntries = e.state.document.masters ? Object.keys(e.state.document.masters) : [];
      const firstMasterId = masterEntries[0];
      if (activeId && firstMasterId) {
        e.assignMasterToPage?.(activeId, firstMasterId);
      }
    },
    detachMaster: () => {
      const activeId = e.state.currentPageId;
      if (activeId) {
        e.assignMasterToPage?.(activeId, null);
      }
    },
    toggleFacingPages: () => e.toggleFacingPages?.(),
    nudgeUp: () => {
      const sel = e.state.selection;
      if (sel.length === 0) return;
      e.beginTransaction();
      executeNudge('up', getNudgeStep('standard'), {
        document: e.state.document,
        selection: sel,
        getNode: (id) => e.getNode(id),
        setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
      });
      e.commitTransaction();
    },
    nudgeDown: () => {
      const sel = e.state.selection;
      if (sel.length === 0) return;
      e.beginTransaction();
      executeNudge('down', getNudgeStep('standard'), {
        document: e.state.document,
        selection: sel,
        getNode: (id) => e.getNode(id),
        setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
      });
      e.commitTransaction();
    },
    nudgeLeft: () => {
      const sel = e.state.selection;
      if (sel.length === 0) return;
      e.beginTransaction();
      executeNudge('left', getNudgeStep('standard'), {
        document: e.state.document,
        selection: sel,
        getNode: (id) => e.getNode(id),
        setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
      });
      e.commitTransaction();
    },
    nudgeRight: () => {
      const sel = e.state.selection;
      if (sel.length === 0) return;
      e.beginTransaction();
      executeNudge('right', getNudgeStep('standard'), {
        document: e.state.document,
        selection: sel,
        getNode: (id) => e.getNode(id),
        setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
      });
      e.commitTransaction();
    },
    bindField: () => {
      if (e.focusedField) e.setBindingField(e.focusedField);
    },
    enterFrame: () => {
      const sel = e.state.selection;
      if (sel.length !== 1 || !sel[0]) return;
      const node = e.state.document.nodes[sel[0]!];
      if (!node) return;
      const containerKinds: string[] = ['group', 'frame'];
      if (containerKinds.includes((node as { kind: string }).kind)) {
        e.enterIsolation(node.id);
        e.announce?.(
          `Entered "${'name' in node ? (node as { name: string }).name : (node as { kind: string }).kind}"`,
        );
      }
    },
    editText: () => {
      const sel = e.state.selection;
      if (sel.length !== 1 || !sel[0]) return;
      const node = e.state.document.nodes[sel[0]!];
      if (node?.kind === 'text') {
        startTextEditing(node.id);
      }
    },

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

    // ── Motion Mode ──
    toggleOnionSkin: () => e.toggleOnionSkin(),
    addPositionKeyframe: () => e.addKeyframeToSelected('transform'),
    addRotationKeyframe: () => e.addKeyframeToSelected('rotation'),
    addScaleKeyframe: () => e.addKeyframeToSelected('transform'),
    addOpacityKeyframe: () => e.addKeyframeToSelected('opacity'),
    toggleAutoKeyframe: () => e.toggleAutoKeyframe(),
    playPause: () => {
      if (e.state.motion.isPlaying) e.pauseTimeline();
      else e.playTimeline();
    },
    stepForward: () => {
      const tlId = e.state.motion.activeTimelineId;
      if (!tlId) return;
      const tl = e.state.document.timelines?.[tlId];
      if (!tl) return;
      const step = 1000 / 60;
      e.seekTimeline(Math.min(tl.duration, e.state.motion.currentTime + step));
    },
    stepBackward: () => {
      const step = 1000 / 60;
      e.seekTimeline(Math.max(0, e.state.motion.currentTime - step));
    },
    stopTimeline: () => e.stopTimeline(),
    addKeyframe: () => {
      const sel = e.state.selection;
      if (sel.length > 0) {
        e.addKeyframeToSelected('opacity');
        e.addKeyframeToSelected('rotation');
      }
    },

    // ── Text Formatting ──
    textBold: () => {
      updateSelectedText((node) => ({
        ...node,
        fontWeight: (node.fontWeight ?? 400) >= 700 ? 400 : 700,
      }));
    },
    textItalic: () => {
      updateSelectedText((node) => ({
        ...node,
        fontStyle: node.fontStyle === 'italic' ? 'normal' : 'italic',
      }));
    },
    textUnderline: () => {
      updateSelectedText((node) => ({
        ...node,
        textDecoration: node.textDecoration === 'underline' ? 'none' : 'underline',
      }));
    },
    textIncreaseSize: () => {
      updateSelectedText((node) => ({ ...node, fontSize: node.fontSize * 1.2 }));
    },
    textDecreaseSize: () => {
      updateSelectedText((node) => ({ ...node, fontSize: Math.max(8, node.fontSize / 1.2) }));
    },
    textAlignLeft: () => {
      updateSelectedText((node) => ({ ...node, textAlign: 'left' }));
    },
    textAlignCenter: () => {
      updateSelectedText((node) => ({ ...node, textAlign: 'center' }));
    },
    textAlignRight: () => {
      updateSelectedText((node) => ({ ...node, textAlign: 'right' }));
    },
    textAlignJustify: () => {
      updateSelectedText((node) => ({ ...node, textAlign: 'justify' }));
    },
    textToOutlines: () => {
      const sel = e.state.selection;
      if (sel.length !== 1) return;
      e.convertTextToOutlines();
    },
    findReplace: () => {
      cb.onFindReplace?.();
    },

    // ── Other ──
    batchBgRemove: () => cb.onBatchBgRemove?.(),
    extractPalette: () => {
      const selected = e.state.selection;
      const imageNode = selected
        .map((id) => e.state.document.nodes[id])
        .find((n) => {
          const fills = (n as unknown as unknown as Record<string, unknown>)?.fills as unknown as
            | { type: string; image?: { src: string } }[]
            | undefined;
          return fills?.some((f) => f.type === 'image' && f.image?.src);
        });
      if (!imageNode) {
        e.announce?.('Select an image layer to extract palette');
        return;
      }
      const fills = (imageNode as unknown as Record<string, unknown>).fills as unknown as
        | { type: string; image?: { src: string } }[]
        | undefined;
      const src = fills?.find((f) => f.type === 'image')?.image?.src;
      if (!src) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = engineExtractPalette(data, 6);
        if (result.colors.length > 0) {
          e.announce?.(
            `Extracted ${result.colors.length} colors (${(result.coverage * 100).toFixed(0)}% coverage)`,
          );
        }
      };
      img.onerror = () => {
        e.announce?.('Failed to load image for palette extraction');
      };
      img.src = src;
    },
  };
}
