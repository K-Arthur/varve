import type {
  BitDepth,
  ColorMode,
  GradientInterpolationSpace,
  IsometricAxis,
  IsometricPlaneId,
  ManagedColor,
  WorkingSpace,
} from '@varve/scene';
import {
  axisAngleToRatio,
  CMYK_PROFILES,
  ISOMETRIC_PLANES,
  ISOMETRIC_PRESETS,
  normaliseAngle,
  ratioToAxisAngleDegrees,
  validateIsometricAxes,
} from '@varve/scene';
import {
  type BlendEvaluationSpace,
  cssStringToManagedColor,
  managedColorToCss,
  resolveBlendEvaluationSpace,
} from '@varve/shared';
import { Select, Switch } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import {
  DEFAULT_VIEWPORT_SETTINGS,
  loadSettings,
  SNAP_TOLERANCE_MAX,
  SNAP_TOLERANCE_MIN,
  updateSettings,
  type ViewportSettingsStore,
} from '../../../settings';
import { LayerStatesSection } from '../../LayersPanel/LayerStatesSection';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';
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
    clearCanvasBackground,
    assignDocumentColorMode,
    documentColorMode,
    setDocumentBitDepth,
    setDocumentBlendEvaluationSpace,
    setDocumentGradientInterpolation,
    setDocumentWorkingSpace,
    setDocumentGrid,
    setLayoutGridVisible,
    setPixelGridEnabled,
    setPixelGridSnapEnabled,
    resetGridOrigin,
    setSnapEnabled,
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
  const blendEvaluationSpace: BlendEvaluationSpace = resolveBlendEvaluationSpace(colorConfig ?? {});
  const gradientInterpolation: GradientInterpolationSpace =
    colorConfig?.defaultGradientInterpolation ?? 'oklab';
  const fallbackColor = useMemo(() => whiteForMode(documentColorMode), [documentColorMode]);
  const canvasBgColor = doc.canvasBackground ?? fallbackColor;
  const [snapPreferences, setSnapPreferences] = useState<ViewportSettingsStore>(
    () => loadSettings().viewport,
  );
  const updateSnapPreferences = useCallback((patch: Partial<ViewportSettingsStore>) => {
    const next = updateSettings({ viewport: patch });
    setSnapPreferences(next.viewport);
  }, []);
  const resetSnapPreferences = useCallback(() => {
    setSnapEnabled(DEFAULT_VIEWPORT_SETTINGS.snapEnabled);
    const next = updateSettings({
      viewport: {
        snapEnabled: DEFAULT_VIEWPORT_SETTINGS.snapEnabled,
        snapTolerancePx: DEFAULT_VIEWPORT_SETTINGS.snapTolerancePx,
        snapToObjects: DEFAULT_VIEWPORT_SETTINGS.snapToObjects,
        snapToPages: DEFAULT_VIEWPORT_SETTINGS.snapToPages,
        snapToGuides: DEFAULT_VIEWPORT_SETTINGS.snapToGuides,
      },
    });
    setSnapPreferences(next.viewport);
  }, [setSnapEnabled]);
  // When no custom background is set the canvas renders the theme sunken colour,
  // not white.  Show that in the swatch so the picker reflects reality.
  const swatchBackground = useMemo(
    () => (doc.canvasBackground ? managedColorToCss(canvasBgColor) : 'var(--color-surface-sunken)'),
    [doc.canvasBackground, canvasBgColor],
  );

  return (
    <>
      <PagePrintSection />
      <DisclosureSection title="Canvas" sectionId="canvas-background">
        <div className="insp-canvas-props">
          <div className="insp-field">
            <span className="insp-field__label">Background</span>
            <div className="insp-field__control insp-field__control--inline">
              <InspectorColorPopover
                label="Canvas background"
                value={canvasBgColor}
                onChange={setCanvasBackground}
                swatchStyle={{ background: swatchBackground }}
                documentColorMode={documentColorMode}
                onEditStart={beginTransaction}
                onEditEnd={commitTransaction}
              />
              <button
                type="button"
                className="insp-btn"
                disabled={!doc.canvasBackground}
                onClick={() => {
                  beginTransaction();
                  clearCanvasBackground();
                  commitTransaction();
                }}
                aria-label="Reset canvas background to default"
              >
                Reset
              </button>
            </div>
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            When no custom background is set the canvas uses the theme surface color.
          </p>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Snapping" sectionId="snapping">
        <fieldset className="insp-canvas-props" aria-label="Pointer snapping settings">
          <div className="insp-field">
            <span className="insp-field__label">Global snap</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Enable magnetic pointer snapping"
                checked={state.snapEnabled}
                onChange={(event) => setSnapEnabled(event.target.checked)}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Tolerance</span>
            <div className="insp-field__control">
              <input
                type="number"
                min={SNAP_TOLERANCE_MIN}
                max={SNAP_TOLERANCE_MAX}
                step="0.5"
                value={snapPreferences.snapTolerancePx}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) updateSnapPreferences({ snapTolerancePx: value });
                }}
                className="insp-num__input"
                aria-label={`Snap tolerance ${snapPreferences.snapTolerancePx} CSS pixels`}
              />
              <span className="insp-num__unit" aria-hidden="true">
                CSS px
              </span>
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label insp-field__label--wrap">Object geometry</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Edges and centers"
                checked={snapPreferences.snapToObjects}
                onChange={(event) => updateSnapPreferences({ snapToObjects: event.target.checked })}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label insp-field__label--wrap">Pages and frames</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Page and frame bounds"
                checked={snapPreferences.snapToPages}
                onChange={(event) => updateSnapPreferences({ snapToPages: event.target.checked })}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Guides</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Ruler and layout guides"
                checked={snapPreferences.snapToGuides}
                onChange={(event) => updateSnapPreferences({ snapToGuides: event.target.checked })}
              />
            </div>
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Tolerance is measured in CSS pixels, so zoom does not change how far the pointer must
            travel. Ctrl/Cmd temporarily bypasses magnetic snapping during a drag. Keyboard nudges,
            grid snap, and pixel snap remain separate operations.
          </p>
          <div className="insp-field">
            <span className="insp-field__label">Defaults</span>
            <div className="insp-field__control insp-field__control--inline">
              <button type="button" className="insp-btn" onClick={resetSnapPreferences}>
                Reset snapping
              </button>
            </div>
          </div>
        </fieldset>
      </DisclosureSection>
      <DisclosureSection title="Document Color" sectionId="document-color">
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Mode</span>
          <SegmentedControl
            label="Document color mode"
            value={documentColorMode}
            options={[
              { value: 'rgb', label: 'RGB' },
              { value: 'cmyk', label: 'CMYK' },
              { value: 'grayscale', label: 'Grayscale' },
            ]}
            className="insp-segmented--distribute"
            onChange={(mode) => {
              if (documentColorMode === mode) return;
              beginTransaction();
              // Assignment semantics: mode intent changes; stored color
              // values are NOT rewritten. Convert explicitly to rewrite.
              assignDocumentColorMode(mode);
              commitTransaction();
            }}
          />
          <p className="insp-panel__color-mode-note" role="note">
            Assigning a mode changes document intent only — existing colors keep their values and
            are converted at export. Use Convert to rewrite document colors now.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Precision</span>
          <SegmentedControl
            label="Document precision"
            value={documentBitDepth}
            options={[
              { value: 'uint8', label: '8-bit' },
              { value: 'uint16', label: '16-bit' },
              { value: 'float16', label: '16f' },
              { value: 'float32', label: '32f' },
            ]}
            className="insp-segmented--distribute"
            onChange={(value) => {
              if (documentBitDepth === value) return;
              beginTransaction();
              setDocumentBitDepth(value);
              commitTransaction();
            }}
          />
          <p className="insp-panel__color-mode-note" role="note">
            Precision sets the storage depth for newly authored colors. Existing values are never
            rewritten by this setting. uint16/float colors keep their full channel range through
            save/reopen; display and 8-bit exports quantize only at their explicit boundaries.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Working RGB</span>
          <SegmentedControl
            label="Working RGB"
            value={workingSpace}
            options={[
              { value: 'srgb', label: 'sRGB' },
              { value: 'linear', label: 'Linear' },
            ]}
            className="insp-segmented--distribute"
            onChange={(value) => {
              if (workingSpace === value) return;
              beginTransaction();
              setDocumentWorkingSpace(value);
              commitTransaction();
            }}
          />
          <p className="insp-panel__color-mode-note" role="note">
            Working RGB describes the document's authored encoding. It is separate from gradient
            interpolation and artistic blend evaluation.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Blend evaluation</span>
          <SegmentedControl
            label="Blend evaluation space"
            value={blendEvaluationSpace}
            options={[
              { value: 'legacy-srgb', label: 'Legacy sRGB' },
              { value: 'linear-srgb', label: 'Linear light' },
            ]}
            className="insp-segmented--distribute"
            onChange={(value) => {
              if (blendEvaluationSpace === value) return;
              beginTransaction();
              setDocumentBlendEvaluationSpace(value);
              commitTransaction();
            }}
          />
          <p className="insp-panel__color-mode-note" role="note">
            Controls the values received by separable artistic blend formulas. Alpha coverage and
            non-separable W3C modes keep their defined semantics.
          </p>
        </div>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Gradient default</span>
          <SegmentedControl
            label="Gradient interpolation default"
            value={gradientInterpolation}
            options={[
              { value: 'oklab', label: 'OKLab' },
              { value: 'oklch', label: 'OKLCH' },
              { value: 'linear-srgb', label: 'Linear RGB' },
              { value: 'srgb', label: 'sRGB' },
              { value: 'hsl', label: 'HSL' },
            ]}
            className="insp-segmented--distribute"
            onChange={(value) => {
              if (gradientInterpolation === value) return;
              beginTransaction();
              setDocumentGradientInterpolation(value);
              commitTransaction();
            }}
          />
          <p className="insp-panel__color-mode-note" role="note">
            New gradients inherit this default. An individual gradient can pin another interpolation
            space; legacy gradients with no metadata remain sRGB.
          </p>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Soft Proof" sectionId="document-proof">
        <div className="insp-canvas-props">
          <div className="insp-field">
            <span className="insp-field__label">Preview</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Simulate output condition"
                checked={proofEnabled}
                onChange={(e) => setProofEnabled(e.target.checked)}
              />
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
              <Switch
                label="Paper color"
                checked={proofConfig.simulatePaperColor}
                onChange={(e) =>
                  setProofConfig({ ...proofConfig, simulatePaperColor: e.target.checked })
                }
              />
              <Switch
                label="Black ink"
                checked={proofConfig.simulateBlackInk}
                onChange={(e) =>
                  setProofConfig({ ...proofConfig, simulateBlackInk: e.target.checked })
                }
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Gamut warning</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Show out-of-gamut colors"
                checked={proofConfig.gamutWarning.enabled}
                onChange={(e) =>
                  setProofConfig({
                    ...proofConfig,
                    gamutWarning: { ...proofConfig.gamutWarning, enabled: e.target.checked },
                  })
                }
              />
            </div>
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Soft proofing is a display-only preview: document colors are never modified and export
            stays authoritative. Accurate proofing requires a profile-aware runtime; the browser
            shows the source color and reports when proofing is unavailable.
          </p>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Document Grid" sectionId="document-grid">
        <fieldset className="insp-canvas-props" aria-label="Document grid settings">
          <div className="insp-field">
            <span className="insp-field__label">Visible</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Show grid"
                checked={state.documentGrid.visible}
                onChange={(e) => {
                  setDocumentGrid({
                    ...state.documentGrid,
                    visible: e.target.checked,
                  });
                }}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Grid snap</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Snap to document grid"
                checked={state.documentGrid.snapEnabled}
                onChange={(e) =>
                  setDocumentGrid({ ...state.documentGrid, snapEnabled: e.target.checked })
                }
              />
            </div>
          </div>
          <NumberField
            label="Spacing X"
            displayLabel="Spacing X"
            unit="px"
            min={1}
            max={10000}
            step={1}
            value={state.documentGrid.spacingX}
            onChange={(value) => {
              setDocumentGrid({
                ...state.documentGrid,
                spacingX: value,
              });
            }}
          />
          <NumberField
            label="Spacing Y"
            displayLabel="Spacing Y"
            unit="px"
            min={1}
            max={10000}
            step={1}
            value={state.documentGrid.spacingY}
            onChange={(value) => {
              setDocumentGrid({
                ...state.documentGrid,
                spacingY: value,
              });
            }}
          />
          <NumberField
            label="Subdivisions"
            min={1}
            max={100}
            step={1}
            value={state.documentGrid.subdivisions}
            onChange={(value) => {
              setDocumentGrid({
                ...state.documentGrid,
                subdivisions: Math.round(value),
              });
            }}
          />
          <NumberField
            label="Offset X"
            displayLabel="Offset X"
            unit="px"
            step={1}
            value={state.documentGrid.offsetX}
            onChange={(value) => {
              setDocumentGrid({
                ...state.documentGrid,
                offsetX: value,
              });
            }}
          />
          <NumberField
            label="Offset Y"
            displayLabel="Offset Y"
            unit="px"
            step={1}
            value={state.documentGrid.offsetY}
            onChange={(value) => {
              setDocumentGrid({
                ...state.documentGrid,
                offsetY: value,
              });
            }}
          />
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
            <span className="insp-field__label">Pixel grid</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Show at high zoom"
                checked={state.pixelGridEnabled}
                onChange={(e) => setPixelGridEnabled(e.target.checked)}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Pixel snap</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Snap to integer pixels"
                checked={state.pixelGridSnapEnabled}
                onChange={(e) => setPixelGridSnapEnabled(e.target.checked)}
              />
            </div>
          </div>
          <div className="insp-field">
            <span className="insp-field__label">Layout guides</span>
            <div className="insp-field__control insp-field__control--inline">
              <Switch
                label="Show layout guides"
                checked={state.layoutGridVisible}
                onChange={(e) => setLayoutGridVisible(e.target.checked)}
              />
            </div>
          </div>
          <p className="insp-panel__color-mode-note" role="note">
            Document-grid visibility and snapping are independent. Layout guides are authored on
            frames and never change child arrangement; Auto layout below is the arrangement system.
          </p>
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
      {/* Saved layer states must stay reachable with nothing selected — the
          selection panels are the only other place this renders, and
          capturing a new state already requires a selection there. Without
          this, deselecting everything makes previously captured states
          impossible to see, apply, rename, or delete. Placed ahead of the
          Isometric Grid section (by far the longest one here) so reaching it
          does not require scrolling past that specialist content. */}
      {!state.sectionVisibility['layer-states']?.hidden && <LayerStatesSection />}
      <IsometricGridSection />
    </>
  );
}

