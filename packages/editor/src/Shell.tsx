// COMPLEXITY: 49 imports (ceiling 49). Merged duplicate @varve/scene and @varve/ui imports.
// Plan: Refactor to move SubjectPickerOverlay and other overlay imports to a dedicated overlay registry module.
import { HelpBrowser } from '@varve/help';
import type { Platform } from '@varve/platform';
import {
  type Document,
  getAllRules,
  isImageShape,
  registerBuiltinRules,
  type SceneNode,
} from '@varve/scene';
import { ContextMenu, Icon, type MenuEntry, ToastProvider, Tooltip, useToast } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getActionRegistry } from './actions/ActionRegistry';
import { registerAllShortcuts, registerEditorActions } from './actions/registerAll';
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
import { PanelResizeHandle, usePanelWidths } from './components/PanelResizeHandle';
import { PromptDialog, promptDialog } from './components/PromptDialog';
import { PrototypePresenter } from './components/Prototype/PrototypePresenter';
import { QuickActionsBar } from './components/QuickActionsBar/QuickActionsBar';
import { IconBrowserDialog, ResourcesPanel } from './components/ResourcesPanel/ResourcesPanel';
import { SelectionInfoBar } from './components/SelectionInfoBar';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import {
  DnDShell,
  ExportLayer,
  type ExportLayerHandle,
  FindReplaceLayer,
  type FindReplaceLayerHandle,
  OnboardingLayer,
  type OnboardingLayerHandle,
  RecoveryManager,
  VectorizeDialogHost,
} from './components/Shell';
import { UpscaleDialogHost } from './components/Upscale/UpscaleDialogHost';
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
import { useEffectiveWorkspaceConfig } from './workspace/useWorkspaceConfig';
import { useWorkspacePanelWidths } from './workspace/useWorkspacePanelWidths';

/** A request to open a file into a tab; bump `seq` for each dispatch. */
export interface OpenFileRequest {
  id: string;
  name: string;
  filePath?: string;
  /** Document JSON, or null for a fresh blank document. */
  json: string | null;
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
  /** File-open requests from the host app (home screen). */
  openFile?: OpenFileRequest | null;
  /** False while the editor is hidden behind the home screen — suspends
   *  global keyboard shortcuts so Home doesn't trigger editor actions. */
  active?: boolean;
  /** The platform facade (Tauri/web/memory) — used for native-storage-backed
   *  persistence (e.g. onboarding-complete) rather than raw localStorage. */
  platform?: Platform;
}

