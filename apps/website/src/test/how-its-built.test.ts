import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  new URL('../pages/about/how-its-built.astro', import.meta.url),
  'utf8',
);

const FIRST_PERSON_SINGULAR = /\b(?:I|I'm|I’ll|I'll|I’d|I'd|I’ve|I've|me|my|mine|myself)\b/;

describe('how-its-built disclosure', () => {
  it('speaks as Varve, not as a named person', () => {
    expect(page).not.toMatch(/\bKevin\b/);
    expect(page).not.toMatch(FIRST_PERSON_SINGULAR);
    expect(page).toMatch(/author:\s*\{\s*'@id':\s*`\$\{siteOrigin\(\)\}#organization`/);
    expect(page).toMatch(/publisher:\s*\{\s*'@id':\s*`\$\{siteOrigin\(\)\}#organization`/);
  });

  it('states AI-assisted development and the in-app AI default', () => {
    expect(page).toMatch(/AI coding assistants/);
    expect(page).toMatch(/on by default/);
    expect(page).toMatch(/single switch/);
    expect(page).toMatch(/Settings turns them all off/);
  });
});
