import { exportDocumentToSvg } from '@varve/codegen';
import { toDelimitedText } from '@varve/import';
import type { TextNode } from '@varve/scene';
import { executeNudge, getNudgeStep } from '../commands/nudge';
import type { EditorContextValue, ToolId } from '../context';
import { startTextEditing } from '../context';
import { harmonizeSpacing as applyHarmonize } from '../intelligence/spacingHarmonizer';
import { getLifecycleCoordinator } from '../lifecycle';

export interface ActionHandlerCallbacks {
  onOpenFile?: () => void;
  onImportFile?: () => void;
  onInsertIcon?: () => void;
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
  onCustomizeWorkspace?: () => void;
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
    copyProperties: () => e.copySelectedProperties(),
    pasteProperties: () => e.pastePropertiesToSelection(),
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
    selectNone: () => e.selectNone(),
    invertSelection: () => e.invertSelection(),
    selectParent: () => e.selectParent(),
    selectChildren: () => e.selectChildren(),
    selectSiblings: () => e.selectSiblings(),
    selectNextSibling: () => e.selectNextSibling(),
    selectPreviousSibling: () => e.selectPreviousSibling(),
    selectAllChildren: () => e.selectAllChildren(),
    selectAllWithSameStroke: () => e.selectAllWithSameStroke(),
    selectAllWithSameOpacity: () => e.selectAllWithSameOpacity(),
    selectAllWithSameBlendMode: () => e.selectAllWithSameBlendMode(),
    selectAllWithSameFont: () => e.selectAllWithSameFont(),
    selectAllWithSameCornerRadius: () => e.selectAllWithSameCornerRadius(),
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
    saveCopy: () => e.saveCopy(),
    documentInfo: () => e.setShowDocumentInfo(true),
    revealInFiles: () => {
      const active = e.state.sessions.find((sess) => sess.id === e.state.activeId);
      if (active?.filePath) void e.platform?.revealInFileManager(active.filePath);
    },
    copyFilePath: () => {
      const active = e.state.sessions.find((sess) => sess.id === e.state.activeId);
      if (!active?.filePath || typeof navigator === 'undefined') return;
      void navigator.clipboard.writeText(active.filePath).catch(() => undefined);
    },
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
    createTableFromClipboard: () => {
      e.openCreateTableFromDataDialog?.();
    },
    exportTableCsv: () => {
      // ADR-0016: export the selected table as formula-safe TSV (spreadsheet
      // paste format), preserving header rows and spans' text.
      const selectedId = e.state.selection.length === 1 ? e.state.selection[0] : undefined;
      if (!selectedId) return;
      const node = e.state.document.nodes[selectedId];
      if (node?.kind !== 'table') return;
      const table = node.table;
      const rows: string[][] = [];
      for (const rowId of table.rowOrder) {
        const cells: Array<{ text: string; col: number; span: number }> = [];
        for (const [key, cellId] of Object.entries(table.cellIndex)) {
          const cell = table.cells[cellId];
          if (!cell || cell.rowId !== rowId) continue;
          const m = /^(\d+),(\d+)$/.exec(key);
          if (!m) continue;
          cells.push({
            text: cell.content.kind === 'text' ? cell.content.text : '',
            col: Number(m[1]),
            span: cell.columnSpan,
          });
        }
        const rowLen = table.columnOrder.length;
        const out = new Array<string>(rowLen).fill('');
        for (const c of cells) {
          out[c.col] = c.text;
        }
        rows.push(out);
      }
      const tsv = toDelimitedText(rows, '\t', { escapeFormulas: true });
      const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${node.name || 'table'}.tsv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    home: () => cb.onBackToHome?.(),
    settings: () => cb.onOpenSettings?.(),
    reopenLast: () => cb.onReopenLast?.(),
    insertIcon: () => cb.onInsertIcon?.(),

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
    linkTextFrames: () => e.linkSelectedTextFrames(),
    unlinkTextFrames: () => e.unlinkSelectedTextFrames(),
    fitActivePage: () => e.fitActivePage(),
    fitSpread: () => e.fitSpread(),
    fitAllPages: () => e.fitAllPages(),
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
    toggleBleedGuides: () => e.setBleedGuidesVisible(!e.state.bleedGuidesVisible),
    toggleFindingsOverlay: () => e.setFindingsOverlayVisible(!e.state.findingsOverlayVisible),
    toggleFindingsProviderContrast: () => e.setFindingsProviderOverride('contrast'),
    toggleFindingsProviderVectorIssues: () => e.setFindingsProviderOverride('vector-issues'),
    toggleFindingsProviderDpiWarnings: () => e.setFindingsProviderOverride('dpi-warnings'),
    toggleLeftPanel: () => e.toggleLeftPanel(),
    toggleRightPanel: () => e.toggleRightPanel(),
    toggleLibraryPanel: () => e.toggleLibraryPanel(),
    toggleCodegenPanel: () => e.toggleCodegenPanel(),
    toggleLogoPanel: () => e.toggleLogoPanel(),
    toggleTimelinePanel: () => e.toggleTimelinePanel(),
    toggleHistoryPanel: () => e.toggleHistoryPanel(),
    restoreAllPanels: () => e.restoreAllPanels(),
    toggleGraphEditor: () => e.toggleGraphEditor(),
    toggleStateMachinePanel: () => e.toggleStateMachinePanel(),
    toggleDistractionFree: () => e.toggleDistractionFreeMode(),
    toggleBeforeAfterCompare: () => e.toggleBeforeAfterCompare(),
    workspaceDesign: () => e.requestWorkspaceSwitch('design'),
    workspacePrint: () => e.requestWorkspaceSwitch('print'),
    workspaceDrawing: () => e.requestWorkspaceSwitch('drawing'),
    workspaceImage: () => e.requestWorkspaceSwitch('image'),
    workspaceMotion: () => e.requestWorkspaceSwitch('motion'),
    workspaceCodegen: () => e.requestWorkspaceSwitch('codegen'),
    workspaceLogo: () => e.requestWorkspaceSwitch('logo'),
    resetWorkspace: () => e.resetWorkspaceToDefault(),
    resetAllWorkspaces: () => e.resetAllWorkspacesToDefaults(),
    canvasModeOutline: () => e.setCanvasMode('outline'),
    canvasModePreview: () => e.setCanvasMode('preview'),
    canvasModeFull: () => {
      if (e.state.canvasMode !== 'full') e.setCanvasMode('full');
    },
    inspectMode: () => e.setTool(e.state.tool === 'inspect' ? 'select' : ('inspect' as ToolId)),
    toggleGrid: () => {
      const dg = e.state.documentGrid;
      e.setDocumentGrid({ ...dg, visible: !dg.visible });
    },
    togglePixelGrid: () => e.setPixelGridEnabled(!e.state.pixelGridEnabled),
    togglePixelGridSnap: () => e.setPixelGridSnapEnabled(!e.state.pixelGridSnapEnabled),
    resetGridOrigin: () => {
      const dg = e.state.documentGrid;
      e.setDocumentGrid({ ...dg, offsetX: 0, offsetY: 0 });
    },
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
    toolPage: setTool('page'),

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
    openFontsPanel: () => e.setInspectorTab('fonts'),
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
    expandStroke: () => e.expandStrokeSelected(),
    offsetPath: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const raw = await promptDialog('Offset path distance (px)', '-8');
      if (raw === null) return;
      const distance = Number.parseFloat(raw);
      if (!Number.isFinite(distance)) return;
      e.offsetPathSelected(distance);
    },
    roundCorners: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const raw = await promptDialog('Round path corners (radius px)', '8');
      if (raw === null) return;
      const radius = Number.parseFloat(raw);
      if (!Number.isFinite(radius) || radius <= 0) return;
      e.roundCornersSelected(radius);
    },
    simplifyPath: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const raw = await promptDialog('Simplify path (tolerance px)', '2');
      if (raw === null) return;
      const tolerance = Number.parseFloat(raw);
      if (!Number.isFinite(tolerance) || tolerance <= 0) return;
      e.simplifyPathSelected(tolerance);
    },
    mirrorDuplicateHorizontal: () => e.mirrorDuplicateSelected('horizontal'),
    mirrorDuplicateVertical: () => e.mirrorDuplicateSelected('vertical'),
    radialDuplicate: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const raw = await promptDialog('Radial duplicate count', '8');
      if (raw === null) return;
      const count = Number.parseInt(raw, 10);
      if (!Number.isFinite(count) || count < 2) return;
      e.radialDuplicateSelected(count);
    },
    newLogoProject: () => e.newLogoProject(),
    createLogoConcept: () => e.createLogoConcept(),
    duplicateLogoConcept: () => e.duplicateActiveConcept(),
    createLogoVariant: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const raw = await promptDialog('Variant name', 'Icon');
      if (raw === null) return;
      e.createLogoVariant(raw || 'Variant', 'custom');
    },
    createMonochromeVariant: () => e.createLogoVariant('Monochrome', 'monochrome'),
    createReversedVariant: () => e.createLogoVariant('Reversed', 'reversed'),
    createIconVariant: () => e.createLogoVariant('Icon', 'icon'),
    createSmallVariant: () => e.createLogoVariant('Small', 'small'),
    logoPreview: () => e.patch({ logoPreviewDialogOpen: !e.state.logoPreviewDialogOpen }),
    exportLogoPackage: async () => {
      const { buildLogoPackage, saveLogoPackage } = await import('../logo/logoPackageExport');
      const doc = e.state.document;
      if (!doc.logoProject) {
        e.announce?.('Create a logo project first (File → New Logo Project)');
        return;
      }
      e.announce?.('Building logo package…');
      try {
        const result = await buildLogoPackage(doc, {
          brandName: doc.logoProject.name,
          includeVariants: true,
          scales: [1, 2],
        });
        const saved = await saveLogoPackage(e.platform, result);
        e.announce?.(saved ? 'Logo package exported' : 'Logo package ready to download');
      } catch (error) {
        console.error('Logo package export failed', error);
        e.announce?.('Logo package export failed — check the console for details');
      }
    },
    addClearSpaceGuides: async () => {
      const { promptDialog } = await import('../components/PromptDialog');
      const artboardId = e.state.selection.find(
        (id) => e.state.document.nodes[id]?.kind === 'frame',
      );
      const artboard = artboardId ? e.state.document.nodes[artboardId] : undefined;
      const size = artboard && 'w' in artboard ? (artboard.w ?? 1024) : 1024;
      const raw = await promptDialog('Clear-space gap (px)', String(Math.round(size / 4)));
      if (raw === null) return;
      const gap = Number.parseFloat(raw);
      if (!Number.isFinite(gap) || gap < 0) return;
      e.addClearSpaceGuides(gap);
    },
    upscaleImage: () => {
      const imageNode = e.state.selection
        .map((id) => e.state.document.nodes[id])
        .find(
          (n) => n?.kind === 'shape' && n.fills?.some((f) => f.type === 'image' && f.image?.src),
        );
      if (!imageNode) {
        e.announce?.('Select an image layer to enhance');
        return;
      }
      e.openUpscaleDialog();
    },
    imageTrace: () => {
      const imageNode = e.state.selection
        .map((id) => e.state.document.nodes[id])
        .find(
          (n) => n?.kind === 'shape' && n.fills?.some((f) => f.type === 'image' && f.image?.src),
        );
      if (!imageNode) {
        e.announce?.('Select an image layer to vectorize');
        return;
      }
      e.openVectorizeDialog();
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
      // With no focused field, bind the selected node's fill — the primary
      // color-binding target (ADR-0016).
      else if (e.state.selection.length > 0) e.setBindingField('fill');
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
    // Close Document (Ctrl/Cmd+W) routes through the termination
    // coordinator: dirty work resolves via the shared dialog, never a
    // native confirm() (ADR-0216 D5).
    tabClose: () => {
      const coordinator = getLifecycleCoordinator();
      if (coordinator) {
        void coordinator.requestTermination('close-document', 'shortcut');
        return;
      }
      if (!e.closeTab(e.state.activeId)) {
        const sess = e.state.sessions.find((s) => s.id === e.state.activeId);
        if (confirm(`Close "${sess?.name ?? 'Untitled'}"? Unsaved changes will be lost.`)) {
          e.closeTab(e.state.activeId, true);
        }
      }
    },
    // Close Window (Ctrl+Shift+W) and Quit Varve (Ctrl+Q) — same guard.
    closeWindow: () => {
      getLifecycleCoordinator()?.requestTermination('close-window', 'shortcut');
    },
    quitApp: () => {
      getLifecycleCoordinator()?.requestTermination('quit-application', 'shortcut');
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
    customizeWorkspace: () => {
      cb.onCustomizeWorkspace?.();
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
      // The dialog owns the count choice (3-12 colors) and the analysis.
      e.openPaletteExtract(src);
    },
  };
}
