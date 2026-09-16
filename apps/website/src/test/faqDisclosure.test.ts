import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FAQ disclosure guards.
 *
 * The support FAQ keeps its questions twice on purpose: once as visible
 * `<h3>` markup and once in FAQPage structured data for answer engines. The
 * duplication had drifted silently (a question had already diverged in
 * wording). These are source-level guards for the question set; rendered
 * keyboard/print behaviour is covered by the website E2E suite.
 *
 * Google retired FAQ rich results from Search on 2026-05-07, so structured
 * data is retained for answer engines, not for a results dropdown.
 */

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function unquote(literal: string): string {
  const inner = literal.slice(1, -1);
  return inner.replace(/\\(['"\\])/g, '$1');
}

function visibleQuestions(source: string): string[] {
  return [...source.matchAll(/<h3 class="faq-item__question-text">(.*?)<\/h3>/g)]
    .map((m) => decodeEntities(m[1]!.trim()))
    .filter((q) => q !== '{q}');
}

function schemaQuestions(source: string): string[] {
  const start = source.indexOf('mainEntity: [');
  expect(start, 'FAQ schema block present').toBeGreaterThan(-1);
  const end = source.indexOf('],\n};', start);
  const block = source.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/name: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
}

/** Questions from a page that defines one `faqs` array (markup + schema both map it). */
function arrayQuestions(source: string): string[] {
  const start = source.indexOf('const faqs = [');
  expect(start, 'faqs array present').toBeGreaterThan(-1);
  const end = source.indexOf('\n];', start);
  const block = source.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/\bq: ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)].map((m) =>
    unquote(m[1]!),
  );
}

function expectQuestionParity(visible: string[], schema: string[], label: string): void {
  expect(visible.length, `${label}: visible FAQ questions`).toBeGreaterThan(0);
  expect(visible.length, `${label}: schema/visible question counts`).toBe(schema.length);
  for (const question of schema) {
    expect(visible, `${label}: schema question "${question}" is visible`).toContain(question);
  }
  for (const question of visible) {
    expect(schema, `${label}: visible question "${question}" is in the schema`).toContain(question);
  }
}

describe('FAQ disclosure contract', () => {
  it('keeps the support FAQ questions in sync between schema and markup', () => {
    const source = read('pages/support/faq.astro');
    expectQuestionParity(visibleQuestions(source), schemaQuestions(source), 'faq.astro');
  });

  it('keeps the compare page questions in sync by construction', () => {
    const source = read('pages/compare.astro');
    const questions = arrayQuestions(source);
    expect(questions.length, 'compare.astro: FAQ entries').toBeGreaterThanOrEqual(4);
    for (const question of questions) {
      expect(question.length, 'compare.astro: non-empty question').toBeGreaterThan(0);
    }
    // Markup and schema both consume the same array, so the only drift risk is
    // a second hardcoded copy appearing.
    expect(source).toContain('mainEntity: faqs.map');
    expect(source).toContain('{faqs.map(({ q, a }) => (');
    expect(source).toContain('<h3 class="faq-item__question-text">{q}</h3>');
  });

  it('exposes FAQ questions as headings, not bare summary text', () => {
    const support = read('pages/support/faq.astro');
    const summaryCount = [...support.matchAll(/<summary class="faq-item__question">/g)].length;
    expect(summaryCount, 'faq.astro: FAQ summaries').toBeGreaterThan(0);
    expect(visibleQuestions(support).length, 'faq.astro: summaries with heading questions').toBe(
      summaryCount,
    );

    const compare = read('pages/compare.astro');
    expect(compare).toContain('<h3 class="faq-item__question-text">{q}</h3>');
  });

  it('prints every answer, not only the open ones', () => {
    for (const page of ['pages/support/faq.astro', 'pages/compare.astro']) {
      const source = read(page);
      expect(source, `${page}: print override`).toContain('@media print');
      expect(source, `${page}: reveals native details content`).toContain(
        'content-visibility: visible',
      );
      expect(source, `${page}: reveals the answer container`).toMatch(
        /details-content[\s\S]*?\.faq-item > \.faq-item__answer\s*\{[^}]*display: block/,
      );
    }
  });

  it('does not use exclusive details groups that prevent comparing answers', () => {
    for (const page of ['pages/support/faq.astro', 'pages/compare.astro']) {
      const source = read(page);
      expect(source, `${page}: no exclusive name="" group`).not.toMatch(/<details[^>]*\sname=/);
    }
  });
});
