// COMPLEXITY: 49 imports (ceiling 49). Merged duplicate @varve/scene and @varve/ui imports.
// Plan: Refactor to move SubjectPickerOverlay and other overlay imports to a dedicated overlay registry module.
import { HelpBrowser } from '@varve/help';
import type { Platform } from '@varve/platform';
import { type Document, getAllRules, registerBuiltinRules, type SceneNode } from '@varve/scene';
import { ContextMenu, Icon, ToastProvider, Tooltip, useToast } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openVarveContact,
  registerAllShortcuts,
  registerEditorActions,
} from './actions/registerAll';
import { AuditOverlayHost } from './audit/overlay/AuditOverlayHost';
import { CanvasArea } from './CanvasArea';
import { cancelPasteFallback, captureClipboardEvent } from './clipboard';
import { SubjectPickerOverlay } from './components/BackgroundRemoval/SubjectPickerOverlay';
import { SelectionBreadcrumb } from './components/Breadcrumb/SelectionBreadcrumb';
import { CodePanel } from './components/CodePanel/CodePanel';
import { CollabCursorOverlay } from './components/CollabCursorOverlay/CollabCursorOverlay';
import { ContentAwareFillDialog } from './components/ContentAwareFill';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { MissingFontController } from './components/FontBrowser/MissingFontController';
import { HistoryPanel } from './components/HistoryPanel';
import { ImageCompareOverlay } from './components/ImageCompareOverlay';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import type { LayersDnDHandle } from './components/LayersPanel/LayersTree';
import { PresenceIndicator } from './components/LayersPanel/PresenceIndicator';
import { LogoPanel } from './components/LogoPanel/LogoPanel';
import { LogoPreviewDialog } from './components/LogoPreview/LogoPreviewDialog';
import { MasterPanel } from './components/MasterPanel/MasterPanel';
import { Menubar } from './components/Menubar';
import { MinimapPanel } from './components/Minimap/MinimapPanel';
import { PageNav } from './components/PageNav/PageNav';
import { PagesPanel } from './components/PagesPanel/PagesPanel';
import { PanelResizeHandle, usePanelWidths } from './components/PanelResizeHandle';
import { ConfirmDialog, PromptDialog, promptDialog } from './components/PromptDialog';
import { PrototypePresenter } from './components/Prototype/PrototypePresenter';
import { QuickActionsBar } from './components/QuickActionsBar/QuickActionsBar';
import { IconBrowserDialog, ResourcesPanel } from './components/ResourcesPanel/ResourcesPanel';
import { SelectionInfoBar } from './components/SelectionInfoBar';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import {
  ColorConversionHost,
  DnDShell,
  ExportLayer,
  type ExportLayerHandle,
  FindReplaceLayer,
  type FindReplaceLayerHandle,
  ImageResizeDialogHost,
  ImportProgress,
  ImportResults,
  OnboardingLayer,
  type OnboardingLayerHandle,
  ThumbnailPickerHost,
  VectorizeDialogHost,
} from './components/Shell';
import { UpscaleDialogHost } from './components/Upscale/UpscaleDialogHost';
import { LifecycleProvider } from './lifecycle';
import { buildCanvasContextMenuItems } from './menu/canvasContextMenu';
import './components/Shell/shellStyles.css';
import { SoftProofOverlay } from './components/SoftProofOverlay';
import { SpreadSettings } from './components/SpreadSettings/SpreadSettings';
import { StateMachinePanel } from './components/StateMachinePanel';
import { WorkspaceCustomizeDialog } from './components/WorkspaceCustomizeDialog';
import { EditorProvider, setToastHandler, useEditor } from './context';
import { useCollabPresence } from './hooks/useCollabPresence';
import { LayersPanel } from './LayersPanel';
import { ContextualHelpPanel, resetOnboarding, useEditorHelp, WhatIsThis } from './onboard';
import { StatusBar } from './StatusBar';
import { nodeLocalBounds } from './scene/world';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';
import { TimelinePanel } from './timeline/TimelinePanel';
import {
  editorHeadingLabel,
  useDetachedPanels,
  useEffectiveWorkspaceConfig,
  useFitOnFirstDocument,
  useWorkspacePanelWidths,
} from './workspace/shellHooks';

/** A request to open a file into a tab; bump `seq` for each dispatch. */
export interface OpenFileRequest {
  id: string;
  name: string;
  filePath?: string;
  /** Document JSON, or null for a fresh blank document. */
  json: string | null;
  /** True when the request came from the app-managed Home library. */
  libraryStorage?: boolean;
  seq: number;
}

