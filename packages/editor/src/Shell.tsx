import { Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import { CanvasArea } from './CanvasArea';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from './components/Onboarding';
import { TOUR_STEPS } from './components/Onboarding/tourSteps';
import { SettingsProvider } from './components/Settings/SettingsContext';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { EditorProvider, useEditor } from './context';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import { StatusBar } from './StatusBar';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';

export interface ShellProps {
  onBackToHome?: () => void;
  documentJson?: string;
  documentName?: string;
}

function ShellInner({ onBackToHome }: { onBackToHome?: () => void }) {
  const editor = useEditor();
  const { paletteOpen, closePalette, openPalette } = useShortcuts(editor);
  const fileRef = useRef<HTMLInputElement>(null);
  const [layersVisible, setLayersVisible] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onboarding = useOnboarding();

  const handlePaletteSelect = useCallback((id: string) => {
    const input = fileRef.current;
    if (id === 'open' && input) {
      input.click();
    }
  }, []);

  const currentStep = onboarding.stepIndex >= 0 && onboarding.active ? onboarding.stepIndex : -1;

  return (
    <div className="editor-shell gpu-layer">
      <Menubar
        onBackToHome={onBackToHome}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTour={onboarding.reopen}
        onOpenPalette={openPalette}
      />
      <FloatingToolbar />
      <TabStrip />
      <CanvasArea />
      <div className="editor__layers-panel" data-visible={layersVisible || undefined}>
        <LayersPanel />
      </div>
      <div className="editor__inspector-panel" data-visible={inspectorVisible || undefined}>
        <PropertiesPanel />
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

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

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
