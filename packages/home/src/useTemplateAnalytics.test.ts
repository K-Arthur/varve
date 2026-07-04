/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMostUsedTemplates,
  getRecentTemplates,
  recordTemplateUsage,
} from './useTemplateAnalytics';

interface TestTemplate {
  id: string;
  name: string;
}

function makeTemplate(id: string, name: string): TestTemplate {
  return { id, name };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('recordTemplateUsage', () => {
  it('increments usage count on each call', () => {
    recordTemplateUsage('tpl-1');
    recordTemplateUsage('tpl-1');
    recordTemplateUsage('tpl-1');

    const most = getMostUsedTemplates(
      [makeTemplate('tpl-1', 'One')],
      10,
    );
    expect(most).toHaveLength(1);
    expect(most[0]?.id).toBe('tpl-1');
  });

  it('records separate counts for different templates', () => {
    recordTemplateUsage('tpl-a');
    recordTemplateUsage('tpl-a');
    recordTemplateUsage('tpl-b');

    const templates = [
      makeTemplate('tpl-a', 'A'),
      makeTemplate('tpl-b', 'B'),
    ];

    const most = getMostUsedTemplates(templates, 10);
    expect(most).toHaveLength(2);
    expect(most[0]?.id).toBe('tpl-a');
    expect(most[1]?.id).toBe('tpl-b');
  });
});

describe('getMostUsedTemplates', () => {
  it('returns top N by usage count', () => {
    recordTemplateUsage('tpl-1');
    recordTemplateUsage('tpl-2');
    recordTemplateUsage('tpl-2');
    recordTemplateUsage('tpl-3');
    recordTemplateUsage('tpl-3');
    recordTemplateUsage('tpl-3');

    const templates = [
      makeTemplate('tpl-1', 'One'),
      makeTemplate('tpl-2', 'Two'),
      makeTemplate('tpl-3', 'Three'),
      makeTemplate('tpl-4', 'Four'),
    ];

    const top2 = getMostUsedTemplates(templates, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0]?.id).toBe('tpl-3');
    expect(top2[1]?.id).toBe('tpl-2');
  });

  it('returns empty array when no templates have been used', () => {
    const templates = [makeTemplate('tpl-1', 'One')];
    expect(getMostUsedTemplates(templates, 10)).toHaveLength(0);
  });

  it('respects count limit', () => {
    recordTemplateUsage('tpl-1');
    recordTemplateUsage('tpl-2');

    const templates = [
      makeTemplate('tpl-1', 'One'),
      makeTemplate('tpl-2', 'Two'),
    ];

    expect(getMostUsedTemplates(templates, 1)).toHaveLength(1);
  });
});

describe('getRecentTemplates', () => {
  it('returns templates sorted by last used timestamp', () => {
    recordTemplateUsage('tpl-1');
    // Small delay to ensure different timestamps
    const before = Date.now();
    while (Date.now() - before < 5) {
      // spin
    }
    recordTemplateUsage('tpl-2');

    const templates = [
      makeTemplate('tpl-1', 'One'),
      makeTemplate('tpl-2', 'Two'),
    ];

    const recent = getRecentTemplates(templates, 10);
    expect(recent[0]?.id).toBe('tpl-2');
    expect(recent[1]?.id).toBe('tpl-1');
  });

  it('returns empty array when no templates used', () => {
    expect(getRecentTemplates([makeTemplate('tpl-1', 'One')], 10)).toHaveLength(0);
  });
});
