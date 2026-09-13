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
  type UnavailableReason,
} from '@varve/engine/nativeAcceleration';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';

import './NativeAccelerationPanel.css';

function reasonLabel(reason: UnavailableReason | null): string {
  switch (reason) {
    case null:
      return 'available';
    case 'notPresent':
      return 'no device present';
    case 'driverMissing':
      return 'driver missing';
    case 'runtimeMissing':
      return 'runtime missing';
    case 'artifactMissing':
      return 'component not bundled';
    case 'permissionDenied':
      return 'permission denied';
    case 'softwareOnly':
      return 'software renderer only';
    case 'unsupportedPlatform':
      return 'unsupported platform';
    case 'unsupportedOperator':
      return 'unsupported operators';
    case 'initFailed':
      return 'initialization failed';
    case 'timeout':
      return 'probe timed out';
    case 'deviceLost':
      return 'device lost';
    case 'userDisabled':
      return 'disabled in settings';
    default:
      return 'unavailable';
  }
}

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
    void refresh(false);
  }, [refresh]);

  if (!available) return null;

  const compute = status?.report.compute;
  const selected = compute?.devices.find((device) => device.id === compute.selectedId);
  const inference = status?.report.inference;
  const policy = status?.inferencePolicy ?? 'auto';

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
          <dd>
            {inference?.runtimeLoaded
              ? 'ONNX Runtime loaded; CPU execution provider available'
              : 'ONNX Runtime not loaded yet; CPU execution provider is the shipped baseline'}
          </dd>
        </div>
        <div className="native-accel__row native-accel__row--control">
          <dt>AI inference device</dt>
          <dd>
            <Select
              options={[
                { value: 'auto', label: 'Automatic (WebGPU when available and verified)' },
                { value: 'cpu', label: 'CPU only' },
                { value: 'gpu', label: 'WebGPU only (fails if unavailable)' },
              ]}
              value={policy}
              onChange={(value) => void handlePolicyChange(value)}
              label="AI inference device"
            />
          </dd>
        </div>
      </dl>

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
