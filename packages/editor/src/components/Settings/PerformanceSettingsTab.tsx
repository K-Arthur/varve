/**
 * Performance settings tab — cache/memory budget, reduced-motion override,
 * and read-only diagnostics for support/bug-report use.
 */

import { Button, Select, SwitchField } from '@varve/ui';
import { useEffect, useState } from 'react';
import { detectPlatformCapabilities, getCurrentTier } from '../../canvas/adaptiveProfile';
import { enableDrawDiagnostics } from '../../canvas/drawDiagnostics';
import { getAverageFrameTime, getPercentileFrameTime } from '../../canvas/frameBudget';
import { setReducedMotionOverride } from '../../context/reducedMotionManager';
import { ensureWebGpuCapabilityProbe, type WebGpuProbeStatus } from '../../performance/webGpuProbe';
import type {
  InteractivePreviewMode,
  PerformanceSettingsStore,
  RenderSettingsStore,
} from '../../settings';
import { CapabilityReportPanel } from './CapabilityReportPanel';
import { InteractionTracePanel } from './InteractionTracePanel';
import { NativeAccelerationPanel } from './NativeAccelerationPanel';
import { useSettings } from './SettingsContext';
import { SettingsFieldRow } from './SettingsFieldRow';

import './PerformanceSettingsTab.css';

const MEMORY_BUDGET_OPTIONS: { value: RenderSettingsStore['memoryBudget']; label: string }[] = [
  { value: 'low', label: 'Low (constrained devices)' },
  { value: 'medium', label: 'Balanced (recommended)' },
  { value: 'high', label: 'High (large documents, more RAM available)' },
];

const INTERACTIVE_PREVIEW_OPTIONS: { value: InteractivePreviewMode; label: string }[] = [
  { value: 'automatic', label: 'Automatic (recommended)' },
  { value: 'full', label: 'Full resolution while navigating' },
];

const REDUCED_MOTION_OPTIONS: {
  value: PerformanceSettingsStore['reducedMotionOverride'];
  label: string;
}[] = [
  { value: 'system', label: 'Match system setting' },
  { value: 'always', label: 'Always reduce motion' },
  { value: 'never', label: 'Never reduce motion' },
];

