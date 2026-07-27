import type { ColorMode, ManagedColor } from '@strata/scene';
import { managedColorToCss } from '@strata/shared';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';

export function whiteForMode(mode: ColorMode): ManagedColor {
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
  const {
    state,
    setCanvasBackground,
    switchColorMode,
    documentColorMode,
    setDocumentGrid,
    setPixelGridSnapEnabled,
    resetGridOrigin,
  } = useEditor();
  const doc = state.document;
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
      <DisclosureSection title="Document Grid" sectionId="document-grid" defaultExpanded={false}>
        <div className="insp-canvas-props" role="region" aria-live="polite" aria-label="Document grid settings">
          <div className="insp-field">
            <span className="insp-field__label">Visible</span>
            <div className="insp-field__control insp-field__control--inline">
              <label>
                <input
                  type="checkbox"
                  checked={state.documentGrid.visible}
                  onChange={(e) => {
                    setDocumentGrid({
                      ...state.documentGrid,
                      visible: e.target.checked,
                    });
                  }}
                  aria-label={`Grid visibility ${state.documentGrid.visible ? 'enabled' : 'disabled'}`}
                />
                Show grid
              </label>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Spacing X</span>
            <div className="insp-field__control">
              <input
                type="number"
                min="1"
                max="200"
                value={state.documentGrid.spacingX}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isNaN(value) && value > 0) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      spacingX: value,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid horizontal spacing ${state.documentGrid.spacingX} pixels`}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Spacing Y</span>
            <div className="insp-field__control">
              <input
                type="number"
                min="1"
                max="200"
                value={state.documentGrid.spacingY}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isNaN(value) && value > 0) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      spacingY: value,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid vertical spacing ${state.documentGrid.spacingY} pixels`}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Subdivisions</span>
            <div className="insp-field__control">
              <input
                type="number"
                min="1"
                max="10"
                value={state.documentGrid.subdivisions}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value > 0) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      subdivisions: value,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid subdivisions ${state.documentGrid.subdivisions}`}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Offset X</span>
            <div className="insp-field__control">
              <input
                type="number"
                value={state.documentGrid.offsetX}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isNaN(value)) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      offsetX: value,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid horizontal offset ${state.documentGrid.offsetX} pixels`}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Offset Y</span>
            <div className="insp-field__control">
              <input
                type="number"
                value={state.documentGrid.offsetY}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isNaN(value)) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      offsetY: value,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid vertical offset ${state.documentGrid.offsetY} pixels`}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Color</span>
            <div className="insp-field__control">
              <InspectorColorPopover
                label="Grid color"
                value={{ space: 'rgb', r: 128, g: 128, b: 128, a: 255 }}
                onChange={(color) => {
                  // Convert color to CSS string
                  const cssColor = managedColorToCss(color);
                  setDocumentGrid({
                    ...state.documentGrid,
                    color: cssColor,
                  });
                }}
                swatchStyle={{ background: state.documentGrid.color }}
                documentColorMode={documentColorMode}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Opacity</span>
            <div className="insp-field__control">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={state.documentGrid.opacity}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  setDocumentGrid({
                    ...state.documentGrid,
                    opacity: value,
                  });
                }}
                className="insp-range"
              />
              <output>{Math.round(state.documentGrid.opacity * 100)}%</output>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Snap to Pixels</span>
            <div className="insp-field__control insp-field__control--inline">
              <label>
                <input
                  type="checkbox"
                  checked={state.pixelGridSnapEnabled}
                  onChange={(e) => {
                    setPixelGridSnapEnabled(e.target.checked);
                  }}
                  aria-label={`Snap to pixels ${e.target.checked ? 'enabled' : 'disabled'}`}
                />
                Snap to integer pixels
              </label>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Grid Origin</span>
            <div className="insp-field__control insp-field__control--inline">
              <button
                type="button"
                className="insp-btn"
                onClick={() => {
                  resetGridOrigin();
                }}
                aria-label="Reset grid origin to zero"
              >
                Reset Origin
              </button>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Rotation (degrees)</span>
            <div className="insp-field__control">
              <input
                type="number"
                min="0"
                max="360"
                step="15"
                value={((state.documentGrid.rotation ?? 0) * 180) / Math.PI}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isNaN(value)) {
                    setDocumentGrid({
                      ...state.documentGrid,
                      rotation: (value * Math.PI) / 180,
                    });
                  }
                }}
                className="insp-num__input"
                aria-label={`Grid rotation ${Math.round(((state.documentGrid.rotation ?? 0) * 180) / Math.PI)} degrees`}
              />
              <button
                type="button"
                className="insp-btn"
                onClick={() => {
                  setDocumentGrid({
                    ...state.documentGrid,
                    rotation: 0,
                  });
                }}
                aria-label="Reset grid rotation to zero"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </DisclosureSection>
    </>
  );
}
