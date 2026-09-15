/**
 * Review bundle generation (M14, ADR-0042).
 *
 * A review bundle is a self-contained, offline artifact describing the
 * semantic difference between two document revisions:
 *
 *   manifest.json   — machine-readable summary (schema `varve-review-bundle/1`)
 *   diff.json       — the full semantic diff (M10)
 *   summary.md      — human-readable markdown report
 *   index.html      — standalone accessible viewer (no network, no assets)
 *
 * Pixel previews are not generated: headless rendering is a documented
 * follow-up. The viewer renders before/after property tables instead.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DocumentDiff, diffDocuments, type SemanticChange } from '@varve/history';
import type { Document } from '@varve/scene';

export interface ReviewBundleFile {
  files: string[];
  changeCount: number;
}

export function buildReviewBundle(
  base: Document,
  target: Document,
  outputDir: string,
): ReviewBundleFile {
  const diff = diffDocuments(base, target);
  const manifest = {
    schema: 'varve-review-bundle/1',
    baseHash: diff.baseHash,
    targetHash: diff.targetHash,
    changeCount: diff.changes.length,
    summary: diff.summary,
    files: ['manifest.json', 'diff.json', 'summary.md', 'index.html'],
  };
  writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'diff.json'), JSON.stringify(diff, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'summary.md'), buildSummaryMarkdown(diff), 'utf8');
  writeFileSync(join(outputDir, 'index.html'), buildViewerHtml(diff), 'utf8');
  return { files: manifest.files, changeCount: diff.changes.length };
}

export function buildSummaryMarkdown(diff: DocumentDiff): string {
  const lines: string[] = [
    `# Review bundle — ${diff.changed ? `${diff.summary.total} change(s)` : 'no changes'}`,
    '',
    `- Base: \`${diff.baseHash}\``,
    `- Target: \`${diff.targetHash}\``,
    `- Changed: ${diff.changed ? 'yes' : 'no'}`,
    '',
    '## Summary',
    '',
    '| Type | Count |',
    '| --- | --- |',
    `| added | ${diff.summary.added} |`,
    `| removed | ${diff.summary.removed} |`,
    `| modified | ${diff.summary.modified} |`,
    `| renamed | ${diff.summary.renamed} |`,
    `| reordered | ${diff.summary.reordered} |`,
    `| text | ${diff.summary.text} |`,
    '',
    '## Changes',
    '',
  ];
  if (diff.changes.length === 0) {
    lines.push('_No semantic changes._');
  }
  for (const change of diff.changes) {
    lines.push(
      `- **[${change.changeType}]** ${change.entityType} \`${change.propertyPath ?? change.entityId}\``,
    );
    lines.push(`  - ${change.summary}`);
    if (change.before !== undefined) lines.push(`  - before: \`${shortJson(change.before)}\``);
    if (change.after !== undefined) lines.push(`  - after: \`${shortJson(change.after)}\``);
  }
  return `${lines.join('\n')}\n`;
}

function shortJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function buildViewerHtml(diff: DocumentDiff): string {
  const groups = groupByEntity(diff.changes);
  const toc = groups
    .map(
      ([label, count]) =>
        `<li><a href="#${anchorOf(label)}">${escapeHtml(label)} (${count})</a></li>`,
    )
    .join('\n');
  const sections = groups
    .map(
      ([label, , changes]) => `
    <section aria-labelledby="${anchorOf(label)}">
      <h2 id="${anchorOf(label)}">${escapeHtml(label)}</h2>
      <div class="changes">
        ${changes.map(changeRow).join('\n')}
      </div>
    </section>`,
    )
    .join('\n');
  const body = diff.changed
    ? `<nav aria-label="Table of contents"><ul>${toc}</ul></nav>
       ${sections}`
    : '<p>No semantic changes between these revisions.</p>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Review bundle — ${diff.changes.length} change(s)</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0 auto; max-width: 60rem; padding: 1.5rem; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: inherit; opacity: 0.7; font-size: 0.9rem; word-break: break-all; }
  nav ul { columns: 2; }
  .changes { display: grid; gap: 0.75rem; margin: 1rem 0 2rem; }
  article { border: 1px solid currentColor; border-radius: 0.5rem; padding: 0.75rem 1rem; }
  article h3 { margin: 0 0 0.25rem; }
  .badge { display: inline-block; border-radius: 0.25rem; padding: 0.05rem 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge.added { background: #0a7a3d; color: #fff; }
  .badge.removed { background: #b3261e; color: #fff; }
  .badge.modified { background: #8a5a00; color: #fff; }
  .badge.renamed, .badge.reordered { background: #5a4b8a; color: #fff; }
  .badge.text { background: #00639b; color: #fff; }
  .path { font-family: ui-monospace, monospace; font-size: 0.85rem; opacity: 0.8; word-break: break-all; }
  .summary { margin: 0.25rem 0; }
  pre { background: color-mix(in srgb, currentColor 8%, transparent); border-radius: 0.375rem; padding: 0.5rem 0.75rem; overflow-x: auto; font-size: 0.85rem; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
</head>
<body>
<h1>Review bundle</h1>
<p class="meta">Base <code>${diff.baseHash}</code> &rarr; Target <code>${diff.targetHash}</code> &middot; ${diff.changes.length} change(s)</p>
${body}
</body>
</html>
`;
}

function changeRow(change: SemanticChange): string {
  const before =
    change.before !== undefined ? `<pre>${escapeHtml(shortJson(change.before))}</pre>` : '';
  const after =
    change.after !== undefined ? `<pre>${escapeHtml(shortJson(change.after))}</pre>` : '';
  return `<article>
    <h3><span class="badge ${change.changeType}">${change.changeType}</span> <span class="path">${escapeHtml(change.propertyPath ?? change.entityId)}</span></h3>
    <p class="summary">${escapeHtml(change.summary)}</p>
    ${before}${after}
  </article>`;
}

function groupByEntity(changes: SemanticChange[]): Array<[string, number, SemanticChange[]]> {
  const byEntity = new Map<string, SemanticChange[]>();
  for (const change of changes) {
    const key = `${change.entityType} ${change.entityId}`;
    const list = byEntity.get(key) ?? [];
    list.push(change);
    byEntity.set(key, list);
  }
  return [...byEntity.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => [key, list.length, list] as [string, number, SemanticChange[]]);
}

function anchorOf(label: string): string {
  return `entity-${label.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
