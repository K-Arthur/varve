/**
 * Editor app shell — CSS Grid layout (Strata plan §5.1).
 *
 * Wraps menubar, toolbar, canvas, layers, inspector, and status bar in a
 * resizable grid. All visual properties trace to token CSS custom properties.
 */

import { CanvasArea } from './CanvasArea';
import { EditorProvider } from './context';
import { InspectorPanel } from './InspectorPanel';
import { LayersPanel } from './LayersPanel';
import { Menubar } from './Menubar';
import { StatusBar } from './StatusBar';
import { ToolPanel } from './ToolPanel';

export function Shell() {
  return (
    <EditorProvider>
      <div className="editor-shell">
        <Menubar />
        <ToolPanel />
        <CanvasArea />
        <LayersPanel />
        <InspectorPanel />
        <StatusBar />
      </div>
    </EditorProvider>
  );
}
