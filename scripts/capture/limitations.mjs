import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * These entries are intentionally derived from current source/docs anchors,
 * not from the capture brief. If an anchor disappears, the status reel fails
 * instead of quietly publishing stale criticism.
 */
export const LIMITATIONS = [
  {
    id: 'flatpak-manifest-stub',
    title: 'Flatpak is not shippable yet',
    kind: 'missing feature',
    status: 'partial',
    evidence: [
      {
        file: 'docs/release/linux-ecosystem-readiness.md',
        anchors: ['current manifest is a stub', '`exit 1`'],
      },
    ],
    reproductionSteps: [
      'Inspect the current Flatpak manifest readiness entry.',
      'Run the documented flatpak-builder command only after a human completes the missing offline sources.',
    ],
    linkedIssue: null,
  },
  {
    id: 'web-editor-scaffold',
    title: 'The separate web app is still a scaffold',
    kind: 'missing feature',
    status: 'not yet supported',
    evidence: [
      {
        file: 'apps/web/package.json',
        anchors: ['Full scaffold lands in task 0.9', 'typecheck deferred to task 0.9'],
      },
    ],
    reproductionSteps: [
      'Inspect the @varve/web package scripts.',
      'The shippable editor remains apps/desktop’s browser demo rather than this package.',
    ],
    linkedIssue: null,
  },
  {
    id: 'linux-webgpu',
    title: 'Linux WebKitGTK uses Canvas2D, not WebGPU',
    kind: 'known limitation',
    status: 'known limitation',
    evidence: [
      {
        file: 'docs/architecture/render-pipeline.md',
        anchors: ['WebKitGTK (Linux Tauri) has no WebGPU', 'Canvas2D is the production path'],
      },
    ],
    reproductionSteps: [
      'Launch the native Linux build with the capture diagnostics enabled.',
      'Read the real backend/capability status; do not infer it from Chromium.',
    ],
    linkedIssue: null,
  },
  {
    id: 'pdf-canvas-parity',
    title: 'PDF export has no Canvas2D visual-parity golden',
    kind: 'known limitation',
    status: 'planned',
    evidence: [
      {
        file: 'docs/architecture/render-pipeline.md',
        anchors: [
          'No visual-parity test between the native PDF export path',
          'nothing asserts they agree',
        ],
      },
    ],
    reproductionSteps: [
      'Export a document to PDF.',
      'Compare it against the same on-screen document; the repository has unit tests, not a PDF-vs-canvas pixel golden.',
    ],
    linkedIssue: null,
  },
  {
    id: 'motion-video-webcodecs',
    title: 'Motion video export is provider-gated',
    kind: 'known limitation',
    status: 'partial',
    evidence: [
      {
        file: 'packages/editor/src/components/Export/ExportDialog.tsx',
        anchors: ['video (WebCodecs;', 'Chromium recommended', 'Video export unavailable'],
      },
    ],
    reproductionSteps: [
      'Open Motion Export in a runtime without WebCodecs.',
      'Use the available CSS/Lottie paths or Chromium for video; the UI reports the provider limitation.',
    ],
    linkedIssue: null,
  },
];

export function auditLimitations(root) {
  const failures = [];
  const checked = LIMITATIONS.map((item) => {
    const evidence = item.evidence.map((source) => {
      const text = readFileSync(join(root, source.file), 'utf8');
      const missing = source.anchors.filter((anchor) => !text.includes(anchor));
      if (missing.length)
        failures.push(`${item.id}: missing evidence anchor(s): ${missing.join(', ')}`);
      return { ...source, missing };
    });
    return { ...item, evidence };
  });
  if (checked.length !== 5)
    failures.push(`expected five current limitations, found ${checked.length}`);
  if (failures.length) throw new Error(`current limitations are stale:\n${failures.join('\n')}`);
  return {
    exactGitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    captureDate: new Date().toISOString(),
    title: 'Five things currently broken/unfinished in Varve',
    limitations: checked,
  };
}
