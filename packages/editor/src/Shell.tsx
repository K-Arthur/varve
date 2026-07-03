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
import type { NodeId } from '@strata/scene';
import { screenToWorld } from '@strata/shared';
import { Icon } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { registerAllShortcuts, registerEditorActions } from './actions/registerAll';
import { CanvasArea } from './CanvasArea';
import { ExportDialog } from './components/Export/ExportDialog';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import type { LayersDnDHandle } from './components/LayersPanel/LayersTree';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from './components/Onboarding';
import { TOUR_STEPS } from './components/Onboarding/tourSteps';
import { PanelResizeHandle, usePanelWidths } from './components/PanelResizeHandle';
import { PrototypePresenter } from './components/Prototype/PrototypePresenter';
import { QuickActionsBar } from './components/QuickActionsBar/QuickActionsBar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { EditorProvider, useEditor } from './context';
import type { DragNodeData } from './dnd-types';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import { getSharedRecoveryManager, type RecoverySession } from './recovery';
import { StatusBar } from './StatusBar';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';
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
}

function ShellInner({
  onBackToHome,
  openFile,
  active = true,
}: {
  onBackToHome?: () => void;
  openFile?: OpenFileRequest | null;
  active?: boolean;
}) {
  const editor = useEditor();
  const { paletteOpen, closePalette, openPalette, quickActionsOpen, setQuickActionsOpen } =
    useShortcuts(editor, onBackToHome, active);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { shellStyle, widths, setWidth } = usePanelWidths();

  // Register all actions into the ActionRegistry once on mount
  useEffect(() => {
    registerAllShortcuts(() => null);
    registerEditorActions(editor);
  }, [editor]);

  const onboarding = useOnboarding();

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
            pan: [editor.state.pan.x, editor.state.pan.y] as [number, number],
            zoom: editor.state.zoom,
          };
          const [wx, wy] = screenToWorld(
            cam,
            lastPointerPos.current.x - rect.left,
            lastPointerPos.current.y - rect.top,
          );
          editor.reparentNode(nodeId, null, editor.state.document.rootChildren.length);
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
      <div className="editor-shell gpu-layer" style={gridStyle}>
        <Menubar
          onBackToHome={onBackToHome}
          onOpenSettings={() => setSettingsOpen(true)}
          onStartTour={onboarding.reopen}
          onOpenPalette={openPalette}
        />
        <FloatingToolbar />
        <TabStrip onBackToHome={onBackToHome} />
        <CanvasArea canvasContainerRef={canvasContainerRef} />
        <div
          className="editor__layers-panel"
          data-visible={layersVisible || undefined}
          data-collapsed={!leftPanelVisible || undefined}
        >
          <LayersPanel dndRef={layersDndRef} />
          <PanelResizeHandle
            side="layers"
            width={widths.layers}
            onResize={(w) => setWidth('layers', w)}
          />
        </div>
        <div
          className="editor__inspector-panel"
          data-visible={inspectorVisible || undefined}
          data-collapsed={!rightPanelVisible || undefined}
        >
          <PropertiesPanel />
          <PanelResizeHandle
            side="inspector"
            width={widths.inspector}
            onResize={(w) => setWidth('inspector', w)}
          />
        </div>
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
        {/* Backdrop for overlays */}
        {(layersVisible || inspectorVisible) && (
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismisses panels
          <div
            className="editor__panel-backdrop"
            onClick={() => {
              setLayersVisible(false);
              setInspectorVisible(false);
            }}
            onKeyDown={() => {}}
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
          accept=".json"
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
          accept=".svg,.png,.jpg,.jpeg,.webp,.gif"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            for (const file of files) {
              const ext = file.name.split('.').pop()?.toLowerCase();
              if (ext === 'svg') {
                const text = await file.text();
                const { importFile } = await import('@strata/import');
                const result = importFile(file.name, text, { center: true, embedImages: true });
                for (const id of result.nodeIds) {
                  const node = result.document.nodes[id];
                  if (node) editor.importNode(node, result.document);
                }
              } else if (ext && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
                const buf = await file.arrayBuffer();
                const { importFile } = await import('@strata/import');
                const result = importFile(file.name, new Uint8Array(buf), {
                  center: true,
                  embedImages: true,
                });
                for (const id of result.nodeIds) {
                  const node = result.document.nodes[id];
                  if (node) editor.importNode(node, result.document);
                }
              }
            }
            e.target.value = '';
          }}
        />

        {/* Settings dialog */}
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {/* Export dialog */}
        <ExportDialog
          isOpen={editor.showExportDialog}
          onClose={() => editor.setShowExportDialog(false)}
          nodes={editor.rootNodes()}
          onExport={async () => {}}
        />

        {/* Onboarding: Welcome dialog */}
        <WelcomeDialog
          open={onboarding.showWelcome && onboarding.active}
          onStartTour={onboarding.startTour}
          onStartFromScratch={() => {
            onboarding.dismiss();
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
              fontSize: '13px',
            }}
          >
            {activeDragNode.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function Shell({ onBackToHome, documentJson, documentName, openFile, active }: ShellProps) {
  return (
    <EditorProvider
      onBackToHome={onBackToHome}
      initialDocumentJson={documentJson}
      initialDocumentName={documentName}
    >
      <SettingsProvider>
        <ShellInner onBackToHome={onBackToHome} openFile={openFile} active={active} />
      </SettingsProvider>
    </EditorProvider>
  );
}
