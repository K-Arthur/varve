import { Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import { CanvasArea } from './CanvasArea';
import { ExportDialog } from './components/Export/ExportDialog';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from './components/Onboarding';
import { TOUR_STEPS } from './components/Onboarding/tourSteps';
import { PrototypePresenter } from './components/Prototype/PrototypePresenter';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { PanelResizeHandle, usePanelWidths } from './components/PanelResizeHandle';
import { EditorProvider, useEditor } from './context';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import { StatusBar } from './StatusBar';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';
import './components/Prototype/prototype.css';

export interface ShellProps {
  onBackToHome?: () => void;
  documentJson?: string;
  documentName?: string;
}

function ShellInner({ onBackToHome }: { onBackToHome?: () => void }) {
  const editor = useEditor();
  const { paletteOpen, closePalette, openPalette } = useShortcuts(editor, onBackToHome);
  const fileRef = useRef<HTMLInputElement>(null);
  const [layersVisible, setLayersVisible] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { shellStyle, widths, setWidth } = usePanelWidths();

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

  return (
    <div className="editor-shell gpu-layer" style={gridStyle}>
      <Menubar
        onBackToHome={onBackToHome}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTour={onboarding.reopen}
        onOpenPalette={openPalette}
      />
      <FloatingToolbar />
      <TabStrip onBackToHome={onBackToHome} />
      <CanvasArea />
      <div
        className="editor__layers-panel"
        data-visible={layersVisible || undefined}
        data-collapsed={!leftPanelVisible || undefined}
      >
        <LayersPanel />
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
  );
}

export function Shell({ onBackToHome, documentJson, documentName }: ShellProps) {
  return (
    <EditorProvider
      onBackToHome={onBackToHome}
      initialDocumentJson={documentJson}
      initialDocumentName={documentName}
    >
      <SettingsProvider>
        <ShellInner onBackToHome={onBackToHome} />
      </SettingsProvider>
    </EditorProvider>
  );
}
