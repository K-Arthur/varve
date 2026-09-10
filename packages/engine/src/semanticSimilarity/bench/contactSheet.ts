/**
 * HTML contact sheets for visual review of retrieval rankings.
 * Writes self-contained-ish pages that reference corpus images by
 * relative path (from reports/semantic-similarity/). Dev-only.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Corpus } from './corpus';
import type { EvaluationReport, QueryReport, RankedEntry } from './evaluate';

const _RELATION_LABELS: Record<string, string> = {
  base: 'base',
  exact: 'exact',
  resized: 'resized 1/4',
  'resized-up': 'resized 2x',
  'jpeg-q60': 'jpeg q60',
  'jpeg-q85': 'jpeg q85',
  'png-jpeg-roundtrip': 'png<->jpeg',
  'hue-shifted': 'hue +38',
  'hue-shifted-neg': 'hue -25',
  monochrome: 'monochrome',
  mirrored: 'mirrored',
  'crop-center': 'crop center',
  'crop-offset': 'crop offset',
  'rotate-90': 'rotated 90',
  'badge-overlay': 'badge overlay',
  'text-overlay': 'text overlay',
  framing: 'framing A',
  'framing-2': 'framing B',
  style: 'style variant',
  'color-twin': 'color twin (distractor)',
  'composition-twin': 'composition twin (distractor)',
};

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function imgTag(corpus: Corpus, id: string, label: string, score?: number, title?: string): string {
  const image = corpus.byId.get(id);
  if (!image) return '<span class="missing">missing</span>';
  const src = `../../../../tests/fixtures/semantic-corpus/${image.file}`;
  const scoreHtml =
    score !== undefined ? `<span class="score">${(score * 100).toFixed(1)}%</span>` : '';
  return `<div class="cell ${title ? `t-${title}` : ''}">
    <img loading="lazy" src="${esc(src)}" alt="${esc(id)}">
    <div class="caption">${esc(label)} ${scoreHtml}<span class="rel">${esc(image.relation)}</span></div>
  </div>`;
}

function rankingRow(
  corpus: Corpus,
  query: QueryReport,
  ranked: readonly RankedEntry[],
  topK: number,
): string {
  const cells = ranked
    .slice(0, topK)
    .map((e) => imgTag(corpus, e.id, e.id, e.score, e.relevant ? 'relevant' : 'distractor'))
    .join('');
  return `<div class="query-row"><div class="query">${imgTag(corpus, query.id, 'QUERY', undefined)}</div>
    <div class="results">${cells}</div></div>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #14161a; color: #e8eaed; }
  h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin-top: 2rem; }
  .query-row { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.5rem; border-bottom: 1px solid #2c2f36; padding-bottom: 1rem; }
  .query { flex: 0 0 120px; } .results { display: grid; grid-template-columns: repeat(5, 110px); gap: 0.5rem; }
  .cell { text-align: center; } .cell img { width: 110px; height: 82px; object-fit: cover; border-radius: 4px; display: block; }
  .t-relevant img { outline: 2px solid #3ddc84; } .t-distractor img { outline: 1px solid #d93025; }
  .caption { font-size: 0.62rem; color: #9aa0a6; margin-top: 2px; } .score { color: #8ab4f8; }
  .rel { display: block; color: #fdd663; font-size: 0.6rem; }
  .missing { color: #f28b82; } .legend { color: #9aa0a6; font-size: 0.75rem; margin-bottom: 1rem; }
</style></head><body><h1>${esc(title)}</h1>
<div class="legend">green outline = relevant; red outline = distractor; % = cosine similarity</div>
${body}</body></html>`;
}

export function writeContactSheets(
  report: EvaluationReport,
  corpus: Corpus,
  root = resolve(process.cwd(), 'reports/semantic-similarity'),
): string[] {
  mkdirSync(root, { recursive: true });
  const files: string[] = [];

  const semanticBody = report.queries.map((q) => rankingRow(corpus, q, q.semantic, 10)).join('\n');
  const semanticFile = join(root, `contact-sheet-${report.model.id}-semantic.html`);
  writeFileSync(semanticFile, page(`Contact sheet — ${report.model.id} semantic`, semanticBody));
  files.push(semanticFile);

  const dupBody = report.queries.map((q) => rankingRow(corpus, q, q.duplicate, 10)).join('\n');
  const dupFile = join(root, `contact-sheet-${report.model.id}-duplicates.html`);
  writeFileSync(dupFile, page(`Contact sheet — ${report.model.id} near-duplicates`, dupBody));
  files.push(dupFile);

  // Difficult cases: first relevant result at rank > 2, or no relevant in top 10.
  const difficult = report.queries
    .map((q) => {
      const firstRelevant = q.semantic.findIndex((e) => e.relevant);
      return { q, firstRelevant };
    })
    .filter(({ firstRelevant }) => firstRelevant === -1 || firstRelevant > 2)
    .sort((a, b) => b.firstRelevant - a.firstRelevant);
  const diffBody = difficult
    .map(
      ({ q, firstRelevant }) =>
        `<h2>${esc(q.id)} — first relevant at rank ${firstRelevant === -1 ? 'none (top 10)' : firstRelevant + 1}</h2>` +
        rankingRow(corpus, q, q.semantic, 10),
    )
    .join('\n');
  const diffFile = join(root, `difficult-cases-${report.model.id}.html`);
  writeFileSync(diffFile, page(`Difficult cases — ${report.model.id}`, diffBody || '<p>none</p>'));
  files.push(diffFile);

  return files;
}