function IsometricGridSection() {
  const {
    state,
    setIsometricGrid,
    setActiveIsometricPlane,
    fitSelectionToPlane,
    createIsometricGridArtwork,
    documentColorMode,
  } = useEditor();
  const grid = state.isometricGrid;
  const presetId = grid.preset;
  const selectionCount = state.selection.length;
  const [ratioInput, setRatioInput] = useState('');
  const activePlaneForCommands: IsometricPlaneId | null =
    grid.activePlaneId && grid.activePlaneId !== 'none' ? grid.activePlaneId : null;

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
      updateGrid({ axes: nextAxes, customAxes: nextAxes, preset: 'custom' });
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
        // Restore the user's last custom axes instead of discarding them when
        // a preset was visited. Falls back to the current axes if none saved.
        const restored =
          grid.customAxes && grid.customAxes.length >= 2 ? grid.customAxes : grid.axes;
        updateGrid({ preset: 'custom', axes: restored.map((a) => ({ ...a })) });
      } else {
        const preset = ISOMETRIC_PRESETS.find((p) => p.id === value);
        if (preset) {
          updateGrid({
            preset: value as typeof grid.preset,
            axes: preset.axes.map((a) => ({ ...a })),
            ...(grid.preset === 'custom' ? { customAxes: grid.axes.map((a) => ({ ...a })) } : {}),
          });
        }
      }
    },
    [grid.axes, grid.customAxes, grid.preset, updateGrid],
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
    <DisclosureSection title="Isometric Grid" sectionId="isometric-grid">
      <fieldset className="insp-canvas-props" aria-label="Isometric grid settings">
        <div className="insp-field">
          <span className="insp-field__label">Visible</span>
          <div className="insp-field__control insp-field__control--inline">
            <Switch
              label="Show isometric grid"
              checked={grid.visible}
              onChange={(e) => updateGrid({ visible: e.target.checked })}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label insp-field__label--wrap">Snap Enabled</span>
          <div className="insp-field__control insp-field__control--inline">
            <Switch
              label="Snap to isometric grid"
              checked={grid.snapEnabled}
              onChange={(e) => updateGrid({ snapEnabled: e.target.checked })}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Preset</span>
          <div className="insp-field__control">
            <Select
              label="Isometric grid preset"
              value={presetId}
              onChange={handlePresetChange}
              options={[
                ...ISOMETRIC_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
        </div>
        {(() => {
          const preset = ISOMETRIC_PRESETS.find((p) => p.id === presetId);
          return preset ? (
            <p className="insp-panel__color-mode-note" role="note">
              {preset.description}
            </p>
          ) : null;
        })()}

        <div className="insp-field">
          <span className="insp-field__label insp-field__label--wrap">Construction plane</span>
          <div className="insp-field__control">
            <SegmentedControl
              label="Active construction plane"
              value={grid.activePlaneId ?? 'top'}
              options={[
                { value: 'none' as const, label: 'Off' },
                ...ISOMETRIC_PLANES.map((plane) => ({
                  value: plane.id,
                  label: plane.label,
                })),
              ]}
              onChange={(value) =>
                setActiveIsometricPlane(value === 'none' ? 'none' : (value as IsometricPlaneId))
              }
            />
          </div>
        </div>
        <p className="insp-panel__color-mode-note" role="note">
          {ISOMETRIC_PLANES.find((plane) => plane.id === (grid.activePlaneId ?? 'top'))
            ?.description ?? ''}{' '}
          New shapes follow this plane; existing artwork is not transformed.
        </p>

        <div className="insp-field">
          <span className="insp-field__label insp-field__label--wrap">Fit existing artwork</span>
          <div className="insp-field__control insp-field__control--gap-2">
            <button
              type="button"
              className="insp-btn"
              disabled={selectionCount === 0 || activePlaneForCommands === null}
              onClick={() => activePlaneForCommands && fitSelectionToPlane(activePlaneForCommands)}
              aria-label="Fit selection to the active plane"
            >
              Fit to plane
            </button>
            <button
              type="button"
              className="insp-btn"
              disabled={selectionCount === 0 || activePlaneForCommands === null}
              onClick={() =>
                activePlaneForCommands &&
                fitSelectionToPlane(activePlaneForCommands, { inverse: true })
              }
              aria-label="Unproject selection from the active plane"
            >
              Unproject
            </button>
          </div>
        </div>

        <div className="insp-field">
          <span className="insp-field__label">Grid artwork</span>
          <div className="insp-field__control">
            <button
              type="button"
              className="insp-btn"
              onClick={() => createIsometricGridArtwork({ maxLines: 1200 })}
              aria-label="Create editable grid artwork from the isometric grid"
            >
              Create grid artwork
            </button>
          </div>
        </div>

        {presetId === 'custom' && (
          <div className="insp-field">
            <span className="insp-field__label">Ratio to angle</span>
            <div className="insp-field__control insp-field__control--gap-2">
              <input
                type="text"
                value={ratioInput}
                placeholder="2:1"
                onChange={(e) => setRatioInput(e.target.value)}
                className="insp-num__input insp-iso-axis-input"
                aria-label="Aspect ratio for the first axis, for example 2:1"
              />
              <button
                type="button"
                className="insp-btn"
                onClick={() => {
                  const match = ratioInput.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
                  if (!match) return;
                  const height = Number.parseFloat(match[1]!);
                  const width = Number.parseFloat(match[2]!);
                  if (!(height > 0) || !(width > 0)) return;
                  const angle = ratioToAxisAngleDegrees(height, width);
                  updateAxis(0, { angle });
                }}
                aria-label="Apply ratio to axis 1 angle"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {presetId === 'custom' && (
          <>
            {grid.axes.map((axis, index) => (
              <div key={`axis-${index}`} className="insp-field insp-iso-axis-row">
                <span className="insp-field__label">{axis.label ?? `Axis ${index + 1}`}</span>
                <div className="insp-field__control insp-field__control--column">
                  <div className="insp-iso-axis-line">
                    <span className="insp-iso-axis-hint">Angle</span>
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
                      className="insp-num__input insp-iso-axis-input"
                      aria-label={`Axis ${index + 1} angle ${axis.angle} degrees`}
                    />
                    <span className="insp-iso-axis-hint">deg</span>
                    {index === 0 && Number.isFinite(axis.angle)
                      ? (() => {
                          const ratio = axisAngleToRatio(axis.angle);
                          return ratio ? (
                            <span
                              className="insp-iso-axis-hint"
                              title={`Axis 1 ratio ${ratio.height} to ${ratio.width}`}
                            >
                              {ratio.height}:{ratio.width}
                            </span>
                          ) : null;
                        })()
                      : null}
                  </div>
                  <div className="insp-iso-axis-line">
                    <Switch
                      label="Visible"
                      checked={axis.visible}
                      onChange={(e) => updateAxis(index, { visible: e.target.checked })}
                      className="insp-switch--axis"
                    />
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
                      swatchStyle={{ background: axis.color ?? 'var(--color-text-muted)' }}
                      documentColorMode={documentColorMode}
                    />
                    <span className="insp-iso-axis-hint">
                      {Math.round((axis.opacity ?? 1) * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={axis.opacity ?? 1}
                      onChange={(e) => updateAxis(index, { opacity: parseFloat(e.target.value) })}
                      className="insp-range insp-iso-axis-opacity"
                      aria-label={`Axis ${index + 1} opacity`}
                    />
                    {grid.axes.length > 2 && (
                      <button
                        type="button"
                        className="insp-btn insp-iso-axis-remove"
                        onClick={() => removeAxis(index)}
                        aria-label={`Remove axis ${index + 1}`}
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
              <p className="insp-hint insp-hint--error" role="alert">
                {axisValidation.errors.join('; ')}
              </p>
            )}
          </>
        )}

        <NumberField
          label="Spacing (axis step)"
          labelWrap
          value={grid.spacing}
          min={0.01}
          max={100_000}
          onChange={(v) => updateGrid({ spacing: v })}
        />
        <p className="insp-panel__color-mode-note" role="note">
          Projected length of one step along each grid axis; line separations are derived from it.
        </p>
        <NumberField
          label="Major line every"
          labelWrap
          value={grid.majorEvery ?? 4}
          min={1}
          max={64}
          step={1}
          onChange={(v) => updateGrid({ majorEvery: Math.max(1, Math.round(v)) })}
        />
        <NumberField
          label="Origin X"
          value={grid.originX}
          onChange={(v) => updateGrid({ originX: v })}
        />
        <NumberField
          label="Origin Y"
          value={grid.originY}
          onChange={(v) => updateGrid({ originY: v })}
        />
        <div className="insp-field">
          <span className="insp-field__label">Origin</span>
          <div className="insp-field__control insp-field__control--gap-2">
            <button
              type="button"
              className="insp-btn"
              onClick={() => updateGrid({ originX: 0, originY: 0 })}
              aria-label="Reset isometric grid origin to zero"
            >
              Reset origin
            </button>
          </div>
        </div>
        <p className="insp-panel__color-mode-note" role="note">
          Grid origin only; rulers and artwork are unaffected.
        </p>
        <div className="insp-field">
          <span className="insp-field__label insp-field__label--wrap">Snap targets</span>
          <div className="insp-field__control insp-field__control--column">
            <Switch
              label="Snap to lattice intersections"
              checked={grid.snapToSubdivisions !== false}
              onChange={(e) => updateGrid({ snapToSubdivisions: e.target.checked })}
            />
            <Switch
              label="Snap to grid lines"
              checked={grid.snapToLines === true}
              onChange={(e) => updateGrid({ snapToLines: e.target.checked })}
            />
          </div>
        </div>
        <NumberField
          label="Rotation"
          unit="deg"
          min={0}
          max={360}
          step={1}
          value={grid.rotation}
          onChange={(v) => updateGrid({ rotation: v })}
        />
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