export interface ShellProps {
  onBackToHome?: () => void;
  documentJson?: string;
  documentName?: string;
  /** Identity of the file `documentJson` came from, so the bootstrap session
   *  is recognisable to openFile's dedupe rather than being duplicated. */
  documentFileId?: string;
  documentFilePath?: string;
  /** Whether the bootstrap document is bound to app-managed library storage. */
  documentLibraryStorage?: boolean;
  /** File-open requests from the host app (home screen). */
  openFile?: OpenFileRequest | null;
  /** False while the editor is hidden behind the home screen — suspends
   *  global keyboard shortcuts so Home doesn't trigger editor actions. */
  active?: boolean;
  /** The platform facade (Tauri/web/memory) — used for native-storage-backed
   *  persistence (e.g. onboarding-complete) rather than raw localStorage. */
  platform?: Platform;
  /**
   * Frame the whole document once, the first time one is loaded.
   *
   * Off by default: opening a document at its stored zoom is the right
   * behaviour for someone returning to their own work. It exists for hosts
   * that open a document the viewer has never seen — the browser demo seeds a
   * 1200x800 poster, which at 100% zoom shows only its top-left corner.
   */
  fitOnOpen?: boolean;
}

function ShellInner({
  onBackToHome,
  openFile,
  platform,
  active = true,
  fitOnOpen = false,
}: {
  onBackToHome?: () => void;
  openFile?: OpenFileRequest | null;
  platform?: Platform;
  active?: boolean;
  fitOnOpen?: boolean;
}) {
  const editor = useEditor();
  useFitOnFirstDocument(editor, fitOnOpen && active);
  const editorHelp = useEditorHelp(editor.state.tool);
  const { isDetached } = useDetachedPanels(editor);
  const { paletteOpen, closePalette, openPalette, quickActionsOpen, setQuickActionsOpen } =
    useShortcuts(editor, onBackToHome, active, {
      onOpenContextualHelp: editorHelp.openContextualHelp,
      onOpenHelpCenter: () => editorHelp.setHelpCenterOpen(true),
    });
  const [paletteFocusShortcutId, setPaletteFocusShortcutId] = useState<string | undefined>();
  const [selectedKeyframe, setSelectedKeyframe] = useState<{
    trackId: string;
    index: number;
  } | null>(null);

  const { presences: collabPresences, users: collabUsers } = useCollabPresence(
    editor.state.activeId,
    editor.state.cursorPos,
    editor.state.pan,
  );

  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleCanvasContextMenu = useCallback((pos: { x: number; y: number }) => {
    setCanvasContextMenu(pos);
  }, []);

  // Record tool selections for intelligence features (adaptive UI, onboarding, etc.)
  useEffect(() => {
    editor.recordAction(`tool:${editor.state.tool}`);
  }, [editor.state.tool]);

  // ── Lifecycle event handlers ─────────────────────────────────────────────

  // Native paste event listener (cross-platform, works on Wayland).
  // Captures clipboard data from the DOM event directly, bypassing
  // the permission-gated `navigator.clipboard.read()` Web API.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as ClipboardEvent;
      // Skip if the event target is an input/textarea (browser default is fine)
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      // The real ClipboardEvent arrived — the keydown-scheduled fallback
      // (useShortcuts) must not also run the paste action.
      cancelPasteFallback();
      captureClipboardEvent(ce);
      // Let the editor paste handler process the captured event data
      editor.paste();
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [editor]);

  // Test-only: allow direct LUT import via custom event (bypasses file input)
  useEffect(() => {
    // Expose a global function for E2E tests to call directly
    const win = window as unknown as Record<
      string,
      (adj: import('@varve/engine').Adjustment) => void
    >;
    win.__importLut = (adj) => {
      editor.addLutAdjustment(adj);
    };
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const { adjustment } = ce.detail ?? {};
      if (adjustment) editor.addLutAdjustment(adjustment);
    };
    window.addEventListener('strata:test-import-lut', handler);
    return () => {
      delete (window as unknown as Record<string, unknown>).__importLut;
      window.removeEventListener('strata:test-import-lut', handler);
    };
  }, [editor]);

  // Dispatch host file-open requests into tabs (dedupe/reuse handled by
  // editor.openFile). seq guards against re-dispatch on unrelated re-renders.
  const lastOpenSeq = useRef(0);
  useEffect(() => {
    if (!openFile || openFile.seq === lastOpenSeq.current) return;
    lastOpenSeq.current = openFile.seq;
    editor.openFile(
      openFile.id,
      openFile.name,
      openFile.filePath,
      openFile.json,
      openFile.libraryStorage,
    );
  }, [openFile, editor]);
  const fileRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [importReport, setImportReport] = useState<import('@varve/import').ImportReport | null>(
    null,
  );
  const [layersVisible, setLayersVisible] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceCustomizeOpen, setWorkspaceCustomizeOpen] = useState(false);
  const [iconBrowserOpen, setIconBrowserOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    | 'general'
    | 'appearance'
    | 'shortcuts'
    | 'export'
    | 'models'
    | 'collab'
    | 'ai'
    | 'privacy'
    | 'about'
  >('general');
  const exportLayerRef = useRef<ExportLayerHandle | null>(null);
  const findReplaceLayerRef = useRef<FindReplaceLayerHandle | null>(null);
  const onboardingLayerRef = useRef<OnboardingLayerHandle | null>(null);

  useEffect(() => {
    return () => importAbortRef.current?.abort();
  }, []);
  const { shellStyle, widths, setWidth } = usePanelWidths();
  useWorkspacePanelWidths(editor.state.workspaceMode, widths, setWidth);

  // Crash-center deep link: "Privacy and diagnostics settings" in the crash
  // dialogs opens this dialog on the privacy section.
  useEffect(() => {
    const openPrivacy = () => {
      setSettingsSection('privacy');
      setSettingsOpen(true);
    };
    window.addEventListener('varve:open-privacy-settings', openPrivacy);
    return () => window.removeEventListener('varve:open-privacy-settings', openPrivacy);
  }, []);

  // Responsive panel drawers (<=899px) previously closed only by clicking the
  // backdrop, so keyboard and switch users had no dismissal path once a
  // drawer covered the canvas.
  useEffect(() => {
    if (!layersVisible && !inspectorVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLayersVisible(false);
      setInspectorVisible(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layersVisible, inspectorVisible]);

  // Register all actions into the ActionRegistry.
  // NOTE: registerEditorActions MUST run first so its handlers take
  // priority over the no-op stubs from registerAllShortcuts.
  //
  // This effect re-runs on every editor state change, because the context
  // value is a new object on each state update. registerEditorActions needs
  // that fresh context (its handlers close over it), but the other two
  // registrations are context-independent and must run exactly once:
  // re-running registerBuiltinRules on every state update re-registered every
  // audit rule, and each re-registration logs "[audit] Overwriting rule: <id>".
  // During a drag that produced ~28 warnings per pointer move (thousands per
  // gesture), which both flooded the console and burned main-thread time
  // formatting messages inside the interaction path.
  const staticActionsRegistered = useRef(false);
  useEffect(() => {
    registerEditorActions(editor, {
      onBackToHome,
      onOpenHelp: () => editorHelp.openContextualHelp(),
      onOpenHelpCenter: () => editorHelp.setHelpCenterOpen(true),
      onContactSupport: () => openVarveContact('support'),
      onSendFeedback: () => openVarveContact('feedback'),
      onReportSecurity: () => openVarveContact('security'),
      onOpenPrivacy: () => openVarveContact('privacy'),
      onWhatIsThis: editorHelp.toggleWhatIsThis,
      onOpenAbout: () => {
        setSettingsSection('about');
        setSettingsOpen(true);
      },
      onStartTour: () => onboardingLayerRef.current?.reopen(),
      onOpenSettings: () => {
        setSettingsSection('general');
        setSettingsOpen(true);
      },
      onBatchBgRemove: () => exportLayerRef.current?.openBatchBgRemove(),
      onFindReplace: () => findReplaceLayerRef.current?.open(),
      onInsertIcon: () => setIconBrowserOpen(true),
      onOpenFile: () => fileRef.current?.click(),
      onImportFile: () => fileRef.current?.click(),
      onCustomizeWorkspace: () => setWorkspaceCustomizeOpen(true),
      onResizeImage: editor.openImageResizeDialog,
    });
    if (staticActionsRegistered.current) return;
    staticActionsRegistered.current = true;
    registerAllShortcuts(() => null);
    // Populate the audit rule registry. Without this, runAudit() (the
    // IntelligencePanel's Audit tab) silently scans against zero rules.
    registerBuiltinRules();

    // Dev guard: fail visibly if audit engine starts with zero rules
    if (process.env.NODE_ENV !== 'production') {
      const allRules = getAllRules();
      if (allRules.length === 0) {
        console.error(
          '[audit] FATAL: Audit engine started with zero registered rules. ' +
            'registerBuiltinRules() did not populate the registry. ' +
            'Check that auditAdapter.ts creates rules correctly.',
        );
      } else {
        console.info(
          `[audit] Rule registry: ${allRules.length} rules registered`,
          allRules.map((r) => r.id),
        );
      }
    }
  }, [editor, editorHelp, onBackToHome]);

  const handlePaletteSelect = useCallback((id: string) => {
    const input = fileRef.current;
    if (id === 'open' && input) {
      input.click();
    }
  }, []);

  // Desktop panel visibility (Ctrl+B / Ctrl+Shift+B): collapse the grid
  // column so the canvas reclaims the space.
  const {
    leftPanelVisible,
    rightPanelVisible,
    libraryPanelVisible,
    codegenPanelVisible,
    workspaceMode,
    distractionFreeMode,
  } = editor.state;
  const gridStyle: React.CSSProperties = { ...shellStyle };
  if (!leftPanelVisible) (gridStyle as Record<string, string>)['--sidebar-width'] = '0px';
  if (!rightPanelVisible) (gridStyle as Record<string, string>)['--inspector-width'] = '0px';
  // Effective workspace config: built-in defaults merged with the user's
  // persisted panel overrides. Governs status-bar, tab-strip, page-nav, and
  // panel visibility below — no hard-coded conditions remain.
  const effectiveConfig = useEffectiveWorkspaceConfig(workspaceMode);
  // Page navigation is progressively disclosed: workspaces that are about
  // pages (Print) always show it, and any other workspace reveals it as soon
  // as the document actually becomes multi-page.
  //
  // The trigger is "more than one page", not "has pages": `createDocument`
  // seeds every document with one page, so a `pages.length > 0` rule would
  // show the navigator in every design document and disclose nothing. Keying
  // it off the document rather than the mode alone is the point — a design
  // document that gains a second page would otherwise have no way to navigate
  // between them.
  const pageCount = editor.state.document.pages?.length ?? 0;
  const hidePageNav = !effectiveConfig.panels.pagenav.visible && pageCount <= 1;
  // Mode-preferred panel widths apply only when the user hasn't resized the
  // panel (a saved width always wins over the mode default).
  const layersPref = effectiveConfig.panels.layers.preferredWidth;
  const inspectorPref = effectiveConfig.panels.inspector.preferredWidth;
  if (widths.layers === null && layersPref) {
    (gridStyle as Record<string, string>)['--sidebar-width'] = layersPref;
  }
  if (widths.inspector === null && inspectorPref) {
    (gridStyle as Record<string, string>)['--inspector-width'] = inspectorPref;
  }

  const layersDndRef = useRef<LayersDnDHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  // When a workspace switch (or any panel-collapse) hides the focused panel,
  // focus would drop to body — an invisible stop for keyboard/AT users. Move
  // it to the canvas, which is programmatically focusable.
  const prevPanelsRef = useRef({ left: leftPanelVisible, right: rightPanelVisible });
  useEffect(() => {
    const prev = prevPanelsRef.current;
    const hidLeft = prev.left && !leftPanelVisible;
    const hidRight = prev.right && !rightPanelVisible;
    prevPanelsRef.current = { left: leftPanelVisible, right: rightPanelVisible };
    if (!hidLeft && !hidRight) return;
    const active = document.activeElement;
    if (
      !active ||
      (active !== document.body &&
        !active.closest('.editor__layers-panel, .editor__inspector-panel'))
    ) {
      return;
    }
    (document.querySelector('.editor-canvas') as HTMLElement | null)?.focus();
  }, [leftPanelVisible, rightPanelVisible]);

  return (
    <DnDShell editor={editor} layersDndRef={layersDndRef}>
      <div
        className={`editor-shell${distractionFreeMode ? ' editor-shell--distraction-free' : ''}${
          editor.state.logoPanelVisible ? ' editor-shell--logo-open' : ''
        }`}
        style={gridStyle}
      >
        <a href="#editor-main" className="editor-shell__skip-link">
          Skip to canvas
        </a>
        {/* E4 (2026-08-10): document-level heading for SR heading navigation. */}
        <h1 className="sr-only">
          {editorHeadingLabel(editor.state.sessions, editor.state.activeId)}
        </h1>
        {!distractionFreeMode && (
          <header>
            <Menubar
              onBackToHome={onBackToHome}
              onOpenSettings={() => {
                setSettingsSection('general');
                setSettingsOpen(true);
              }}
              onStartTour={() => onboardingLayerRef.current?.reopen()}
              onOpenPalette={openPalette}
              onOpenHelp={editorHelp.openContextualHelp}
              onOpenHelpCenter={() => editorHelp.setHelpCenterOpen(true)}
              onContactSupport={() => openVarveContact('support')}
              onSendFeedback={() => openVarveContact('feedback')}
              onReportSecurity={() => openVarveContact('security')}
              onOpenPrivacy={() => openVarveContact('privacy')}
              onWhatIsThis={editorHelp.toggleWhatIsThis}
              onWhatsNew={() => editorHelp.setHelpCenterOpen(true)}
              onOpenAbout={() => {
                setSettingsSection('about');
                setSettingsOpen(true);
              }}
              onBatchBgRemove={() => exportLayerRef.current?.openBatchBgRemove()}
            />
          </header>
        )}
        <FloatingToolbar />
        {!distractionFreeMode && effectiveConfig.tabStrip && (
          <TabStrip onBackToHome={onBackToHome} />
        )}
        {distractionFreeMode && (
          <Tooltip label="Exit distraction-free mode" shortcut="Ctrl+Shift+F">
            <button
              type="button"
              className="editor-shell__exit-focus"
              onClick={editor.toggleDistractionFreeMode}
              aria-label="Exit distraction-free mode (Ctrl+Shift+F)"
            >
              <Icon name="Minimize2" size={14} />
              Exit Focus
            </button>
          </Tooltip>
        )}
        <SelectionBreadcrumb />
        <main className="editor-shell__main" style={{ display: 'contents' }}>
          <ErrorBoundary>
            <CanvasArea
              canvasContainerRef={canvasContainerRef}
              onContextMenu={handleCanvasContextMenu}
            />
          </ErrorBoundary>
        </main>
        <MissingFontController />
        <CollabCursorOverlay
          users={collabUsers}
          cursors={[]}
          worldToScreen={(wx, wy) => editor.worldToCanvas(wx, wy)}
        />
        <SoftProofOverlay softProofEnabled={editor.state.softProofEnabled} />
        <AuditOverlayHost viewport={{ width: window.innerWidth, height: window.innerHeight }} />
        {importProgress && (
          <ImportProgress
            current={importProgress.current}
            total={importProgress.total}
            fileName={importProgress.fileName}
            onCancel={() => importAbortRef.current?.abort()}
          />
        )}
        {importReport && (
          <ImportResults result={importReport} onClose={() => setImportReport(null)} />
        )}
        <ImageCompareOverlay
          active={editor.state.beforeAfterCompare}
          selection={editor.selectedNodes()}
          document={editor.state.document}
          worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
        />
        {!hidePageNav && !distractionFreeMode && pageCount > 0 && (
          <div className="page-nav-container">
            <PageNav />
          </div>
        )}
        {!distractionFreeMode && (
          <aside
            className="editor__layers-panel editor__panel--glass"
            data-panel="layers"
            data-testid="layers-panel"
            data-visible={layersVisible || undefined}
            data-collapsed={!leftPanelVisible || undefined}
            {...(!leftPanelVisible ? { inert: true } : {})}
          >
            <ErrorBoundary>
              <PresenceIndicator presences={collabPresences} />
              <MinimapPanel />
              <MasterPanel />
              <PagesPanel />
              <SpreadSettings />
              {!isDetached('layers') && <LayersPanel dndRef={layersDndRef} />}
            </ErrorBoundary>
            <PanelResizeHandle
              side="layers"
              width={widths.layers}
              onResize={(w) => setWidth('layers', w)}
            />
          </aside>
        )}
        {!distractionFreeMode && (
          <aside
            className="editor__inspector-panel editor__panel--glass"
            data-panel="inspector"
            data-visible={inspectorVisible || undefined}
            data-collapsed={!rightPanelVisible || undefined}
            {...(!rightPanelVisible ? { inert: true } : {})}
          >
            <ErrorBoundary>{!isDetached('inspector') && <PropertiesPanel />}</ErrorBoundary>
            <PanelResizeHandle
              side="inspector"
              width={widths.inspector}
              onResize={(w) => setWidth('inspector', w)}
            />
          </aside>
        )}
        {libraryPanelVisible && !distractionFreeMode && !isDetached('library') && (
          // data-visible drives the <=899px drawer transform. Without it the
          // panel stayed translated fully off-screen, so Resources could be
          // "open" in state and never reachable on a narrow viewport.
          <div className="editor__library-panel" data-panel="library" data-visible>
            <ResourcesPanel
              doc={editor.state.document}
              onInstallLibrary={editor.installLibrary}
              onUninstallLibrary={editor.uninstallLibrary}
            />
          </div>
        )}
        {codegenPanelVisible && !distractionFreeMode && !isDetached('codegen') && (
          <div className="editor__codegen-panel" data-panel="codegen">
            <CodePanel doc={editor.state.document} selection={editor.selectedNodes()} />
          </div>
        )}
        {editor.state.logoPanelVisible && !distractionFreeMode && !isDetached('logo') && (
          <div className="editor__logo-panel" data-panel="logo" data-testid="logo-panel">
            <LogoPanel />
          </div>
        )}
        {editor.state.timelinePanelVisible && !distractionFreeMode && !isDetached('timeline') && (
          <div className="editor__timeline-panel" data-panel="timeline">
            <ErrorBoundary>
              <TimelinePanel
                timelines={editor.state.document.timelines ?? {}}
                activeTimelineId={editor.state.motion.activeTimelineId}
                currentTime={editor.state.motion.currentTime}
                isPlaying={editor.state.motion.isPlaying}
                playbackSpeed={editor.state.motion.playbackSpeed}
                loop={editor.state.motion.loop}
                autoKeyframe={editor.state.motion.autoKeyframe}
                onionSkin={editor.state.motion.onionSkinEnabled}
                motionPresets={editor.state.document.motionPresets ?? {}}
                selectedTrackIds={editor.state.motion.selectedTrackIds}
                selectedKeyframe={
                  selectedKeyframe
                    ? { trackId: selectedKeyframe.trackId, index: selectedKeyframe.index }
                    : null
                }
                graphEditorVisible={editor.state.graphEditorVisible}
                onPlay={() => editor.playTimeline()}
                onPause={() => editor.pauseTimeline()}
                onStop={() => editor.stopTimeline()}
                onSeek={(time) => editor.seekTimeline(time)}
                onSpeedChange={(speed) => editor.setPlaybackSpeed(speed)}
                onToggleLoop={() => editor.toggleLoop()}
                onToggleAutoKeyframe={() => editor.toggleAutoKeyframe()}
                onToggleOnionSkin={() => editor.toggleOnionSkin()}
                onToggleGraphEditor={() => editor.toggleGraphEditor()}
                onDeleteKeyframe={(tlId, trackId, progress) =>
                  editor.deleteKeyframe(tlId, trackId, progress)
                }
                onMoveKeyframe={(tlId, trackId, oldP, newP) =>
                  editor.moveKeyframe(tlId, trackId, oldP, newP)
                }
                onUpdateKeyframeEasing={(tlId, trackId, progress, easing) =>
                  editor.updateKeyframeEasing(tlId, trackId, progress, easing)
                }
                onSetTrackMuted={(tlId, trackId, muted) =>
                  editor.setTrackMuted(tlId, trackId, muted)
                }
                onSetTrackSolo={(tlId, trackId, solo) => editor.setTrackSolo(tlId, trackId, solo)}
                onAddMarker={(timeMs) => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (!tlId) return;
                  const tl = editor.state.document.timelines?.[tlId];
                  if (!tl) return;
                  const count = (tl.markers?.length ?? 0) + 1;
                  const progress = tl.duration > 0 ? timeMs / tl.duration : 0;
                  editor.addTimelineMarker(tlId, `Marker ${count}`, progress);
                }}
                onRenameMarker={async (markerId) => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (!tlId) return;
                  const marker = editor.state.document.timelines?.[tlId]?.markers?.find(
                    (m) => m.id === markerId,
                  );
                  const nextName = await promptDialog('Marker name', marker?.name ?? '');
                  if (nextName?.trim()) {
                    editor.renameTimelineMarker(tlId, markerId, nextName.trim());
                  }
                }}
                onDeleteMarker={(markerId) => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (tlId) editor.removeTimelineMarker(tlId, markerId);
                }}
                onSavePreset={async () => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (!tlId) return;
                  const name = await promptDialog('Preset name');
                  if (name?.trim()) {
                    editor.createMotionPresetFromTimeline(tlId, name.trim());
                  }
                }}
                onApplyPreset={(presetId) => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (tlId) editor.applyMotionPreset(presetId, tlId);
                }}
                onSelectTimeline={(id) => editor.setActiveTimeline(id)}
                onCreateTimeline={() => editor.createTimeline()}
                onSelectTrack={(trackId) => {
                  const s = editor.state.motion;
                  const alreadySelected = s.selectedTrackIds.includes(trackId);
                  editor.setMotionSelectedTracks?.(
                    alreadySelected
                      ? s.selectedTrackIds.filter((id) => id !== trackId)
                      : [...s.selectedTrackIds, trackId],
                  );
                }}
                onClickKeyframe={(trackId, progress) => {
                  const tl = editor.state.motion.activeTimelineId
                    ? editor.state.document.timelines?.[editor.state.motion.activeTimelineId]
                    : null;
                  if (tl) editor.seekTimeline(progress * tl.duration);
                  // Wire the selected keyframe so the track row's arrow-key
                  // stepping and Delete actually have a target.
                  const track = tl?.tracks.find((t) => t.id === trackId);
                  const index = track
                    ? track.keyframes.findIndex((kf) => kf.progress === progress)
                    : -1;
                  setSelectedKeyframe(index >= 0 ? { trackId, index } : null);
                }}
                onSetTrackNestedTimeline={(trackId, nestedTimelineId, startProgress) => {
                  const tlId = editor.state.motion.activeTimelineId;
                  if (tlId) {
                    editor.setTrackNestedTimeline(tlId, trackId, nestedTimelineId, startProgress);
                  }
                }}
                getNodeName={(nodeId) => editor.state.document.nodes[nodeId]?.name}
              />
            </ErrorBoundary>
          </div>
        )}
        {editor.state.historyPanelVisible && !distractionFreeMode && (
          <div className="editor__history-panel" data-panel="history" data-testid="history-panel">
            <ErrorBoundary>
              <HistoryPanel />
            </ErrorBoundary>
          </div>
        )}
        {!distractionFreeMode && effectiveConfig.statusBar && (
          <>
            <SelectionInfoBar />
            <StatusBar
              onOpenPalette={(shortcutId) => {
                setPaletteFocusShortcutId(shortcutId);
                openPalette();
              }}
            />
            {/* FAB for layers (responsive) */}
            <button
              type="button"
              className="editor__fab editor__fab--layers"
              onClick={() => setLayersVisible((v) => !v)}
              aria-expanded={layersVisible}
              aria-label={layersVisible ? 'Hide layers panel' : 'Show layers panel'}
            >
              <Icon name="LayoutGrid" />
            </button>
            {/* FAB for inspector (responsive) */}
            <button
              type="button"
              className="editor__fab editor__fab--inspector"
              onClick={() => setInspectorVisible((v) => !v)}
              aria-expanded={inspectorVisible}
              aria-label={inspectorVisible ? 'Hide inspector panel' : 'Show inspector panel'}
            >
              <Icon name="Settings" />
            </button>
            {/* FAB for library (responsive) */}
            <button
              type="button"
              className="editor__fab editor__fab--library"
              onClick={() => editor.toggleLibraryPanel()}
              aria-expanded={libraryPanelVisible}
              aria-label={libraryPanelVisible ? 'Hide resources panel' : 'Show resources panel'}
            >
              <Icon name="Library" />
            </button>
            {/* Backdrop for overlays. libraryPanelVisible is included because
                the dismiss handler already closes Resources — without it, a
                Resources-only drawer had no scrim and no pointer dismissal. */}
            {(layersVisible || inspectorVisible || libraryPanelVisible) && (
              // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismisses panels
              <div
                className="editor__panel-backdrop"
                onClick={() => {
                  setLayersVisible(false);
                  setInspectorVisible(false);
                  if (libraryPanelVisible) editor.toggleLibraryPanel();
                }}
                role="presentation"
              />
            )}
          </>
        )}
        <ShortcutPalette
          open={paletteOpen}
          onClose={() => {
            closePalette();
            setPaletteFocusShortcutId(undefined);
          }}
          onSelect={handlePaletteSelect}
          workspaceMode={editor.state.workspaceMode}
          focusShortcutId={paletteFocusShortcutId}
        />
        <QuickActionsBar
          open={quickActionsOpen}
          onClose={() => setQuickActionsOpen(false)}
          workspaceMode={editor.state.workspaceMode}
          onExecute={(id) => {
            editor.recordAction(`menu:${id}`);
            if (id === 'open') {
              const input = fileRef.current;
              if (input) input.click();
            }
            setQuickActionsOpen(false);
          }}
        />
        <input
          ref={fileRef}
          id="file-open-input"
          type="file"
          accept=".varve,.strata,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const text = reader.result as string;
              // File > Open lands in its own tab (Figma/Photoshop), leaving
              // the current document open. The picker gives us no path or
              // app-store id, so the tab stays unbound until it is saved.
              editor.openFile(undefined, file.name, undefined, text);
            };
            reader.readAsText(file);
            e.target.value = '';
          }}
        />

        <input
          id="file-import-input"
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp,.pdf,.ai,.eps,.psd,.psb,.sketch,.fig,.fig.json,.cube,.3dl,.clf,.ctf"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            try {
              // Route LUT files to the LUT-specific handler
              const lutFiles = files.filter((f) => /\.(cube|3dl|clf|ctf)$/i.test(f.name));
              if (lutFiles.length > 0) {
                const { parseCubeData, parse3dlData, makeAdjustment } = await import(
                  '@varve/engine'
                );
                for (const file of lutFiles) {
                  const text = await file.text();
                  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                  try {
                    let result: { transform: unknown };
                    if (ext === 'cube') {
                      result = parseCubeData(text);
                    } else {
                      result = parse3dlData(text);
                    }
                    const json = JSON.stringify(result.transform);
                    const lutAdj = makeAdjustment(
                      `lut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      'lut',
                      {
                        lutJson: json,
                        originalFilename: file.name,
                        inputSpace: 'sRGB' as const,
                        interpolation: 'tetrahedral' as const,
                        intensity: 1,
                        linearize: false,
                        visible: true,
                        opacity: 0,
                      },
                    );
                    editor.addLutAdjustment(lutAdj);
                    editor.announce(`Imported LUT: ${file.name}`);
                  } catch (err) {
                    editor.announce(
                      `LUT import failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  }
                }
                // Filter out LUT files from the remaining import
                const remaining = files.filter((f) => !/\.(cube|3dl|clf|ctf)$/i.test(f.name));
                if (remaining.length === 0) {
                  e.target.value = '';
                  return;
                }
                // Fall through to normal import for remaining files
              }
              const importFiles = files.filter((f) => !/\.(cube|3dl|clf|ctf)$/i.test(f.name));
              if (importFiles.length === 0) {
                e.target.value = '';
                return;
              }
              const abortController = new AbortController();
              importAbortRef.current = abortController;
              setImportReport(null);
              setImportProgress({
                current: 0,
                total: importFiles.length,
                fileName: importFiles[0]!.name,
              });
              const { ImportService } = await import('@varve/import');
              const report = await ImportService.importFiles(
                await Promise.all(
                  importFiles.map(async (file) => ({
                    name: file.name,
                    source: 'file-picker' as const,
                    size: file.size,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  })),
                ),
                {
                  center: true,
                  embedImages: true,
                  onProgress: (current, total, file) =>
                    setImportProgress({ current, total, fileName: file.name }),
                },
                abortController.signal,
              );
              const parsedItems: { node: SceneNode; sourceDoc: Document }[] = [];
              for (const fileReport of report.files) {
                for (const artifact of fileReport.artifacts) {
                  for (const id of artifact.nodeIds) {
                    const node = artifact.document.nodes[id];
                    if (node) parsedItems.push({ node, sourceDoc: artifact.document });
                  }
                }
              }
              if (parsedItems.length > 0) editor.batchImportNodes(parsedItems);
              const hasIssues =
                report.partialCount > 0 ||
                report.failureCount > 0 ||
                report.warnings.length > 0 ||
                report.files.some((file) => file.unsupportedFeatures.length > 0);
              if (hasIssues) setImportReport(report);
              editor.announce(
                `Imported ${report.successCount + report.partialCount} file${report.successCount + report.partialCount === 1 ? '' : 's'}; ${report.failureCount} failed`,
              );
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') return;
              editor.announce(
                err instanceof Error ? `Import failed: ${err.message}` : 'Import failed',
              );
            } finally {
              importAbortRef.current = null;
              setImportProgress(null);
              e.target.value = '';
            }
          }}
        />

        {/* Settings dialog */}
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initialSection={settingsSection}
          onOnboardingReset={() => {
            resetOnboarding(platform);
          }}
        />

        {/* Workspace customization dialog */}
        <WorkspaceCustomizeDialog
          open={workspaceCustomizeOpen}
          onClose={() => setWorkspaceCustomizeOpen(false)}
        />

        {/* Content-Aware Fill dialog */}
        {editor.state.cafDialogNodeId && (
          <ContentAwareFillDialog
            nodeId={editor.state.cafDialogNodeId}
            isOpen={true}
            onClose={editor.closeCafDialog}
            onApplied={editor.closeCafDialog}
          />
        )}

        {/* State Machine panel — document-wide, opt-in (see toggleStateMachinePanel) */}
        <StateMachinePanel
          open={editor.state.stateMachinePanelVisible}
          onClose={editor.toggleStateMachinePanel}
        />

        {/* Export dialog + batch BG removal (self-contained) */}
        <ExportLayer ref={exportLayerRef} platform={platform} />
        <FindReplaceLayer ref={findReplaceLayerRef} />
        <IconBrowserDialog
          open={iconBrowserOpen}
          onClose={() => setIconBrowserOpen(false)}
          title="Insert icon"
        />

        {editor.state.subjectPickerSession && (
          <SubjectPickerOverlay
            session={editor.state.subjectPickerSession}
            onConfirm={(keepIds) => editor.confirmSubjectPicker(keepIds)}
            onCancel={() => editor.cancelSubjectPicker()}
            onHighlight={(id) => editor.patch({ subjectHighlightId: id })}
          />
        )}

        {/* Onboarding: welcome, tour, checklist, tips */}
        <OnboardingLayer ref={onboardingLayerRef} platform={platform} onBackToHome={onBackToHome} />

        {/* Recovery dialog + termination lifecycle (unsaved-work guard) */}
        <LifecycleProvider onBackToHome={onBackToHome} />

        {/* Prototype presenter (fullscreen preview) */}
        <PrototypePresenter
          isOpen={editor.state.isPresenting}
          onClose={editor.stopPresentation}
          screens={editor.getPrototypeScreens()}
          currentScreenId={editor.prototypeCurrentScreen}
          onNavigate={editor.navigatePrototypeTo}
          onEvent={editor.handlePrototypeEvent}
          prototypeDocument={editor.state.document}
          overlayStack={editor.state.prototypeRuntime?.state.overlayStack ?? []}
          hitTestNode={(world) => {
            const hit = editor.hitTestNode(world);
            return hit ? { nodeId: hit.nodeId } : null;
          }}
          getNodeBounds={(nodeId) => {
            const node = editor.state.document.nodes[nodeId];
            if (!node) return null;
            return nodeLocalBounds(node, editor.state.document);
          }}
          activeTransition={editor.prototypeTransition}
          onClearTransition={editor.clearPrototypeTransition}
        />

        {/* Contextual help side panel (F1) */}
        <ContextualHelpPanel
          state={editorHelp.contextual.state}
          onClose={editorHelp.contextual.close}
          onSetArticle={editorHelp.contextual.setArticle}
          onSetSearchQuery={editorHelp.contextual.setSearchQuery}
        />

        {/* What's This? click-to-learn overlay (Shift+F1) */}
        <WhatIsThis
          open={editorHelp.whatIsThisOpen}
          onOpenHelp={editorHelp.handleWhatIsThisArticle}
          onExit={editorHelp.exitWhatIsThis}
        />

        {/* Help Browser */}
        <HelpBrowser
          open={editorHelp.helpCenterOpen}
          onClose={() => editorHelp.setHelpCenterOpen(false)}
        />
        <PromptDialog />
        <ConfirmDialog />

        {/* Logo small-size preview */}
        <LogoPreviewDialog />

        {/* Upscale dialog */}
        {editor.upscaleDialogOpen && (
          <UpscaleDialogHost open={editor.upscaleDialogOpen} onClose={editor.closeUpscaleDialog} />
        )}

        <ImageResizeDialogHost />

        {/* Image Trace dialog */}
        {editor.vectorizeDialogOpen && <VectorizeDialogHost />}

        {/* File Thumbnail picker */}
        <ThumbnailPickerHost />

        {/* Document Color Mode (Assign vs Convert) */}
        <ColorConversionHost />

        {/* Canvas right-click context menu */}
        {canvasContextMenu &&
          (() => {
            const closeMenu = () => setCanvasContextMenu(null);
            const items = buildCanvasContextMenuItems({ editor, closeMenu });
            return (
              <ContextMenu
                items={items}
                position={canvasContextMenu}
                onClose={closeMenu}
                label="Canvas context menu"
              />
            );
          })()}
      </div>
    </DnDShell>
  );
}

/** Bridges the @varve/ui Toast system into the editor context's showToast(). */
function ToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    setToastHandler(toast);
  }, [toast]);
  return null;
}

export function Shell({
  onBackToHome,
  documentJson,
  documentName,
  documentFileId,
  documentFilePath,
  documentLibraryStorage,
  openFile,
  platform,
  active,
  fitOnOpen,
}: ShellProps) {
  return (
    <EditorProvider
      onBackToHome={onBackToHome}
      initialDocumentJson={documentJson}
      initialDocumentName={documentName}
      initialFileId={documentFileId}
      initialFilePath={documentFilePath}
      initialLibraryStorage={documentLibraryStorage}
      platform={platform}
    >
      <SettingsProvider>
        <ToastProvider>
          <ToastBridge />
          <ShellInner
            onBackToHome={onBackToHome}
            openFile={openFile}
            platform={platform}
            active={active}
            fitOnOpen={fitOnOpen}
          />
        </ToastProvider>
      </SettingsProvider>
    </EditorProvider>
  );
}