export function PerformanceSettingsTab() {
  const { settings, updateSettings } = useSettings();
  const [copied, setCopied] = useState(false);
  const caps = detectPlatformCapabilities();
  const [webGpuStatus, setWebGpuStatus] = useState<WebGpuProbeStatus>(caps.webGpuStatus);

  useEffect(() => {
    let active = true;
    void ensureWebGpuCapabilityProbe().then((probe) => {
      if (active) setWebGpuStatus(probe.status);
    });
    return () => {
      active = false;
    };
  }, []);

  function updateRender(patch: Partial<RenderSettingsStore>) {
    updateSettings({ render: patch });
  }

  function updateReducedMotion(value: PerformanceSettingsStore['reducedMotionOverride']) {
    updateSettings({ performance: { reducedMotionOverride: value } });
    setReducedMotionOverride(value === 'system' ? null : value === 'always');
  }

  function handleResetDefaults() {
    updateSettings({
      render: { memoryBudget: 'medium', interactivePreview: 'automatic' },
      performance: { reducedMotionOverride: 'system', showPerformanceDiagnostics: false },
    });
    setReducedMotionOverride(null);
    enableDrawDiagnostics(false);
  }

  function updateShowDiagnostics(next: boolean) {
    updateSettings({ performance: { showPerformanceDiagnostics: next } });
    enableDrawDiagnostics(next);
  }

  async function handleCopyDiagnostics() {
    const report = {
      adaptiveTier: getCurrentTier(),
      averageFrameTimeMs: Number(getAverageFrameTime().toFixed(2)),
      p95FrameTimeMs: Number(getPercentileFrameTime(95).toFixed(2)),
      memoryBudget: settings.render.memoryBudget,
      interactivePreview: settings.render.interactivePreview,
      reducedMotionOverride: settings.performance.reducedMotionOverride,
      webGpuStatus,
      platform: caps,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (permissions/non-secure context) — silently skip.
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Performance</h3>

      <SettingsFieldRow label="Memory / cache budget">
        <Select
          options={MEMORY_BUDGET_OPTIONS}
          value={settings.render.memoryBudget}
          onChange={(v) => updateRender({ memoryBudget: v as RenderSettingsStore['memoryBudget'] })}
          label="Memory / cache budget"
        />
      </SettingsFieldRow>
      <p className="settings-hint">
        Controls how much memory the canvas render cache may retain. Lower budgets reduce memory use
        on constrained devices at the cost of more redraw work on large documents. Takes effect for
        newly opened documents.
      </p>

      <SettingsFieldRow label="Interactive preview quality">
        <Select
          options={INTERACTIVE_PREVIEW_OPTIONS}
          value={settings.render.interactivePreview}
          onChange={(value) =>
            updateRender({ interactivePreview: value as InteractivePreviewMode })
          }
          label="Interactive preview quality"
        />
      </SettingsFieldRow>
      <p className="settings-hint">
        Automatic may lower the temporary canvas backing scale after sustained over-budget frames;
        it always returns to authoritative full resolution after navigation settles. Full resolution
        keeps every navigation frame at device scale, which may cost responsiveness on constrained
        hardware. Exports are full quality in either mode.
      </p>

      <SettingsFieldRow label="Reduce motion">
        <Select
          options={REDUCED_MOTION_OPTIONS}
          value={settings.performance.reducedMotionOverride}
          onChange={(v) =>
            updateReducedMotion(v as PerformanceSettingsStore['reducedMotionOverride'])
          }
          label="Reduce motion"
        />
      </SettingsFieldRow>
      <p className="settings-hint">
        Applies immediately and overrides your OS accessibility setting for this app.
      </p>

      <div className="settings-divider" />

      <h3 className="settings-section__title">Diagnostics</h3>
      <SwitchField
        label="Show performance overlay"
        description="Displays live renderer timing, cache, and render-path information over the canvas. Off by default; intended for diagnosing rendering or performance problems."
        checked={settings.performance.showPerformanceDiagnostics}
        onChange={(e) => updateShowDiagnostics(e.target.checked)}
      />
      <div className="performance-settings__stats">
        <div className="performance-settings__stat">
          <span className="performance-settings__stat-label">Adaptive quality tier</span>
          <span className="performance-settings__stat-value">{getCurrentTier()}</span>
        </div>
        <div className="performance-settings__stat">
          <span className="performance-settings__stat-label">Avg. frame time</span>
          <span className="performance-settings__stat-value">
            {getAverageFrameTime().toFixed(1)} ms
          </span>
        </div>
        <div className="performance-settings__stat">
          <span className="performance-settings__stat-label">p95 frame time</span>
          <span className="performance-settings__stat-value">
            {getPercentileFrameTime(95).toFixed(1)} ms
          </span>
        </div>
        <div className="performance-settings__stat">
          <span className="performance-settings__stat-label">Worker rendering</span>
          <span className="performance-settings__stat-value">
            {caps.hasWorker ? 'Available' : 'Unavailable'}
          </span>
        </div>
        <div className="performance-settings__stat">
          <span className="performance-settings__stat-label">WebGPU</span>
          <span className="performance-settings__stat-value">
            {webGpuStatus === 'supported'
              ? 'Available'
              : webGpuStatus === 'unknown'
                ? 'Checking'
                : 'Unavailable'}
          </span>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={handleCopyDiagnostics}>
        {copied ? 'Copied' : 'Copy performance diagnostics'}
      </Button>

      <NativeAccelerationPanel />

      <CapabilityReportPanel />

      <div className="settings-divider" />

      <InteractionTracePanel />

      <div className="settings-divider" />

      <Button variant="ghost" size="sm" onClick={handleResetDefaults}>
        Reset performance settings to recommended defaults
      </Button>
    </div>
  );
}
