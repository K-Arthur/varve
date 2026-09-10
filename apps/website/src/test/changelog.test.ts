import { describe, expect, it } from 'vitest';
import { type ChangelogRelease, parseChangelog } from '../lib/changelog.js';

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                               */
/* -------------------------------------------------------------------------- */

const BASIC = `# Changelog

All notable changes.

## [Unreleased]

## [0.2.1] - 2026-08-24

### Added

- **Image Enhance** — batch enhancement processes every image.
- A second list item with \`inline code\` and [a link](https://example.com).

### Changed

- Minor improvements.

### Fixed

- Fixed a bug.

## [0.1.0] - 2026-08-09

### Added

- First release.
`;

const PRERELEASE = `# Changelog

## [0.3.0-beta.1] - 2026-09-01

### Added

- Beta features.
`;

const SINGLE = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Everything.
`;

const UNRELEASED_ONLY = `# Changelog

## [Unreleased]

### Added

- Work in progress.
`;

const MULTI_PARAGRAPH = `# Changelog

## [2.0.0] - 2026-06-15

### Added

- Feature one with
  continuation on the next line.

- Feature two after a blank line.
`;

const WITH_COMMENTS = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Real feature.

<!--
## [0.1.0] - 2026-MM-DD

### Added
### Changed
### Fixed
-->
`;

const DUPLICATE_VERSIONS = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- First.

## [1.0.0] - 2026-02-01

### Added

- Duplicate.
`;

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('parseChangelog', () => {
  it('parses a basic changelog', () => {
    const releases = parseChangelog(BASIC);
    expect(releases.length).toBe(3);
  });

  it('Unreleased section first', () => {
    const releases = parseChangelog(BASIC);
    expect(releases[0].version).toBe('Unreleased');
    expect(releases[0].isUnreleased).toBe(true);
    expect(releases[0].date).toBeNull();
    expect(releases[0].anchor).toBe('unreleased');
  });

  it('parses version and date', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    expect(v21).toBeDefined();
    expect(v21.date).toBe('2026-08-24');
    expect(v21.isUnreleased).toBe(false);
    expect(v21.anchor).toBe('v0.2.1');
  });

  it('parses all categories', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    expect(v21.sections.map((s) => s.category)).toEqual(['Added', 'Changed', 'Fixed']);
  });

  it('parses multiline list items', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    const added = v21.sections.find((s) => s.category === 'Added')!;
    expect(added.entries.length).toBe(2);
  });

  it('renders inline code', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    const added = v21.sections.find((s) => s.category === 'Added')!;
    expect(added.entries[1].html).toContain('<code>inline code</code>');
  });

  it('renders links', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    const added = v21.sections.find((s) => s.category === 'Added')!;
    expect(added.entries[1].html).toContain('href="https://example.com"');
  });

  it('renders bold text', () => {
    const releases = parseChangelog(BASIC);
    const v21 = releases.find((r) => r.version === '0.2.1')!;
    const added = v21.sections.find((s) => s.category === 'Added')!;
    expect(added.entries[0].html).toContain('<strong>Image Enhance</strong>');
  });

  it('parses prerelease versions', () => {
    const releases = parseChangelog(PRERELEASE);
    expect(releases[0].version).toBe('0.3.0-beta.1');
    expect(releases[0].date).toBe('2026-09-01');
    expect(releases[0].anchor).toBe('v0.3.0-beta.1');
  });

  it('parses a single release', () => {
    const releases = parseChangelog(SINGLE);
    expect(releases.length).toBe(1);
    expect(releases[0].version).toBe('1.0.0');
    expect(releases[0].sections).toHaveLength(1);
    expect(releases[0].sections[0].category).toBe('Added');
  });

  it('handles Unreleased-only changelog', () => {
    const releases = parseChangelog(UNRELEASED_ONLY);
    expect(releases.length).toBe(1);
    expect(releases[0].version).toBe('Unreleased');
    expect(releases[0].isUnreleased).toBe(true);
  });

  it('handles multiline entries with blank line separation', () => {
    const releases = parseChangelog(MULTI_PARAGRAPH);
    const v2 = releases.find((r) => r.version === '2.0.0')!;
    const added = v2.sections.find((s) => s.category === 'Added')!;
    // Two list items
    expect(added.entries.length).toBe(2);
  });

  it('strips HTML comments (template block)', () => {
    const releases = parseChangelog(WITH_COMMENTS);
    // The commented-out 0.1.0 should NOT appear
    expect(releases.length).toBe(1);
    expect(releases[0].version).toBe('1.0.0');
  });

  it('rejects duplicate versions', () => {
    expect(() => parseChangelog(DUPLICATE_VERSIONS)).toThrow('Duplicate version');
  });

  it('rejects empty changelog', () => {
    expect(() => parseChangelog('# Changelog\n')).toThrow('No release sections');
  });

  it('orders releases newest first', () => {
    const releases = parseChangelog(BASIC);
    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '0.2.1', '0.1.0']);
  });

  it('handles empty Unreleased section', () => {
    const releases = parseChangelog(BASIC);
    const unreleased = releases[0];
    expect(unreleased.isUnreleased).toBe(true);
    // Empty Unreleased has no sections
    expect(unreleased.sections.length).toBe(0);
  });

  it('HTML-escapes content safely', () => {
    const input = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Content with <script>alert('xss')</script> tags.
`;
    const releases = parseChangelog(input);
    const added = releases[0].sections.find((s) => s.category === 'Added')!;
    expect(added.entries[0].html).not.toContain('<script>');
    expect(added.entries[0].html).toContain('&lt;script&gt;');
  });

  it('strips < and > before inline parsing', () => {
    const input = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Uses the \`<div>\` element.
`;
    const releases = parseChangelog(input);
    const added = releases[0].sections.find((s) => s.category === 'Added')!;
    expect(added.entries[0].html).toContain('<code>&lt;div&gt;</code>');
  });

  it('parses all Keep a Changelog categories', () => {
    const input = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- New feature.

### Changed

- Modified behavior.

### Deprecated

- Old API.

### Removed

- Legacy support.

### Fixed

- Bug fix.

### Security

- Patched vulnerability.
`;
    const releases = parseChangelog(input);
    expect(releases[0].sections.map((s) => s.category)).toEqual([
      'Added',
      'Changed',
      'Deprecated',
      'Removed',
      'Fixed',
      'Security',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* parseChangelogFile (integration)                                            */
/* -------------------------------------------------------------------------- */

describe('parseChangelogFile', () => {
  it('parses the actual CHANGELOG.md', async () => {
    const { parseChangelogFile } = await import('../lib/changelog.js');
    const releases = parseChangelogFile();
    expect(releases.length).toBeGreaterThanOrEqual(1);

    // Should contain known versions
    const versions = releases.filter((r) => !r.isUnreleased).map((r) => r.version);
    expect(versions).toContain('0.2.1');
    expect(versions).toContain('0.1.0');
  });

  it('Unreleased is first when present', async () => {
    const { parseChangelogFile } = await import('../lib/changelog.js');
    const releases = parseChangelogFile();
    const first = releases[0];
    if (first.isUnreleased) {
      expect(first.version).toBe('Unreleased');
      expect(first.date).toBeNull();
    }
  });

  it('every release with sections has at least one entry across all sections', async () => {
    const { parseChangelogFile } = await import('../lib/changelog.js');
    const releases = parseChangelogFile();
    for (const r of releases) {
      if (!r.isUnreleased) {
        // The release should have at least some content
        const totalEntries = r.sections.reduce((n, s) => n + s.entries.length, 0);
        expect(totalEntries).toBeGreaterThan(0);
      }
    }
  });
});
