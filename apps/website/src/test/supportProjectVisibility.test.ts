import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOW_SUPPORT_PROJECT } from '../config/features.js';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('support project visibility', () => {
  it('keeps the placeholder noindex while the public page is hidden', () => {
    expect(SHOW_SUPPORT_PROJECT).toBe(false);
    const source = read('pages/support-project.astro');
    expect(source).toContain('{!SHOW_SUPPORT_PROJECT ? (');
    expect(source).toContain('description="This page isn\'t available yet." noindex');
    const layout = read('layouts/Layout.astro');
    expect(layout).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});
