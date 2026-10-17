import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../pages/download.astro', import.meta.url), 'utf8');

describe('download page install routes', () => {
  it('does not recommend an unpublished Arch PKGBUILD or AUR package', () => {
    expect(page).not.toMatch(/PKGBUILD <span class="format-badge">recommended<\/span>/);
    expect(page).not.toMatch(/makepkg -si/);
    expect(page).not.toMatch(/packaging\/aur\/varve-desktop-bin/);
    expect(page).not.toMatch(/An AUR package is coming/);
    expect(page).not.toMatch(/AUR registration is currently closed/);
    expect(page).not.toMatch(/AUR\/Arch is fixed/);
    expect(page).not.toMatch(/is fixed and fine to use/);
    expect(page).not.toMatch(/the repository PKGBUILD is fine to use/);
  });

  it('shows the published snapshot as a UTC calendar date', () => {
    expect(page).toMatch(/formatReleaseDate\(release\.releaseDate\)/);
    expect(page).toMatch(/timeZone: 'UTC'/);
  });
});
