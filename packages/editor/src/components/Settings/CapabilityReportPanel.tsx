import { Button } from '@varve/ui';
import { useState } from 'react';
import {
  type CapabilityReport,
  collectCapabilityReport,
  serializeCapabilityReport,
} from '../../performance/capabilityReport';

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function CapabilityReportPanel() {
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCollect() {
    setCollecting(true);
    setMessage(null);
    try {
      setReport(await collectCapabilityReport());
      setMessage('Report collected locally.');
    } catch {
      // The collector is designed not to reject, but keep this UI safe if a
      // host replaces it or a future probe violates that contract.
      setMessage('The capability report could not be collected.');
    } finally {
      setCollecting(false);
    }
  }

  async function handleCopy() {
    if (!report || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(serializeCapabilityReport(report));
      setMessage('Report copied.');
    } catch {
      setMessage('Copy is unavailable in this context.');
    }
  }

  function handleDownload() {
    if (!report || typeof document === 'undefined' || typeof Blob === 'undefined') return;
    try {
      const url = URL.createObjectURL(
        new Blob([serializeCapabilityReport(report)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'varve-capability-report.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage('Report download started.');
    } catch {
      setMessage('Download is unavailable in this context.');
    }
  }

  return (
    <section className="capability-report" aria-labelledby="capability-report-title">
      <h4 id="capability-report-title" className="capability-report__title">
        Platform capability report
      </h4>
      <p className="settings-hint">
        Runs only when requested. It checks bounded graphics, worker, WASM, storage, and file
        capabilities locally; it does not upload diagnostics or inspect your design files.
      </p>
      <div className="capability-report__actions">
        <Button variant="secondary" size="sm" onClick={handleCollect} disabled={collecting}>
          {collecting ? 'Collecting…' : 'Collect capability report'}
        </Button>
        {report ? (
          <>
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              Copy report
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              Download JSON
            </Button>
          </>
        ) : null}
      </div>
      {message ? <p className="capability-report__message">{message}</p> : null}
      {report ? (
        <>
          <dl className="capability-report__summary">
            <div>
              <dt>Runtime</dt>
              <dd>
                {report.runtime.kind} / {report.runtime.os}
              </dd>
            </div>
            <div>
              <dt>Viewport</dt>
              <dd>
                {report.runtime.viewportCss.width} x {report.runtime.viewportCss.height} CSS px @{' '}
                {report.runtime.devicePixelRatio} DPR
              </dd>
            </div>
            <div>
              <dt>WebGL probe</dt>
              <dd>{statusLabel(report.graphics.webgl.status)}</dd>
            </div>
            <div>
              <dt>WebGPU device</dt>
              <dd>{statusLabel(report.graphics.webgpu.status)}</dd>
            </div>
            <div>
              <dt>Worker pixels</dt>
              <dd>{statusLabel(report.worker.offscreen.capability.replace('offscreen-', ''))}</dd>
            </div>
            <div>
              <dt>WASM SIMD / threads</dt>
              <dd>
                {report.wasm.simdValidated ? 'yes' : 'no'} /{' '}
                {report.wasm.threadsUsable ? 'usable' : 'unavailable'}
              </dd>
            </div>
            <div>
              <dt>Storage estimate</dt>
              <dd>{statusLabel(report.storage.estimateStatus)}</dd>
            </div>
            <div>
              <dt>File System Access</dt>
              <dd>{report.files.fileSystemAccessApi ? 'Available' : 'Fallback only'}</dd>
            </div>
          </dl>
          <details className="capability-report__details">
            <summary>View report JSON</summary>
            <pre>{serializeCapabilityReport(report)}</pre>
          </details>
        </>
      ) : null}
    </section>
  );
}
