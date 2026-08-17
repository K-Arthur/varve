import type { BitDepth, ColorMode, IsometricAxis, ManagedColor, WorkingSpace } from '@varve/scene';
import {
  CMYK_PROFILES,
  ISOMETRIC_PRESETS,
  normaliseAngle,
  validateIsometricAxes,
} from '@varve/scene';
import { cssStringToManagedColor, managedColorToCss } from '@varve/shared';
import { Select } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { PagePrintSection } from '../sections/PagePrintSection';

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
    assignDocumentColorMode,
    documentColorMode,
    setDocumentBitDepth,
    setDocumentWorkingSpace,
    setDocumentGrid,
    setPixelGridSnapEnabled,
    resetGridOrigin,
    beginTransaction,
    commitTransaction,
    proofConfig,
    proofEnabled,
    setProofEnabled,
    setProofConfig,
  } = useEditor();
  const doc = state.document;
  const colorConfig = doc.colorConfig;
  const documentBitDepth: BitDepth = colorConfig?.bitDepth ?? 'uint8';
  const workingSpace: WorkingSpace = colorConfig?.workingSpace ?? 'srgb';
  const fallbackColor = useMemo(() => whiteForMode(documentColorMode), [documentColorMode]);
  const canvasBgColor = doc.canvasBackground ?? fallbackColor;
  // When no custom background is set the canvas renders the theme sunken colour,
  // not white.  Show that in the swatch so the picker reflects reality.
  const swatchBackground = useMemo(
    () => (doc.canvasBackground ? managedColorToCss(canvasBgColor) : 'var(--color-surface-sunken)'),
    [doc.canvasBackground, canvasBgColor],
  );

  return (
    <>
      <PagePrintSection />
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
                onEditStart={beginTransaction}
                onEditEnd={commitTransaction}
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
                onClick={() => {
                  if (documentColorMode === mode) return;
                  beginTransaction();
                  // Assignment semantics: mode intent changes; stored color
                  // values are NOT rewritten. Convert explicitly to rewrite.
                  assignDocumentColorMode(mode);
                  commitTransaction();
                }}
                aria-pressed={documentColorMode === mode}
                title={
                  documentColorMode === mode
                    ? `Current mode: ${mode}`
                    : `Assign ${mode} mode (keeps color values; converts at export)`
                }
              >
                {mode === 'rgb' ? 'RGB' : mode === 'cmyk' ? 'CMYK' : 'Grayscale'}
              </button>
            ))}
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Assigning a mode changes document intent only — existing colors keep their values and
            are converted at export. Use Convert to rewrite document colors now.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Precision</span>
          <div className="insp-panel__color-mode-buttons">
            {(
              [
                { value: 'uint8', label: '8-bit' },
                { value: 'uint16', label: '16-bit' },
                { value: 'float16', label: '16f' },
                { value: 'float32', label: '32f' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`insp-panel__color-mode-btn${documentBitDepth === opt.value ? ' insp-panel__color-mode-btn--active' : ''}`}
                onClick={() => {
                  if (documentBitDepth === opt.value) return;
                  beginTransaction();
                  setDocumentBitDepth(opt.value);
                  commitTransaction();
                }}
                aria-pressed={documentBitDepth === opt.value}
                title={
                  documentBitDepth === opt.value
                    ? `Default precision: ${opt.label}`
                    : `Author new colors at ${opt.label} precision (existing values unchanged)`
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Precision sets the storage depth for newly authored colors. Existing values are never
            rewritten by this setting. uint16/float colors keep their full channel range through
            save/reopen; display and 8-bit exports quantize only at their explicit boundaries.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Blend space</span>
          <div className="insp-panel__color-mode-buttons">
            {(
              [
                { value: 'srgb', label: 'sRGB' },
                { value: 'linear', label: 'Linear' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`insp-panel__color-mode-btn${workingSpace === opt.value ? ' insp-panel__color-mode-btn--active' : ''}`}
                onClick={() => {
                  if (workingSpace === opt.value) return;
                  beginTransaction();
                  setDocumentWorkingSpace(opt.value);
                  commitTransaction();
                }}
                aria-pressed={workingSpace === opt.value}
                title={
                  workingSpace === opt.value
                    ? `Blend space: ${opt.label}`
                    : `Blend and composite in ${opt.label} light`
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Linear-light blending matches physically correct compositing (multiply, screen,
            overlay). sRGB is the backward-compatible default for existing documents.
          </p>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Soft Proof" sectionId="document-proof" defaultExpanded={false}>
        <div className="insp-canvas-props">
          <div className="insp-field">
            <span className="insp-field__label">Preview</span>
            <div className="insp-field__control insp-field__control--inline">
              <label>
                <input
                  type="checkbox"
                  checked={proofEnabled}
                  onChange={(e) => setProofEnabled(e.target.checked)}
                  aria-label={`Soft proof ${proofEnabled ? 'enabled' : 'disabled'}`}
                />
                Simulate output condition
              </label>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Proof profile</span>
            <div className="insp-field__control">
              <Select
                label="Proof profile"
                aria-label="Proof profile"
                value={proofConfig.profileId}
                options={Object.entries(CMYK_PROFILES).map(([id, p]) => ({
                  value: id,
                  label: p.name,
                }))}
                onChange={(id) =>
                  setProofConfig({
                    ...proofConfig,
                    profileId: id,
                    profileName: CMYK_PROFILES[id as keyof typeof CMYK_PROFILES]?.name,
                  })
                }
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Simulation</span>
            <div className="insp-field__control insp-field__control--inline">
              <label>
                <input
                  type="checkbox"
                  checked={proofConfig.simulatePaperColor}
                  onChange={(e) =>
                    setProofConfig({ ...proofConfig, simulatePaperColor: e.target.checked })
                  }
                />
                Paper color
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={proofConfig.simulateBlackInk}
                  onChange={(e) =>
                    setProofConfig({ ...proofConfig, simulateBlackInk: e.target.checked })
                  }
                />
                Black ink
              </label>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Gamut warning</span>
            <div className="insp-field__control insp-field__control--inline">
              <label>
                <input
                  type="checkbox"
                  checked={proofConfig.gamutWarning.enabled}
                  onChange={(e) =>
                    setProofConfig({
                      ...proofConfig,
                      gamutWarning: { ...proofConfig.gamutWarning, enabled: e.target.checked },
                    })
                  }
                />
                Show out-of-gamut colors
              </label>
            </div>
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Soft proofing is a display-only preview: document colors are never modified and export
            stays authoritative. Accurate proofing requires a profile-aware runtime; the browser
            shows the source color and reports when proofing is unavailable.
          </p>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Document Grid" sectionId="document-grid" defaultExpanded={false}>
        <fieldset className="insp-canvas-props" aria-label="Document grid settings">
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
                  aria-label={`Snap to pixels ${state.pixelGridSnapEnabled ? 'enabled' : 'disabled'}`}
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
        </fieldset>
      </DisclosureSection>
      <IsometricGridSection />
    </>
  );
}

function IsometricGridSection() {
  const { state, setIsometricGrid, documentColorMode } = useEditor();
  const grid = state.isometricGrid;
  const presetId = grid.preset;

  const axisValidation = useMemo(() => validateIsometricAxes(grid.axes), [grid.axes]);

  const updateGrid = useCallback(
    (patch: Partial<typeof grid>) => {
      setIsometricGrid({ ...grid, ...patch, version: grid.version + 1 });
    },
    [grid, setIsometricGrid],
  );

  const updateAxis = useCallback(
    (index: number, patch: Partial<IsometricAxis>) => {
      const nextAxes = grid.axes.map((a, i) => (i === index ? { ...a, ...patch } : a));
      updateGrid({ axes: nextAxes, preset: 'custom' });
    },
    [grid.axes, updateGrid],
  );

  const addAxis = useCallback(() => {
    if (grid.axes.length >= 3) return;
    const usedAngles = new Set(grid.axes.map((a) => normaliseAngle(a.angle)));
    let candidate = 0;
    while (usedAngles.has(normaliseAngle(candidate)) && candidate < 360) candidate += 30;
    updateGrid({
      axes: [...grid.axes, { angle: candidate, visible: true, label: 'Axis' }],
      preset: 'custom',
    });
  }, [grid.axes, updateGrid]);

  const removeAxis = useCallback(
    (index: number) => {
      if (grid.axes.length <= 2) return;
      const nextAxes = grid.axes.filter((_, i) => i !== index);
      updateGrid({ axes: nextAxes, preset: 'custom' });
    },
    [grid.axes, updateGrid],
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      if (value === 'custom') {
        updateGrid({ preset: 'custom' });
      } else {
        const preset = ISOMETRIC_PRESETS.find((p) => p.id === value);
        if (preset) {
          updateGrid({
            preset: value as typeof grid.preset,
            axes: preset.axes.map((a) => ({ ...a })),
          });
        }
      }
    },
    [updateGrid],
  );

  const axisColorManaged = useMemo(() => {
    return grid.axes.map((a) => {
      if (a.color) {
        const parsed = cssStringToManagedColor(a.color);
        return (parsed ?? {
          space: 'rgb' as const,
          r: 128,
          g: 128,
          b: 128,
          a: 255,
        }) as ManagedColor;
      }
      return { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 } as ManagedColor;
    });
  }, [grid.axes]);

  return (
    <DisclosureSection title="Isometric Grid" sectionId="isometric-grid" defaultExpanded={false}>
      <fieldset className="insp-canvas-props" aria-label="Isometric grid settings">
        <div className="insp-field">
          <span className="insp-field__label">Visible</span>
          <div className="insp-field__control insp-field__control--inline">
            <label>
              <input
                type="checkbox"
                checked={grid.visible}
                onChange={(e) => updateGrid({ visible: e.target.checked })}
                aria-label={`Isometric grid visibility ${grid.visible ? 'enabled' : 'disabled'}`}
              />
              Show isometric grid
            </label>
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Snap Enabled</span>
          <div className="insp-field__control insp-field__control--inline">
            <label>
              <input
                type="checkbox"
                checked={grid.snapEnabled}
                onChange={(e) => updateGrid({ snapEnabled: e.target.checked })}
                aria-label={`Isometric snap ${grid.snapEnabled ? 'enabled' : 'disabled'}`}
              />
              Snap to isometric grid
            </label>
          </div>
        </div>
        <div className="insp-field">
          <Select
            label="Isometric grid preset"
            value={presetId}
            onChange={handlePresetChange}
            options={[
              ...ISOMETRIC_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ...(presetId === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
            ]}
          />
        </div>

        {presetId === 'custom' && (
          <>
            {grid.axes.map((axis, index) => (
              <div
                key={`axis-${axis.angle}`}
                className="insp-field"
                style={{
                  borderBottom: '1px solid var(--color-border-subtle)',
                  paddingBottom: 6,
                  marginBottom: 4,
                }}
              >
                <span className="insp-field__label">{axis.label ?? `Axis ${index + 1}`}</span>
                <div
                  className="insp-field__control"
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>Angle</span>
                    <input
                      type="number"
                      min="0"
                      max="360"
                      step="0.1"
                      value={axis.angle}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v)) updateAxis(index, { angle: v });
                      }}
                      onBlur={() => updateAxis(index, { angle: normaliseAngle(axis.angle) })}
                      className="insp-num__input"
                      style={{ width: 70 }}
                      aria-label={`Axis ${index + 1} angle ${axis.angle} degrees`}
                    />
                    <span style={{ fontSize: 11, opacity: 0.7 }}>deg</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <input
                        type="checkbox"
                        checked={axis.visible}
                        onChange={(e) => updateAxis(index, { visible: e.target.checked })}
                        aria-label={`Axis ${index + 1} visibility`}
                      />
                      Visible
                    </label>
                    <InspectorColorPopover
                      label={`Axis ${index + 1} color`}
                      value={
                        axisColorManaged[index] ??
                        ({ space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 } as ManagedColor)
                      }
                      onChange={(color) =>
                        updateAxis(index, {
                          color: managedColorToCss(
                            color as Parameters<typeof managedColorToCss>[0],
                          ),
                        })
                      }
                      swatchStyle={{ background: axis.color ?? 'rgb(128,128,128)' }}
                      documentColorMode={documentColorMode}
                    />
                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                      {Math.round((axis.opacity ?? 1) * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={axis.opacity ?? 1}
                      onChange={(e) => updateAxis(index, { opacity: parseFloat(e.target.value) })}
                      className="insp-range"
                      style={{ width: 60 }}
                      aria-label={`Axis ${index + 1} opacity`}
                    />
                    {grid.axes.length > 2 && (
                      <button
                        type="button"
                        className="insp-btn"
                        onClick={() => removeAxis(index)}
                        aria-label={`Remove axis ${index + 1}`}
                        style={{ fontSize: 11, padding: '1px 4px' }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {grid.axes.length < 3 && (
              <div className="insp-field">
                <div className="insp-field__control insp-field__control--inline">
                  <button
                    type="button"
                    className="insp-btn"
                    onClick={addAxis}
                    aria-label="Add axis"
                  >
                    + Add Axis
                  </button>
                </div>
              </div>
            )}
            {axisValidation.errors.length > 0 && (
              <div className="insp-field" role="alert">
                <div
                  className="insp-field__control"
                  style={{ fontSize: 11, color: 'var(--color-feedback-warning)' }}
                >
                  {axisValidation.errors.join('; ')}
                </div>
              </div>
            )}
          </>
        )}

        <div className="insp-field">
          <span className="insp-field__label">Spacing</span>
          <div className="insp-field__control">
            <input
              type="number"
              min="1"
              max="10000"
              value={grid.spacing}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v) && v > 0) updateGrid({ spacing: v });
              }}
              className="insp-num__input"
              aria-label={`Isometric grid spacing ${grid.spacing}`}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Origin X</span>
          <div className="insp-field__control">
            <input
              type="number"
              value={grid.originX}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) updateGrid({ originX: v });
              }}
              className="insp-num__input"
              aria-label={`Isometric grid origin X ${grid.originX}`}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Origin Y</span>
          <div className="insp-field__control">
            <input
              type="number"
              value={grid.originY}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) updateGrid({ originY: v });
              }}
              className="insp-num__input"
              aria-label={`Isometric grid origin Y ${grid.originY}`}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Rotation (deg)</span>
          <div className="insp-field__control">
            <input
              type="number"
              min="0"
              max="360"
              step="1"
              value={grid.rotation}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) updateGrid({ rotation: v });
              }}
              className="insp-num__input"
              aria-label={`Isometric grid rotation ${grid.rotation} degrees`}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Color</span>
          <div className="insp-field__control">
            <InspectorColorPopover
              label="Isometric grid color"
              value={
                cssStringToManagedColor(grid.color) ?? {
                  space: 'rgb',
                  r: 128,
                  g: 128,
                  b: 128,
                  a: 255,
                }
              }
              onChange={(color) => updateGrid({ color: managedColorToCss(color) })}
              swatchStyle={{ background: grid.color }}
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
              value={grid.opacity}
              onChange={(e) => updateGrid({ opacity: parseFloat(e.target.value) })}
              className="insp-range"
            />
            <output>{Math.round(grid.opacity * 100)}%</output>
          </div>
        </div>
      </fieldset>
    </DisclosureSection>
  );
}
