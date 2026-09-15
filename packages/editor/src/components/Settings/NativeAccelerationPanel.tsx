/**
 * Native acceleration panel — desktop-only, truthful status for the three
 * separate concerns: canvas presentation, effect compute, and AI inference.
 *
 * Reads `@varve/engine/nativeAcceleration` (a mirror of the Rust capability
 * report). Never claims an accelerator is active because it was detected:
 * "verified" requires the bounded hardware self-test, and accelerated
 * inference providers stay unavailable until the runtime actually ships them.
 */

import {
  describeAccelStage,
  getNativeAccelerationStatus,
  isNativeAccelerationAvailable,
  type NativeAccelerationStatus,
  type NativeInferenceProviderPolicy,
  runNativeGpuSelfTest,
  setNativeInferenceProviderPolicy,
  storedNativeInferenceProviderPolicy,
} from '@varve/engine/nativeAcceleration';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';

import './NativeAccelerationPanel.css';
import {
  inferencePlacementLabel,
  npuPlacementLabel,
  reasonLabel,
} from './nativeAccelerationPanelLabels';

export function NativeAccelerationPanel() {
  const available = isNativeAccelerationAvailable();
  const [status, setStatus] = useState<NativeAccelerationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [selfTest, setSelfTest] = useState<string | null>(null);

  const refresh = useCallback(
    async (redetect: boolean) => {
      if (!available) return;
      try {
        setStatus(await getNativeAccelerationStatus({ redetect }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [available],
  );

  useEffect(() => {
    void (async () => {
      // Re-apply the locally persisted preference after a restart; the
      // native policy itself is process-global and does not persist.
      const stored = storedNativeInferenceProviderPolicy();
      if (stored) {
        try {
          await setNativeInferenceProviderPolicy(stored);
        } catch {
          // Unavailable stored choice (e.g. WebGPU-only on a CPU host) is
          // ignored; the native side keeps the current policy.
        }
      }
      await refresh(false);
    })();
  }, [refresh]);

  if (!available) return null;

  const compute = status?.report.compute;
  const selected = compute?.devices.find((device) => device.id === compute.selectedId);
  const inference = status?.report.inference;
  const policy = status?.inferencePolicy ?? 'auto';
  const webgpuProvider = inference?.providers.find((provider) => provider.id === 'webgpu');
  const webgpuReady =
    webgpuProvider?.stage === 'deviceUsable' || webgpuProvider?.stage === 'executionVerified';
  const webgpuDisabledReason = webgpuReady
    ? undefined
    : webgpuProvider
      ? `Unavailable until the native WebGPU runtime and device are ready (${describeAccelStage(webgpuProvider.stage).toLowerCase()})`
      : 'Native inference runtime has not been checked yet';

  async function handlePolicyChange(value: string) {
    setError(null);
    setSelfTest(null);
    try {
      await setNativeInferenceProviderPolicy(value as NativeInferenceProviderPolicy);
      await refresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSelfTest() {
    setChecking(true);
    setSelfTest(null);
    setError(null);
    try {
      const report = await runNativeGpuSelfTest();
      if (report) {
        setSelfTest(
          `${report.deviceName} (${report.backend}) verified with a ${report.elementsChecked}-value compute dispatch in ${report.durationMs.toFixed(1)} ms`,
        );
      }
      await refresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="native-accel" aria-labelledby="native-accel-title">
      <h4 id="native-accel-title" className="native-accel__title">
        Native acceleration
      </h4>
      <p className="native-accel__intro">
        Presentation, effect compute, and AI inference are separate. The canvas always renders
        through the webview; native hardware is only reported for the workload that actually used
        it.
      </p>

      <dl className="native-accel__rows">
        <div className="native-accel__row">
          <dt>Canvas presentation</dt>
          <dd>Webview replay (Canvas2D); WebGPU compositor is an opt-in browser path</dd>
        </div>
        <div className="native-accel__row">
          <dt>Effect compute</dt>
          <dd>
            {selected
              ? `${selected.name} — ${describeAccelStage(selected.stage)}`
              : 'No hardware device selected; effect compute stays on the CPU'}
          </dd>
        </div>
        <div className="native-accel__row">
          <dt>AI inference</dt>
          <dd>{inferencePlacementLabel(inference?.providers)}</dd>
        </div>
        <div className="native-accel__row">
          <dt>NPU inference</dt>
          <dd>{npuPlacementLabel(inference?.providers)}</dd>
        </div>
        <div className="native-accel__row native-accel__row--control">
          <dt>AI inference device</dt>
          <dd>
            <Select
              options={[
                { value: 'auto', label: 'Automatic (compatible WebGPU, then CPU)' },
                { value: 'cpu', label: 'CPU only' },
                {
                  value: 'gpu',
                  label: 'WebGPU only (fails if unavailable)',
                  disabled: !webgpuReady,
                  disabledReason: webgpuDisabledReason,
                },
              ]}
              value={policy}
              onChange={(value) => void handlePolicyChange(value)}
              label="AI inference device"
            />
          </dd>
        </div>
      </dl>

      <p className="native-accel__note">
        NPU execution is shown only when a supported provider, runtime, device, and model are
        present. This build does not bundle a vendor NPU runtime, so it will not claim NPU work from
        a device name or an advertised operating-system capability.
      </p>

      <details className="native-accel__details">
        <summary>Device and provider details</summary>
        <h5>Compute devices</h5>
        <ul>
          {(compute?.devices ?? []).map((device) => (
            <li key={device.id}>
              {device.name} ({device.backend}, {device.deviceType}) —{' '}
              {describeAccelStage(device.stage)}
              {device.reason ? ` (${reasonLabel(device.reason)})` : ''}
              {device.software ? ' — software renderer, never selected' : ''}
            </li>
          ))}
          {(compute?.devices.length ?? 0) === 0 && <li>No adapters reported</li>}
        </ul>
        <h5>Inference providers</h5>
        <ul>
          {(inference?.providers ?? []).map((provider) => (
            <li key={provider.id}>
              {provider.label} ({provider.deviceKind}) — {describeAccelStage(provider.stage)}
              {provider.reason ? `: ${reasonLabel(provider.reason)}` : ''}
              {provider.detail ? `. ${provider.detail}` : ''}
            </li>
          ))}
        </ul>
        {status?.report.cpu && (
          <p className="native-accel__cpu">
            CPU: {status.report.cpu.architecture}, {status.report.cpu.logicalCores} threads
            {status.report.cpu.features.length > 0
              ? ` (${status.report.cpu.features.join(', ')})`
              : ''}
          </p>
        )}
      </details>

      {selfTest && (
        <p role="status" className="native-accel__status">
          {selfTest}
        </p>
      )}
      {error && (
        <p role="alert" className="native-accel__error">
          {error}
        </p>
      )}
      {status?.lastError && !error && (
        <p className="native-accel__error">Last GPU error: {status.lastError}</p>
      )}

      <div className="native-accel__actions">
        <Button variant="secondary" size="sm" onClick={handleSelfTest} disabled={checking}>
          {checking ? 'Checking...' : 'Run hardware check'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void refresh(true)} disabled={checking}>
          Re-detect devices
        </Button>
      </div>
    </section>
  );
}
