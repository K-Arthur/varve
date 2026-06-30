import { Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import { CanvasArea } from './CanvasArea';
import { FloatingToolbar } from './components/FloatingToolbar/FloatingToolbar';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
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
  const { paletteOpen, closePalette } = useShortcuts(editor);
  const fileRef = useRef<HTMLInputElement>(null);
  const [layersVisible, setLayersVisible] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);

  const handlePaletteSelect = useCallback((id: string) => {
    const input = fileRef.current;
    if (id === 'open' && input) {
      input.click();
    }
  }, []);

  return (
    <div className="editor-shell">
      <Menubar onBackToHome={onBackToHome} />
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
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 'calc(var(--z-overlay) - 1)',
            background: 'rgba(0,0,0,0.3)',
          }}
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
      <ShellInner onBackToHome={onBackToHome} />
    </EditorProvider>
  );
}
