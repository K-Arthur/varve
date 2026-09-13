import { Button, NumberInput, Select, SwitchField } from '@varve/ui';
import { useCallback, useState } from 'react';
import { DEFAULT_DRAWING_INPUT_SETTINGS, type DrawingInputSettingsStore } from '../../settings';
import { refreshDrawingInputSettings } from '../../tools/drawingInputRuntime';
import {
  getObservedInputCapabilities,
  type ObservedInputCapabilities,
  observeInputCapabilities,
  resetObservedInputCapabilities,
} from '../../tools/inputNormalizer';
import { useSettings } from './SettingsContext';

const FINGER_MODE_OPTIONS = [
  {
    value: 'draw',
    label: 'Finger draws',
    description: 'One finger follows the active tool; two fingers navigate.',
  },
  {
    value: 'navigate',
    label: 'Finger navigates',
    description: 'One finger pans; pen or mouse remains available for drawing.',
  },
];

interface ProbeState {
  pointerType: string;
  rawPressure: number | null;
  interpretedPressure: number | null;
  buttons: number;
  capabilities: ObservedInputCapabilities;
}

function initialProbeState(): ProbeState {
  return {
    pointerType: 'unknown',
    rawPressure: null,
    interpretedPressure: null,
    buttons: 0,
    capabilities: getObservedInputCapabilities(),
  };
}

export function DrawingInputSettingsTab() {
  const { settings, updateSettings } = useSettings();
  const input = settings.drawingInput;
  const [probe, setProbe] = useState<ProbeState>(initialProbeState);

  const recordProbeSample = useCallback(
    (event: PointerEvent) => {
      const observed = observeInputCapabilities(event);
      const rawPressure = Number.isFinite(event.pressure) ? event.pressure : null;
      const interpretedPressure =
        rawPressure === null
          ? null
          : input.pressureEnabled
            ? rawPressure ** Math.max(0.25, Math.min(4, input.pressureCurve))
            : 0.5;
      setProbe({
        pointerType: event.pointerType || 'unknown',
        rawPressure,
        interpretedPressure,
        buttons: event.buttons,
        capabilities: observed,
      });
    },
    [input.pressureCurve, input.pressureEnabled],
  );

  const updateInput = useCallback(
    (patch: Partial<DrawingInputSettingsStore>) => {
      updateSettings({ drawingInput: patch });
      // The next contact sees the persisted setting without rebuilding the
      // editor or reading localStorage on every pointermove.
      refreshDrawingInputSettings();
    },
    [updateSettings],
  );

  const resetInput = useCallback(() => {
    resetObservedInputCapabilities();
    setProbe(initialProbeState());
    updateInput({ ...DEFAULT_DRAWING_INPUT_SETTINGS });
  }, [updateInput]);

  const handleProbeDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional in limited WebViews; the probe remains
        // useful for samples delivered while the pointer is over its surface.
      }
      recordProbeSample(event.nativeEvent);
    },
    [recordProbeSample],
  );

  const handleProbeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) recordProbeSample(event.nativeEvent);
    },
    [recordProbeSample],
  );

  const handleProbeUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      recordProbeSample(event.nativeEvent);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may have released capture already.
      }
    },
    [recordProbeSample],
  );

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Drawing input</h3>
      <p className="settings-section__hint">
        These preferences apply to the next contact. Varve tracks each pointer separately so a
        second finger can navigate without adding an undo entry or corrupting a pen stroke.
      </p>

      <div className="settings-field-row">
        <span className="settings-field-row__label">Finger / unknown contact</span>
        <div className="settings-field-row__control">
          <Select
            options={FINGER_MODE_OPTIONS}
            value={input.fingerMode}
            onChange={(value) =>
              updateInput({ fingerMode: value as DrawingInputSettingsStore['fingerMode'] })
            }
            label="Finger / unknown contact"
          />
        </div>
      </div>
      <p className="settings-hint">
        This is a reversible policy, not a Chromebook user-agent guess. If a runtime cannot identify
        a stylus, unknown contacts follow this choice.
      </p>

      <SwitchField
        label="Use pressure dynamics when observed"
        description="Uses varying pressure for supported brush and pencil tools. A single default pressure reading is not treated as proof of hardware support."
        checked={input.pressureEnabled}
        onChange={(event) => updateInput({ pressureEnabled: event.target.checked })}
      />

      <div className="settings-field-row">
        <span className="settings-field-row__label">Pressure curve</span>
        <div className="settings-field-row__control">
          <NumberInput
            value={input.pressureCurve}
            min={0.25}
            max={4}
            step={0.05}
            altStep={0.05}
            label="Pressure curve"
            onChange={(value) => updateInput({ pressureCurve: value })}
          />
        </div>
      </div>
      <p className="settings-hint">
        1.00 is neutral. Values below 1 make light pressure stronger; values above 1 make it softer.
        Turn dynamics off for a constant-width/opacity fallback on runtimes without useful pressure.
      </p>

      <div
        className="settings-input-probe"
        data-testid="drawing-input-probe"
        onPointerDown={handleProbeDown}
        onPointerMove={handleProbeMove}
        onPointerUp={handleProbeUp}
        onPointerCancel={handleProbeUp}
        role="img"
        aria-label="Pressure and pointer test surface"
      >
        <strong>Test pointer input</strong>
        <span>Drag here with a finger, mouse, or pen. No artwork is created.</span>
        <div className="settings-input-probe__meter" aria-hidden="true">
          <span
            style={{
              width: `${Math.round((probe.interpretedPressure ?? 0) * 100)}%`,
            }}
          />
        </div>
        <output aria-live="polite">
          {probe.pointerType} · raw{' '}
          {probe.rawPressure === null ? '—' : probe.rawPressure.toFixed(2)} · interpreted{' '}
          {probe.interpretedPressure === null ? '—' : probe.interpretedPressure.toFixed(2)}
          {' · '}pressure {probe.capabilities.pressure}
          {probe.buttons !== 0 ? ` · buttons ${probe.buttons}` : ''}
        </output>
      </div>

      <Button variant="ghost" size="sm" onClick={resetInput}>
        Reset drawing input settings
      </Button>
    </div>
  );
}