function ShellInner({
  onBackToHome,
  openFile,
  platform,
  active = true,
}: {
  onBackToHome?: () => void;
  openFile?: OpenFileRequest | null;
  platform?: Platform;
  active?: boolean;
}) {
  const editor = useEditor();
  const editorHelp = useEditorHelp(editor.state.tool);
  const { paletteOpen, closePalette, openPalette, quickActionsOpen, setQuickActionsOpen } =
    useShortcuts(editor, onBackToHome, active, {
      onOpenContextualHelp: editorHelp.openContextualHelp,
      onOpenHelpCenter: () => editorHelp.setHelpCenterOpen(true),
    });
  const [paletteFocusShortcutId, setPaletteFocusShortcutId] = useState<string | undefined>();

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
    editor.openFile(openFile.id, openFile.name, openFile.filePath, openFile.json);
  }, [openFile, editor]);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const hidePageNav = !effectiveConfig.panels.pagenav.visible;
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

  return (
    <DnDShell layersDndRef={layersDndRef}>
      <div
        className={`editor-shell${distractionFreeMode ? ' editor-shell--distraction-free' : ''}${
          editor.state.logoPanelVisible ? ' editor-shell--logo-open' : ''
        }`}
        style={gridStyle}
      >
        <a href="#editor-main" className="editor-shell__skip-link">
          Skip to canvas
        </a>
        {!distractionFreeMode && (
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
            onWhatIsThis={editorHelp.toggleWhatIsThis}
            onOpenAbout={() => {
              setSettingsSection('about');
              setSettingsOpen(true);
            }}
            onBatchBgRemove={() => exportLayerRef.current?.openBatchBgRemove()}
          />
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
        <ImageCompareOverlay
          active={editor.state.beforeAfterCompare}
          selection={editor.selectedNodes()}
          document={editor.state.document}
          worldToCanvas={(wx, wy) => editor.worldToCanvas(wx, wy)}
        />
        {!hidePageNav && !distractionFreeMode && (
          <div className="page-nav-container">
            <PageNav />
          </div>
        )}
        {!distractionFreeMode && (
          <div
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
              <SpreadSettings />
              <LayersPanel dndRef={layersDndRef} />
            </ErrorBoundary>
            <PanelResizeHandle
              side="layers"
              width={widths.layers}
              onResize={(w) => setWidth('layers', w)}
            />
          </div>
        )}
        {!distractionFreeMode && (
          <div
            className="editor__inspector-panel editor__panel--glass"
            data-panel="inspector"
            data-visible={inspectorVisible || undefined}
            data-collapsed={!rightPanelVisible || undefined}
            {...(!rightPanelVisible ? { inert: true } : {})}
          >
            <ErrorBoundary>
              <PropertiesPanel />
            </ErrorBoundary>
            <PanelResizeHandle
              side="inspector"
              width={widths.inspector}
              onResize={(w) => setWidth('inspector', w)}
            />
          </div>
        )}
        {libraryPanelVisible && !distractionFreeMode && (
          <div className="editor__library-panel" data-panel="library">
            <ResourcesPanel
              doc={editor.state.document}
              onInstallLibrary={editor.installLibrary}
              onUninstallLibrary={editor.uninstallLibrary}
            />
          </div>
        )}
        {codegenPanelVisible && !distractionFreeMode && (
          <div className="editor__codegen-panel" data-panel="codegen">
            <CodePanel doc={editor.state.document} selection={editor.selectedNodes()} />
          </div>
        )}
        {editor.state.logoPanelVisible && !distractionFreeMode && (
          <div className="editor__logo-panel" data-panel="logo" data-testid="logo-panel">
            <LogoPanel />
          </div>
        )}
        {editor.state.timelinePanelVisible && !distractionFreeMode && (
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
                selectedKeyframeIndex={null}
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
                onClickKeyframe={(_trackId, progress) => {
                  const tl = editor.state.motion.activeTimelineId
                    ? editor.state.document.timelines?.[editor.state.motion.activeTimelineId]
                    : null;
                  if (tl) editor.seekTimeline(progress * tl.duration);
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
              aria-label={layersVisible ? 'Hide layers panel' : 'Show layers panel'}
            >
              <Icon name="LayoutGrid" />
            </button>
            {/* FAB for inspector (responsive) */}
            <button
              type="button"
              className="editor__fab editor__fab--inspector"
              onClick={() => setInspectorVisible((v) => !v)}
              aria-label={inspectorVisible ? 'Hide inspector panel' : 'Show inspector panel'}
            >
              <Icon name="Settings" />
            </button>
            {/* FAB for library (responsive) */}
            <button
              type="button"
              className="editor__fab editor__fab--library"
              onClick={() => editor.toggleLibraryPanel()}
              aria-label={libraryPanelVisible ? 'Hide resources panel' : 'Show resources panel'}
            >
              <Icon name="Library" />
            </button>
            {/* Backdrop for overlays */}
            {(layersVisible || inspectorVisible) && (
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
          focusShortcutId={paletteFocusShortcutId}
        />
        <QuickActionsBar
          open={quickActionsOpen}
          onClose={() => setQuickActionsOpen(false)}
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
              editor.loadDocument(text);
            };
            reader.readAsText(file);
            e.target.value = '';
          }}
        />

        <input
          id="file-import-input"
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.webp,.gif,.pdf,.ai,.eps,.psd,.psb,.sketch,.cube,.3dl,.clf,.ctf"
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
                const remaining = files.filter((f) => !/\.(cube|3dl)$/i.test(f.name));
                if (remaining.length === 0) {
                  e.target.value = '';
                  return;
                }
                // Fall through to normal import for remaining files
              }
              const { ImportService } = await import('@varve/import');
              const report = await ImportService.importFiles(
                await Promise.all(
                  files.map(async (file) => ({
                    name: file.name,
                    source: 'file-picker' as const,
                    size: file.size,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  })),
                ),
                { center: true, embedImages: true },
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
              editor.announce(
                `Imported ${report.successCount + report.partialCount} file${report.successCount + report.partialCount === 1 ? '' : 's'}; ${report.failureCount} failed`,
              );
            } catch (err) {
              editor.announce(
                err instanceof Error ? `Import failed: ${err.message}` : 'Import failed',
              );
            } finally {
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

        {/* Recovery dialog for crash-recovery sessions */}
        <RecoveryManager platform={platform} document={editor.state.document} />

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

        {/* Logo small-size preview */}
        <LogoPreviewDialog />

        {/* Upscale dialog */}
        {editor.upscaleDialogOpen && (
          <UpscaleDialogHost open={editor.upscaleDialogOpen} onClose={editor.closeUpscaleDialog} />
        )}

        {/* Image Trace dialog */}
        {editor.vectorizeDialogOpen && <VectorizeDialogHost />}

        {/* Canvas right-click context menu */}
        {canvasContextMenu &&
          (() => {
            const hasSelection = editor.state.selection.length > 0;
            const hasMultiple = editor.state.selection.length > 1;
            const closeMenu = () => setCanvasContextMenu(null);
            const selectedId = editor.state.selection[0];
            const isSingleGroup =
              hasSelection &&
              editor.state.selection.length === 1 &&
              selectedId !== undefined &&
              editor.state.document.nodes[selectedId]?.kind === 'group';
            const selectedNode = selectedId ? editor.state.document.nodes[selectedId] : undefined;
            const isSingleImage =
              hasSelection &&
              editor.state.selection.length === 1 &&
              selectedNode?.kind === 'shape' &&
              isImageShape(selectedNode);
            const isSingleTraceGroup =
              hasSelection &&
              editor.state.selection.length === 1 &&
              selectedNode?.kind === 'group' &&
              selectedNode.traceMetadata !== undefined;
            const nodeCount = Object.keys(editor.state.document.nodes).length;
            const hasNodes = nodeCount >= 1;
            const hasMultipleNodes = nodeCount >= 2;
            const record = (actionId: string) => editor.recordAction(`menu:${actionId}`);
            const items: MenuEntry[] = [
              ...(hasSelection
                ? [
                    {
                      id: 'ctx-cut',
                      label: 'Cut',
                      onAction: () => {
                        record('cut');
                        editor.cutSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                    {
                      id: 'ctx-copy',
                      label: 'Copy',
                      onAction: () => {
                        record('copy');
                        editor.copySelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                  ]
                : []),
              {
                id: 'ctx-paste',
                label: 'Paste',
                onAction: () => {
                  record('paste');
                  editor.paste();
                  closeMenu();
                },
              } satisfies MenuEntry,
              ...(hasSelection
                ? [
                    { id: 'ctx-sep1', separator: true as const } satisfies MenuEntry,
                    {
                      id: 'ctx-dup',
                      label: 'Duplicate',
                      onAction: () => {
                        record('duplicate');
                        editor.duplicateSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                    {
                      id: 'ctx-del',
                      label: 'Delete',
                      onAction: () => {
                        record('delete');
                        editor.removeSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                  ]
                : []),
              ...(hasMultiple
                ? [
                    { id: 'ctx-sep2', separator: true as const } satisfies MenuEntry,
                    {
                      id: 'ctx-group',
                      label: 'Group Selection',
                      onAction: () => {
                        record('group');
                        editor.groupSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                  ]
                : []),
              ...(isSingleGroup
                ? [
                    { id: 'ctx-sep3', separator: true as const } satisfies MenuEntry,
                    {
                      id: 'ctx-ungroup',
                      label: 'Ungroup',
                      onAction: () => {
                        record('ungroup');
                        editor.ungroupSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                  ]
                : []),
              ...(hasSelection
                ? [
                    { id: 'ctx-sep-mockups', separator: true as const } satisfies MenuEntry,
                    {
                      id: 'ctx-mockups',
                      label: 'Apply mockup…',
                      onAction: () => {
                        record('applyMockup');
                        getActionRegistry().get('applyMockup')?.handler(undefined);
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                  ]
                : []),
              { id: 'ctx-sep4', separator: true as const } satisfies MenuEntry,
              {
                id: 'ctx-selectall',
                label: 'Select All',
                onAction: () => {
                  record('selectAll');
                  const nodes = editor.rootNodes();
                  if (nodes.length === 0) {
                    closeMenu();
                    return;
                  }
                  editor.setSelection(nodes[0]?.id ?? null);
                  for (let i = 1; i < nodes.length; i++) {
                    const n = nodes[i];
                    if (n) editor.toggleSelection(n.id, true);
                  }
                  closeMenu();
                },
              } satisfies MenuEntry,
              ...(hasNodes
                ? [
                    { id: 'ctx-sep5', separator: true as const } satisfies MenuEntry,
                    ...(isSingleImage
                      ? [
                          {
                            id: 'ctx-vectorize',
                            label: 'Vectorize image…',
                            onAction: () => {
                              record('vectorize');
                              editor.openVectorizeDialog();
                              closeMenu();
                            },
                          } satisfies MenuEntry,
                        ]
                      : []),
                    ...(isSingleTraceGroup
                      ? [
                          {
                            id: 'ctx-retrace',
                            label: 'Edit Trace…',
                            onAction: () => {
                              record('retrace');
                              if (selectedNode?.kind === 'group') {
                                editor.openVectorizeDialog({
                                  replaceGroupId: selectedNode.id,
                                });
                              }
                              closeMenu();
                            },
                          } satisfies MenuEntry,
                        ]
                      : []),
                    {
                      id: 'ctx-intel',
                      label: 'Intelligence',
                      type: 'submenu',
                      submenu: [
                        {
                          id: 'ctx-intel-audit',
                          label: 'Audit',
                          onAction: () => {
                            editor.setInspectorTab?.('audit', 'audit');
                            closeMenu();
                          },
                          disabled: !hasNodes,
                        },
                        {
                          id: 'ctx-intel-scan',
                          label: 'Scan for Debt',
                          onAction: () => {
                            editor.setInspectorTab?.('audit', 'debt');
                            closeMenu();
                          },
                          disabled: !hasNodes,
                        },
                        {
                          id: 'ctx-intel-names',
                          label: 'Suggest Names',
                          onAction: () => {
                            editor.setInspectorTab?.('audit', 'naming');
                            closeMenu();
                          },
                          disabled: !hasSelection,
                        },
                        {
                          id: 'ctx-intel-dupes',
                          label: hasSelection
                            ? 'Detect Duplicates in Selection'
                            : 'Detect Duplicates on Page',
                          onAction: () => {
                            editor.setInspectorTab?.('audit', 'components');
                            closeMenu();
                          },
                          disabled: !hasMultipleNodes,
                        },
                      ],
                    } satisfies MenuEntry,
                  ]
                : []),
            ];
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
  openFile,
  platform,
  active,
}: ShellProps) {
  return (
    <EditorProvider
      onBackToHome={onBackToHome}
      initialDocumentJson={documentJson}
      initialDocumentName={documentName}
      initialFileId={documentFileId}
      initialFilePath={documentFilePath}
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
          />
        </ToastProvider>
      </SettingsProvider>
    </EditorProvider>
  );
}
