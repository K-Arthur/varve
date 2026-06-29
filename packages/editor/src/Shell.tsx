import { useCallback, useRef } from 'react';
import { CanvasArea } from './CanvasArea';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import { EditorProvider, useEditor } from './context';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import { StatusBar } from './StatusBar';
import { ShortcutPalette, useShortcuts } from './shortcuts';
import { TabStrip } from './TabStrip';
import { ToolPanel } from './ToolPanel';

export interface ShellProps {
  onBackToHome?: () => void;
  documentJson?: string;
  documentName?: string;
}

function ShellInner({ onBackToHome }: { onBackToHome?: () => void }) {
  const editor = useEditor();
  const { paletteOpen, closePalette } = useShortcuts(editor);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePaletteSelect = useCallback((id: string) => {
    const input = fileRef.current;
    if (id === 'open' && input) {
      input.click();
    }
  }, []);

  return (
    <div className="editor-shell">
      <Menubar onBackToHome={onBackToHome} />
      <ToolPanel />
      <TabStrip />
      <CanvasArea />
      <LayersPanel />
      <PropertiesPanel />
      <StatusBar />
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
    <EditorProvider onBackToHome={onBackToHome} initialDocumentJson={documentJson} initialDocumentName={documentName}>
      <ShellInner onBackToHome={onBackToHome} />
    </EditorProvider>
  );
}
