import type { ColorMode, ManagedColor } from '@strata/scene';
import { managedColorToCss } from '@strata/shared';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';

function whiteForMode(mode: ColorMode): ManagedColor {
  switch (mode) {
    case 'cmyk':
      return { space: 'cmyk', c: 0, m: 0, y: 0, k: 0, a: 255 };
    case 'grayscale':
      return { space: 'gray', v: 255, a: 255 };
    default:
      return { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };
  }
}

/** Document-wide settings are available without changing the current selection. */
export function DocumentPanel() {
  const { state, setCanvasBackground, switchColorMode, documentColorMode } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;
  const fallbackColor = useMemo(() => whiteForMode(documentColorMode), [documentColorMode]);
  const canvasBgColor = doc.canvasBackground ?? fallbackColor;
  const swatchBackground = useMemo(() => managedColorToCss(canvasBgColor), [canvasBgColor]);

  return (
    <>
      <DisclosureSection title="Canvas" sectionId="canvas-background" defaultExpanded>
        <div className="insp-canvas-props">
          <div className="insp-field">
            <span className="insp-field__label">Background</span>
            <div className="insp-field__control">
              <InspectorColorPopover
                label="Canvas background"
                value={canvasBgColor}
                onChange={setCanvasBackground}
                swatchStyle={{ background: swatchBackground }}
                documentColorMode={documentColorMode}
              />
            </div>
          </div>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Document Color" sectionId="document-color" defaultExpanded>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Mode</span>
          <div className="insp-panel__color-mode-buttons">
            {(['rgb', 'cmyk', 'grayscale'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`insp-panel__color-mode-btn${documentColorMode === mode ? ' insp-panel__color-mode-btn--active' : ''}`}
                onClick={() => switchColorMode(mode)}
                aria-pressed={documentColorMode === mode}
              >
                {mode === 'rgb' ? 'RGB' : mode === 'cmyk' ? 'CMYK' : 'Grayscale'}
              </button>
            ))}
          </div>
        </div>
      </DisclosureSection>
      <div className="insp-panel__canvas-info">
        <p className="insp-panel__canvas-name">{doc.name}</p>
        <p className="insp-panel__canvas-count">
          {count} {count === 1 ? 'node' : 'nodes'}
        </p>
      </div>
    </>
  );
}
