import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { createEngine, type Engine } from '@strata/engine';
import { HelpBrowser } from '@strata/help';
import type { Platform } from '@strata/platform';
import type { Document, ExportBatch, ExportFormat, NodeId, SceneNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { screenToWorld } from '@strata/shared';
import type { MenuEntry } from '@strata/ui';
import { ContextMenu, Icon, ToastProvider, useToast } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { registerAllShortcuts, registerEditorActions } from './actions/registerAll';
import { CanvasArea } from './CanvasArea';
import { captureClipboardEvent } from './clipboard';
import { SubjectPickerOverlay } from './components/BackgroundRemoval/SubjectPickerOverlay';
import { BatchBgRemoveDialog } from './components/BatchBgRemoveDialog';
import { CollabCursorOverlay } from './components/CollabCursorOverlay/CollabCursorOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportDialog } from './components/Export/ExportDialog';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import type { LayersDnDHandle } from './components/LayersPanel/LayersTree';
import { PresenceIndicator } from './components/LayersPanel/PresenceIndicator';
import { LibraryPanel } from './components/LibraryPanel/LibraryPanel';
import { MinimapPanel } from './components/Minimap/MinimapPanel';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from './components/Onboarding';
import { TOUR_STEPS } from './components/Onboarding/tourSteps';
import { PageNav } from './components/PageNav/PageNav';
import { PanelResizeHandle, usePanelWidths } from './components/PanelResizeHandle';
import { PromptDialog, promptDialog } from './components/PromptDialog';
import { PrototypePresenter } from './components/Prototype/PrototypePresenter';
import { QuickActionsBar } from './components/QuickActionsBar/QuickActionsBar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { SelectionInfoBar } from './components/SelectionInfoBar';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { SoftProofOverlay } from './components/SoftProofOverlay';
import { EditorProvider, setToastHandler, useEditor } from './context';
import type { DragNodeData } from './dnd-types';
import { createExportSaveFile, saveExportBytes } from './exportSaveAdapter';
import { ExportService } from './exportService';
import { useCollabPresence } from './hooks/useCollabPresence';
import { getActionTracker } from './intelligence/actionTracker';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import {
  ContextualHelpPanel,
  checkChecklistItem,
  DidYouKnowTip,
  loadOnboardingState,
  markTutorialComplete,
  resetOnboarding,
  saveOnboardingState,
  TutorialBanner,
  useDidYouKnow,
  useEditorHelp,
  useTutorialProgress,
  WhatIsThis,
} from './onboard';
import {
  CHECKLIST_ITEMS,
  OnboardingChecklist,
} from './onboard/OnboardingChecklist/OnboardingChecklist';
import { buildPackageExport } from './packageExport';
import { getSharedRecoveryManager, type RecoverySession } from './recovery';
import { StatusBar } from './StatusBar';
import { createTutorialDocument } from './samples/tutorial-document';
import { nodeLocalBounds } from './scene/world';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';
import { TimelinePanel } from './timeline/TimelinePanel';
import './components/Prototype/prototype.css';

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
  /** File-open requests from the host app (home screen). */
  openFile?: OpenFileRequest | null;
  /** False while the editor is hidden behind the home screen — suspends
   *  global keyboard shortcuts so Home doesn't trigger editor actions. */
  active?: boolean;
  /** The platform facade (Tauri/web/memory) — used for native-storage-backed
   *  persistence (e.g. onboarding-complete) rather than raw localStorage. */
  platform?: Platform;
}

