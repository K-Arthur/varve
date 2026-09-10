// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TIPS } from './tips';

const CATEGORIES = [
  'shortcuts',
  'editing',
  'panels',
  'layers',
  'text',
  'color',
  'export',
  'prototype',
  'grids',
] as const;

describe('tips database', () => {
  it('all 20+ tips have non-empty title and body', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(20);
    for (const tip of TIPS) {
      expect(tip.id).toBeTruthy();
      expect(tip.title).toBeTruthy();
      expect(tip.body).toBeTruthy();
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(0);
    }
  });

  it('tips database covers all 9 categories', () => {
    const covered = new Set(TIPS.map((t) => t.category));
    for (const cat of CATEGORIES) {
      expect(covered.has(cat)).toBe(true);
    }
  });
});
