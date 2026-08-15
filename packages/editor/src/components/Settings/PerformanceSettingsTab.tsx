/**
 * Performance settings tab — cache/memory budget, reduced-motion override,
 * and read-only diagnostics for support/bug-report use.
 */

import { Button, Select } from '@varve/ui';
import { useState } from 'react';
import { detectPlatformCapabilities, getCurrentTier } from '../../canvas/adaptiveProfile';
import { enableDrawDiagnostics } from '../../canvas/drawDiagnostics';
import { getAverageFrameTime, getPercentileFrameTime } from '../../canvas/frameBudget';
import { setReducedMotionOverride } from '../../context/reducedMotionManager';
import type { PerformanceSettingsStore, RenderSettingsStore } from '../../settings';
import { InteractionTracePanel } from './InteractionTracePanel';
import { useSettings } from './SettingsContext';

import './PerformanceSettingsTab.css';

const MEMORY_BUDGET_OPTIONS: { value: RenderSettingsStore['memoryBudget']; label: string }[] = [
  { value: 'low', label: 'Low (constrained devices)' },
  { value: 'medium', label: 'Balanced (recommended)' },
  { value: 'high', label: 'High (large documents, more RAM available)' },
];

const REDUCED_MOTION_OPTIONS: {
  value: PerformanceSettingsStore['reducedMotionOverride'];
  label: string;
}[] = [
  { value: 'system', label: 'Match system setting' },
  { value: 'always', label: 'Always reduce motion' },
  { value: 'never', label: 'Never reduce motion' },
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-field-row">
      <span className="settings-field-row__label">{label}</span>
      <div className="settings-field-row__control">{children}</div>
    </div>
  );
}

export function PerformanceSettingsTab() {
  const { settings, updateSettings } = useSettings();
  const [copied, setCopied] = useState(false);
  const caps = detectPlatformCapabilities();

  function updateRender(patch: Partial<RenderSettingsStore>) {
    updateSettings({ render: patch });
  }

  function updateReducedMotion(value: PerformanceSettingsStore['reducedMotionOverride']) {
    updateSettings({ performance: { reducedMotionOverride: value } });
    setReducedMotionOverride(value === 'system' ? null : value === 'always');
  }

  function handleResetDefaults() {
    updateSettings({
      render: { memoryBudget: 'medium' },
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
      reducedMotionOverride: settings.performance.reducedMotionOverride,
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

      <FieldRow label="Memory / cache budget">
        <Select
          options={MEMORY_BUDGET_OPTIONS}
          value={settings.render.memoryBudget}
          onChange={(v) => updateRender({ memoryBudget: v as RenderSettingsStore['memoryBudget'] })}
          label="Memory / cache budget"
        />
      </FieldRow>
      <p className="settings-hint">
        Controls how much memory the canvas render cache may retain. Lower budgets reduce memory use
        on constrained devices at the cost of more redraw work on large documents. Takes effect for
        newly opened documents.
      </p>

      <FieldRow label="Reduce motion">
        <Select
          options={REDUCED_MOTION_OPTIONS}
          value={settings.performance.reducedMotionOverride}
          onChange={(v) =>
            updateReducedMotion(v as PerformanceSettingsStore['reducedMotionOverride'])
          }
          label="Reduce motion"
        />
      </FieldRow>
      <p className="settings-hint">
        Applies immediately and overrides your OS accessibility setting for this app.
      </p>

      <div className="settings-divider" />

      <h3 className="settings-section__title">Diagnostics</h3>
      <FieldRow label="Performance overlay">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.performance.showPerformanceDiagnostics}
            onChange={(e) => updateShowDiagnostics(e.target.checked)}
          />
          <span>Show performance overlay</span>
        </label>
      </FieldRow>
      <p className="settings-hint">
        Displays live renderer timing, cache, and render-path information over the canvas. Off by
        default; intended for diagnosing rendering or performance problems.
      </p>
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
            {caps.hasWebGPU ? 'Available' : 'Unavailable'}
          </span>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={handleCopyDiagnostics}>
        {copied ? 'Copied' : 'Copy performance diagnostics'}
      </Button>

      <div className="settings-divider" />

      <InteractionTracePanel />

      <div className="settings-divider" />

      <Button variant="ghost" size="sm" onClick={handleResetDefaults}>
        Reset performance settings to recommended defaults
      </Button>
    </div>
  );
}