function isRasterExport(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpg' || format === 'webp';
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

  const { presences: collabPresences, users: collabUsers } = useCollabPresence(
    editor.state.activeId,
    editor.state.cursorPos,
    editor.state.pan,
  );

  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const exportEngineRef = useRef<Promise<Engine> | null>(null);
  const saveExportFile = useMemo(() => createExportSaveFile(platform), [platform]);

  const handleCanvasContextMenu = useCallback((pos: { x: number; y: number }) => {
    setCanvasContextMenu(pos);
  }, []);

  const getExportEngine = useCallback(() => {
    exportEngineRef.current ??= createEngine('auto');
    return exportEngineRef.current;
  }, []);

  const handleExportBatch = useCallback(
    async (batch: ExportBatch) => {
      const needsEngine = batch.jobs.some((job) => isRasterExport(job.format));
      const engine = needsEngine ? await getExportEngine() : null;
      return await ExportService.run(batch, {
        document: editor.state.document,
        engine,
        saveFile: saveExportFile,
      });
    },
    [editor.state.document, getExportEngine, saveExportFile],
  );

  const handleExportMotion = useCallback(
    (format: 'css' | 'lottie' | 'svg', fileName: string, content: string) => {
      const mimeType =
        format === 'lottie' ? 'application/json' : format === 'svg' ? 'image/svg+xml' : 'text/css';
      const extension = format === 'lottie' ? '.json' : format === 'svg' ? '.svg' : '.css';
      void saveExportBytes(
        platform,
        fileName,
        new TextEncoder().encode(content),
        mimeType,
        extension,
      );
    },
    [platform],
  );

  const handleSaveVideoFile = useCallback(
    async (fileName: string, bytes: Uint8Array, mimeType: string) => {
      const extension = fileName.toLowerCase().endsWith('.webm') ? '.webm' : '.mp4';
      await saveExportBytes(platform, fileName, bytes, mimeType, extension);
    },
    [platform],
  );

  const handlePackageExport = useCallback(async () => {
    const pkg = buildPackageExport(editor.state.document);
    await saveExportBytes(platform, pkg.fileName, pkg.bytes, pkg.mimeType, '.zip');
  }, [editor.state.document, platform]);

  // ── Lifecycle event handlers ─────────────────────────────────────────────
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  // Check for recovery sessions on mount
  useEffect(() => {
    const mgr = getSharedRecoveryManager();
    mgr.hasSessions().then((has) => {
      if (has) {
        mgr.listSessions().then((sessions) => {
          setRecoverySessions(sessions);
          setShowRecovery(true);
        });
      }
    });
  }, []);

  // beforeunload: attempt save, let browser show unsaved warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (editor.state.dirty) {
        editor.save();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editor, editor.state.dirty]);

  // visibilitychange: save when tab becomes hidden
  useEffect(() => {
    const handler = () => {
      if (document.hidden && editor.state.dirty) {
        editor.save();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [editor, editor.state.dirty]);

  // pagehide: save when navigating away
  useEffect(() => {
    const handler = () => {
      if (editor.state.dirty) {
        editor.save();
      }
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [editor, editor.state.dirty]);

  // Native paste event listener (cross-platform, works on Wayland).
  // Captures clipboard data from the DOM event directly, bypassing
  // the permission-gated `navigator.clipboard.read()` Web API.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as ClipboardEvent;
      // Skip if the event target is an input/textarea (browser default is fine)
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      captureClipboardEvent(ce);
      // Let the editor paste handler process the captured event data
      editor.paste();
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [editor]);

  // ── Recovery dialog handlers ─────────────────────────────────────────────
  const handleRecoveryRestore = useCallback(
    (id: string) => {
      const mgr = getSharedRecoveryManager();
      mgr.restoreSession(id).then((data) => {
        if (data) {
          editor.loadDocument(JSON.stringify(data.document), { name: data.tabName });
          mgr.deleteSession(id);
        }
      });
    },
    [editor],
  );

  const handleRecoveryDiscard = useCallback((id: string) => {
    const mgr = getSharedRecoveryManager();
    mgr.deleteSession(id).then(() => {
      setRecoverySessions((prev) => prev.filter((s) => s.id !== id));
    });
  }, []);

  const handleRecoveryRestoreAll = useCallback(() => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const session of sessions) {
        mgr.restoreSession(session.id).then((data) => {
          if (data) {
            editor.loadDocument(JSON.stringify(data.document), { name: data.tabName });
            mgr.deleteSession(session.id);
          }
        });
      }
    });
    setShowRecovery(false);
  }, [editor]);

  const handleRecoveryDiscardAll = useCallback(() => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const s of sessions) {
        mgr.deleteSession(s.id);
      }
    });
    setRecoverySessions([]);
    setShowRecovery(false);
  }, []);

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
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    'general' | 'appearance' | 'shortcuts' | 'export' | 'models' | 'collab' | 'ai' | 'about'
  >('general');
  const [batchBgRemoveOpen, setBatchBgRemoveOpen] = useState(false);
  const { shellStyle, widths, setWidth } = usePanelWidths();

  // Register all actions into the ActionRegistry once on mount
  useEffect(() => {
    registerAllShortcuts(() => null);
    registerEditorActions(editor);
  }, [editor]);

  const tutorialProgress = useTutorialProgress(editor.state.document);

  const onboarding = useOnboarding(editor.platform);

  // ── Onboarding checklist ────────────────────────────────
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistProgress, setChecklistProgressState] = useState<string[]>(() => {
    const saved = loadOnboardingState();
    return saved.checklistProgress;
  });

  const updateChecklistProgress = useCallback(
    (itemId: string) => {
      setChecklistProgressState((prev) => {
        if (prev.includes(itemId)) return prev;
        const updated = [...prev, itemId];
        const saved = loadOnboardingState();
        saveOnboardingState(checkChecklistItem(saved, itemId), platform);
        return updated;
      });
    },
    [platform],
  );

  const dismissChecklist = useCallback(() => {
    setChecklistOpen(false);
  }, []);

  // Auto-detect checklist progress from user actions
  useEffect(() => {
    const tracker = getActionTracker();
    if (tracker.getCount('op:createNode', 300_000) > 0) updateChecklistProgress('shape');
    if (tracker.getCount('menu:fill', 300_000) > 0) updateChecklistProgress('color');
    if (tracker.getCount('tool:text', 300_000) > 0) updateChecklistProgress('text');
    if (
      tracker.getCount('shortcut:group', 600_000) > 0 ||
      tracker.getCount('tool:select', 600_000) > 0
    ) {
      const saved = loadOnboardingState();
      if (saved.checklistProgress.includes('shape') && saved.checklistProgress.includes('color')) {
        updateChecklistProgress('group');
      }
    }
    if (tracker.getCount('export', 600_000) > 0) updateChecklistProgress('export');
  }, [updateChecklistProgress, platform]);

  // Show checklist after welcome is dismissed, if not yet completed
  useEffect(() => {
    if (!onboarding.showWelcome && !onboarding.active) {
      const saved = loadOnboardingState();
      const allDone = CHECKLIST_ITEMS.every((item) => saved.checklistProgress.includes(item.id));
      if (!saved.onboardingComplete || !allDone) {
        setChecklistOpen(true);
      }
    }
  }, [onboarding.showWelcome, onboarding.active]);

  // ── Did You Know? contextual tips ───────────────────────
  const {
    currentTip: didYouKnowTip,
    dismiss: dismissTip,
    dontShowAgain: dontShowAgainTip,
  } = useDidYouKnow(getActionTracker());

  const handlePaletteSelect = useCallback((id: string) => {
    const input = fileRef.current;
    if (id === 'open' && input) {
      input.click();
    }
  }, []);

  const currentStep = onboarding.stepIndex >= 0 && onboarding.active ? onboarding.stepIndex : -1;

  // Desktop panel visibility (Ctrl+B / Ctrl+Shift+B): collapse the grid
  // column so the canvas reclaims the space.
  const { leftPanelVisible, rightPanelVisible } = editor.state;
  const gridStyle: React.CSSProperties = { ...shellStyle };
  if (!leftPanelVisible) (gridStyle as Record<string, string>)['--sidebar-width'] = '0px';
  if (!rightPanelVisible) (gridStyle as Record<string, string>)['--inspector-width'] = '0px';

  // ── Unified DndContext (cross-panel drag & drop) ─────────────────────

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const layersDndRef = useRef<LayersDnDHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const lastPointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeDragNode, setActiveDragNode] = useState<{ id: NodeId; name: string } | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      // Notify layers tree to track active id for DragOverlay
      layersDndRef.current?.handleDragStart(event);

      // Set active drag overlay content
      const data = event.active.data.current as DragNodeData | undefined;
      if (data?.type === 'layer') {
        const node = editor.state.document.nodes[data.nodeId];
        if (node) {
          setActiveDragNode({ id: data.nodeId, name: node.name });
        }
      }
    },
    [editor],
  );

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    layersDndRef.current?.handleDragMove(event);
    // Track pointer position for canvas drop detection
    const ev = event.activatorEvent;
    if (ev instanceof MouseEvent || ev instanceof PointerEvent) {
      lastPointerPos.current = { x: ev.clientX, y: ev.clientY };
    }
  }, []);

  const handleDragOver = useCallback((event: import('@dnd-kit/core').DragOverEvent) => {
    layersDndRef.current?.handleDragOver(event);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const data = active.data.current as DragNodeData | undefined;

      // Cross-panel drop: layer from tree → canvas
      if (over?.id === 'canvas-drop-zone' && data?.type === 'layer') {
        setActiveDragNode(null);
        // Move the node to root level at the drop position
        const nodeId = data.nodeId as string;
        const canvasSection = document.querySelector('.editor-canvas');
        const canvasEl = canvasSection?.querySelector('canvas');
        if (canvasEl) {
          const rect = canvasEl.getBoundingClientRect();
          const cam = {
            pan: editor.state.pan,
            zoom: editor.state.zoom,
          };
          const [wx, wy] = screenToWorld(
            cam,
            lastPointerPos.current.x - rect.left,
            lastPointerPos.current.y - rect.top,
          );
          // Append to the end of the active page's top level (reparentNode
          // clamps toIndex to the target list's actual length).
          editor.reparentNode(nodeId, null, Number.MAX_SAFE_INTEGER);
          editor.setNodePosition(nodeId, wx, wy);
          editor.setSelection(nodeId);
          editor.announce('Moved layer to canvas');
        }
        return;
      }

      // Delegate to layers tree for internal reorder
      layersDndRef.current?.handleDragEnd(event);
      setActiveDragNode(null);
    },
    [editor],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="editor-shell" style={gridStyle}>
        <Menubar
          onBackToHome={onBackToHome}
          onOpenSettings={() => {
            setSettingsSection('general');
            setSettingsOpen(true);
          }}
          onStartTour={onboarding.reopen}
          onOpenPalette={openPalette}
          onOpenHelp={editorHelp.openContextualHelp}
          onOpenHelpCenter={() => editorHelp.setHelpCenterOpen(true)}
          onWhatIsThis={editorHelp.toggleWhatIsThis}
          onOpenAbout={() => {
            setSettingsSection('about');
            setSettingsOpen(true);
          }}
          onBatchBgRemove={() => setBatchBgRemoveOpen(true)}
        />
        <FloatingToolbar />
        <TabStrip onBackToHome={onBackToHome} />
        <ErrorBoundary>
          <CanvasArea
            canvasContainerRef={canvasContainerRef}
            onContextMenu={handleCanvasContextMenu}
          />
        </ErrorBoundary>
        <CollabCursorOverlay
          users={collabUsers}
          cursors={[]}
          worldToScreen={(wx, wy) => editor.worldToCanvas(wx, wy)}
        />
        <TutorialBanner
          progress={tutorialProgress}
          onComplete={() => {
            const state = loadOnboardingState();
            saveOnboardingState(markTutorialComplete(state));
          }}
        />
        <SoftProofOverlay softProofEnabled={editor.state.softProofEnabled} />
        <div className="page-nav-container">
          <PageNav />
        </div>
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
            <LayersPanel dndRef={layersDndRef} />
          </ErrorBoundary>
          <PanelResizeHandle
            side="layers"
            width={widths.layers}
            onResize={(w) => setWidth('layers', w)}
          />
        </div>
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
        {libraryVisible && (
          <div className="editor__library-panel" data-panel="library">
            <LibraryPanel
              doc={editor.state.document}
              onInstallLibrary={editor.installLibrary}
              onUninstallLibrary={editor.uninstallLibrary}
            />
          </div>
        )}
        {editor.state.timelinePanelVisible && (
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
                motionPresets={editor.state.document.motionPresets ?? {}}
                selectedTrackIds={editor.state.motion.selectedTrackIds}
                selectedKeyframeIndex={null}
                onPlay={() => editor.playTimeline()}
                onPause={() => editor.pauseTimeline()}
                onStop={() => editor.stopTimeline()}
                onSeek={(time) => editor.seekTimeline(time)}
                onSpeedChange={(speed) => editor.setPlaybackSpeed(speed)}
                onToggleLoop={() => editor.toggleLoop()}
                onToggleAutoKeyframe={() => editor.toggleAutoKeyframe()}
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
                onSelectTrack={() => {}}
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
        <SelectionInfoBar />
        <StatusBar />
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
          onClick={() => setLibraryVisible((v) => !v)}
          aria-label={libraryVisible ? 'Hide library panel' : 'Show library panel'}
        >
          <Icon name="Library" />
        </button>
        {/* Backdrop for overlays */}
        {(layersVisible || inspectorVisible || libraryVisible) && (
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismisses panels
          <div
            className="editor__panel-backdrop"
            onClick={() => {
              setLayersVisible(false);
              setInspectorVisible(false);
              setLibraryVisible(false);
            }}
            role="presentation"
          />
        )}
        <ShortcutPalette open={paletteOpen} onClose={closePalette} onSelect={handlePaletteSelect} />
        <QuickActionsBar
          open={quickActionsOpen}
          onClose={() => setQuickActionsOpen(false)}
          onExecute={(id) => {
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
          accept=".strata,.json"
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
          accept=".svg,.png,.jpg,.jpeg,.webp,.gif,.pdf,.ai,.eps,.psd,.psb,.sketch"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            try {
              const { ImportService } = await import('@strata/import');
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
            onboarding.resetWelcome();
          }}
        />

        {/* Export dialog */}
        <ExportDialog
          isOpen={editor.showExportDialog}
          onClose={() => editor.setShowExportDialog(false)}
          nodes={editor.rootNodes()}
          timelines={editor.state.document.timelines}
          document={editor.state.document}
          selectionIds={editor.state.selection}
          onExport={handleExportBatch}
          onPackageExport={handlePackageExport}
          onExportMotion={handleExportMotion}
          onSaveVideoFile={handleSaveVideoFile}
          onApplyBackgroundRemoval={(id, state) => {
            editor.updateNode(id, (n) => ({ ...n, backgroundRemoval: state }));
          }}
        />

        {editor.state.subjectPickerSession && (
          <SubjectPickerOverlay
            session={editor.state.subjectPickerSession}
            onConfirm={(keepIds) => editor.confirmSubjectPicker(keepIds)}
            onCancel={() => editor.cancelSubjectPicker()}
          />
        )}

        {/* Onboarding: Welcome dialog */}
        <WelcomeDialog
          open={onboarding.showWelcome && onboarding.active && !showRecovery}
          onStartTour={onboarding.startTour}
          onStartTutorial={() => {
            const tutorialDoc = createTutorialDocument();
            editor.updateDoc(() => tutorialDoc);
            onboarding.dismiss();
          }}
          onStartBlank={() => {
            onboarding.dismiss();
          }}
          onStartTemplate={() => {
            onboarding.dismiss();
            onBackToHome?.();
          }}
          onClose={onboarding.dismiss}
        />

        {/* Onboarding: Spotlight tour overlay */}
        {currentStep >= 0 &&
          onboarding.active &&
          (() => {
            const step = TOUR_STEPS[currentStep];
            if (!step) return null;
            return (
              <SpotlightOverlay
                stepIndex={currentStep}
                totalSteps={TOUR_STEPS.length}
                step={step}
                onNext={onboarding.nextStep}
                onPrev={onboarding.prevStep}
                onDismiss={onboarding.dismiss}
              />
            );
          })()}

        {/* Recovery dialog for crash-recovery sessions */}
        <RecoveryDialog
          open={showRecovery}
          sessions={recoverySessions}
          onRestore={handleRecoveryRestore}
          onDiscard={handleRecoveryDiscard}
          onRestoreAll={handleRecoveryRestoreAll}
          onDiscardAll={handleRecoveryDiscardAll}
          onClose={() => setShowRecovery(false)}
        />

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

        {/* Onboarding checklist */}
        <OnboardingChecklist
          open={checklistOpen}
          onClose={() => setChecklistOpen(false)}
          progress={checklistProgress}
          onItemClick={(id) => updateChecklistProgress(id)}
          onDismiss={dismissChecklist}
        />

        {/* Did You Know? contextual tips */}
        {didYouKnowTip && (
          <DidYouKnowTip
            tip={didYouKnowTip}
            onDismiss={dismissTip}
            onDontShowAgain={dontShowAgainTip}
          />
        )}

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
            const items: MenuEntry[] = [
              ...(hasSelection
                ? [
                    {
                      id: 'ctx-cut',
                      label: 'Cut',
                      onAction: () => {
                        editor.cutSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                    {
                      id: 'ctx-copy',
                      label: 'Copy',
                      onAction: () => {
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
                        editor.duplicateSelected();
                        closeMenu();
                      },
                    } satisfies MenuEntry,
                    {
                      id: 'ctx-del',
                      label: 'Delete',
                      onAction: () => {
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
                        editor.ungroupSelected();
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

        {/* Batch background removal dialog */}
        <BatchBgRemoveDialog
          open={batchBgRemoveOpen}
          onClose={() => setBatchBgRemoveOpen(false)}
          nodes={editor.state.selection
            .map((id) => editor.state.document.nodes[id])
            .filter((n): n is import('@strata/scene').ShapeNode => !!n && isImageShape(n))}
          onNodeUpdate={(id, state) => {
            editor.updateNode(id, (n) => ({ ...n, backgroundRemoval: state }));
          }}
        />
      </div>

      {/* DragOverlay for cross-panel drag */}
      <DragOverlay dropAnimation={null}>
        {activeDragNode ? (
          <div
            className="drag-overlay"
            style={{
              padding: '4px 12px',
              background: 'var(--color-surface-raised)',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {activeDragNode.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Bridges the @strata/ui Toast system into the editor context's showToast(). */
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
  openFile,
  platform,
  active,
}: ShellProps) {
  return (
    <EditorProvider
      onBackToHome={onBackToHome}
      initialDocumentJson={documentJson}
      initialDocumentName={documentName}
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
