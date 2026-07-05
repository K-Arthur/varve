// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './content/helpTypes';
import { HELP_CONTENT, getHelpContent, searchHelpContent } from './content/helpContent';
import type { HelpArticle } from './content/helpTypes';

const VALID_CATEGORIES: string[] = [...CATEGORIES];

function getAllArticles(): HelpArticle[] {
  return Object.values(HELP_CONTENT);
}

describe('helpContent', () => {
  it('all articles have non-empty title', () => {
    for (const article of getAllArticles()) {
      expect(
        article.title.trim().length,
        `Article ${article.id} has empty title`,
      ).toBeGreaterThan(0);
    }
  });

  it('all articles have non-empty summary', () => {
    for (const article of getAllArticles()) {
      expect(
        article.summary.trim().length,
        `Article ${article.id} has empty summary`,
      ).toBeGreaterThan(0);
    }
  });

  it('all articles have non-empty body', () => {
    for (const article of getAllArticles()) {
      expect(
        article.body.trim().length,
        `Article ${article.id} has empty body`,
      ).toBeGreaterThan(0);
    }
  });

  it('all articles have at least 3 keywords', () => {
    for (const article of getAllArticles()) {
      expect(
        article.keywords.length,
        `Article ${article.id} has fewer than 3 keywords`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('every related reference points to a valid article ID', () => {
    for (const article of getAllArticles()) {
      for (const relatedId of article.related) {
        expect(
          HELP_CONTENT[relatedId],
          `Article ${article.id} references invalid related ID "${relatedId}"`,
        ).toBeDefined();
      }
    }
  });

  it('no broken text in body (no unmatched ** or _)', () => {
    for (const article of getAllArticles()) {
      const body = article.body;
      const boldPairs = (body.match(/\*\*/g) || []).length;
      expect(
        boldPairs % 2,
        `Article ${article.id} has unmatched ** in body`,
      ).toBe(0);
      const italicPairs = (body.match(/_(?!\s)/g) || []).length;
      // Allow underscores in things like `Ctrl_`, measure_text, etc.
      // Just check that there are no isolated unmatched markdown underscores
      const mdItalic = body.match(/(?<!\w)_(?!_|\w)/g);
      if (mdItalic) {
        expect(
          mdItalic.length % 2,
          `Article ${article.id} has unmatched _ in body`,
        ).toBe(0);
      }
    }
  });

  it('all categories match known category list', () => {
    for (const article of getAllArticles()) {
      expect(
        VALID_CATEGORIES,
        `Article ${article.id} has unknown category "${article.category}"`,
      ).toContain(article.category);
    }
  });

  it('all tool-related keywords include tool names', () => {
    const toolArticles = getAllArticles().filter((a) => a.category === 'Tools');
    for (const article of toolArticles) {
      const hasToolKeyword = article.keywords.some((k) => {
        const id = article.id.replace('tool:', '');
        return k.includes(id);
      });
      expect(
        hasToolKeyword,
        `Article ${article.id} should include tool name in keywords`,
      ).toBe(true);
    }
  });

  it('FAQ covers all 10+ topics', () => {
    const faqArticles = getAllArticles().filter((a) => a.category === 'FAQ');
    expect(faqArticles.length).toBeGreaterThanOrEqual(10);
  });

  it('body length under 500 words per article', () => {
    for (const article of getAllArticles()) {
      const wordCount = article.body.split(/\s+/).filter(Boolean).length;
      expect(
        wordCount,
        `Article ${article.id} has ${wordCount} words (max 500)`,
      ).toBeLessThanOrEqual(500);
    }
  });

  it('searchHelpContent returns results for known query', () => {
    const results = searchHelpContent('rectangle');
    expect(results.length).toBeGreaterThan(0);
  });

  it('searchHelpContent returns empty for non-matching query', () => {
    const results = searchHelpContent('xyznonexistent12345');
    expect(results.length).toBe(0);
  });

  it('searchHelpContent is case-insensitive', () => {
    const upper = searchHelpContent('RECTANGLE');
    const lower = searchHelpContent('rectangle');
    expect(upper.length).toBeGreaterThan(0);
    expect(upper.length).toBe(lower.length);
  });

  it('getHelpContent returns undefined for unknown id', () => {
    expect(getHelpContent('nonexistent-id')).toBeUndefined();
  });

  it('getHelpContent returns article for known id', () => {
    const article = getHelpContent('tool:select');
    expect(article).toBeDefined();
    expect(article?.id).toBe('tool:select');
  });

  it('Getting Started category has at least 5 articles', () => {
    const articles = getAllArticles().filter((a) => a.category === 'Getting Started');
    expect(articles.length).toBeGreaterThanOrEqual(5);
  });

  it('Tools category has at least 10 articles', () => {
    const articles = getAllArticles().filter((a) => a.category === 'Tools');
    expect(articles.length).toBeGreaterThanOrEqual(10);
  });

  it('Panels category has at least 5 articles', () => {
    const articles = getAllArticles().filter((a) => a.category === 'Panels');
    expect(articles.length).toBeGreaterThanOrEqual(5);
  });

  it('Export category has at least 5 articles', () => {
    const articles = getAllArticles().filter((a) => a.category === 'Export');
    expect(articles.length).toBeGreaterThanOrEqual(5);
  });

  it('Troubleshooting category has at least 4 articles', () => {
    const articles = getAllArticles().filter((a) => a.category === 'Troubleshooting');
    expect(articles.length).toBeGreaterThanOrEqual(4);
  });

  it('all article IDs are unique', () => {
    const ids = getAllArticles().map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
