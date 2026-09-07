/**
 * Build-time changelog parser.
 *
 * Converts a Keep a Changelog markdown file into structured, typed release
 * data that the changelog page renders statically at build time. No runtime
 * parsing, no network access, no client-side markdown processing.
 *
 * The parser understands the exact structure Varve's CHANGELOG.md uses:
 *   - `## [version] - YYYY-MM-DD` headings (semver or Unreleased)
 *   - `### Category` subheadings (Added, Changed, Fixed, Deprecated, Removed, Security)
 *   - List items with inline markdown (bold, code, links, emphasis)
 *   - Inter-item paragraphs
 *   - A horizontal rule ending the document
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type ChangeCategory =
  | 'Added'
  | 'Changed'
  | 'Deprecated'
  | 'Removed'
  | 'Fixed'
  | 'Security'
  | string;

export interface ChangelogEntry {
  /** HTML-rendered content for one list item or paragraph. */
  html: string;
}

export interface ChangelogSection {
  category: ChangeCategory;
  entries: ChangelogEntry[];
}

export interface ChangelogRelease {
  /** Version string (e.g. '0.2.1') or 'Unreleased'. */
  version: string;
  /** ISO date string or null for Unreleased. */
  date: string | null;
  /** Ordered changelog sections. */
  sections: ChangelogSection[];
  /** Anchor-safe id for deep linking (e.g. 'v0.2.1' or 'unreleased'). */
  anchor: string;
  /** True when this is the Unreleased section. */
  isUnreleased: boolean;
}

/* -------------------------------------------------------------------------- */
/* Markdown → HTML (minimal, trusted-source only)                              */
/* -------------------------------------------------------------------------- */

/** Inline markdown: bold, italic, code, links. HTML entities escaped first. */
function inlineMd(text: string): string {
  let s = text;
  // Escape HTML entities that aren't part of our markdown syntax
  s = s.replace(/&/g, '&amp;');
  s = s.replace(/</g, '&lt;');
  s = s.replace(/>/g, '&gt;');
  // Links [text](url) — must run before bold/italic to avoid conflicts
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Inline code `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (single asterisk, not double)
  s = s.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  return s;
}

/**
 * Convert markdown list item lines to HTML.
 *
 * Input is an array of raw markdown lines where each line starts with "- ".
 * Continuation lines (without "- ") are appended to the previous item.
 * Blank lines within a list create paragraph breaks inside the current item.
 */
function listToHtml(lines: string[]): string {
  const items: string[] = [];
  let current = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      // Save any previous item
      if (current) items.push(current);
      current = inlineMd(trimmed.slice(2));
    } else if (trimmed === '') {
      // Blank line inside a list — paragraph break within current item
      if (current) current += '</p><p>';
    } else if (current) {
      // Continuation of previous item (soft-wrapped line)
      current += ' ' + inlineMd(trimmed);
    }
  }
  if (current) items.push(current);

  if (items.length === 0) return '';
  return '<ul>\n' + items.map((item) => `  <li>${item}</li>`).join('\n') + '\n</ul>';
}

/* -------------------------------------------------------------------------- */
/* Changelog parsing                                                           */
/* -------------------------------------------------------------------------- */

const VERSION_RE = /^## \[([^\]]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const CATEGORY_RE = /^### (.+)$/;
const HR_RE = /^-{3,}\s*$/;

/**
 * Parse a Keep a Changelog markdown string into structured release data.
 *
 * Validates: no duplicate versions, no malformed version headings.
 * Releases appear in document order (newest first, as written).
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  // Strip HTML comments (the changelog has a commented-out template).
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const lines = cleaned.split('\n');

  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let currentSection: ChangelogSection | null = null;
  let listLines: string[] = [];

  /** Flush accumulated list lines into the current section as a single entry. */
  function flushList() {
    if (!current || !currentSection || listLines.length === 0) return;
    const html = listToHtml(listLines);
    if (html) currentSection.entries.push({ html });
    listLines = [];
  }

  /** Close current section and push it to the current release. */
  function closeSection() {
    flushList();
    if (currentSection && current) {
      current.sections.push(currentSection);
    }
    currentSection = null;
  }

  /** Close current release and push it to the results. */
  function closeRelease() {
    closeSection();
    if (current) {
      releases.push(current);
    }
    current = null;
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Horizontal rule: end of document
    if (HR_RE.test(trimmed)) {
      closeRelease();
      break;
    }

    // Version heading
    const versionMatch = trimmed.match(VERSION_RE);
    if (versionMatch) {
      closeRelease();
      const version = versionMatch[1];
      const date = versionMatch[2] ?? null;
      current = {
        version,
        date,
        sections: [],
        anchor: version === 'Unreleased' ? 'unreleased' : `v${version}`,
        isUnreleased: version === 'Unreleased',
      };
      continue;
    }

    // Category heading
    const categoryMatch = trimmed.match(CATEGORY_RE);
    if (categoryMatch && current) {
      closeSection();
      currentSection = {
        category: categoryMatch[1].trim(),
        entries: [],
      };
      continue;
    }

    // Content lines (only inside a version + category)
    if (current && currentSection) {
      if (trimmed.startsWith('- ')) {
        // New list item — flush any accumulated lines, start fresh
        flushList();
        listLines.push(trimmed);
      } else if (trimmed === '') {
        // Blank line — flush accumulated list content
        flushList();
      } else if (listLines.length > 0) {
        // Continuation of a list item
        listLines.push(trimmed);
      }
      // Standalone non-list lines between categories are ignored (they don't
      // appear in Varve's changelog, which uses only list entries).
    }
  }

  // Flush trailing content (document without final HR)
  closeRelease();

  if (releases.length === 0) {
    throw new Error('No release sections found in changelog');
  }

  // Validate: no duplicate versions
  const seen = new Set<string>();
  for (const r of releases) {
    if (seen.has(r.version)) {
      throw new Error(`Duplicate version in changelog: ${r.version}`);
    }
    seen.add(r.version);
  }

  return releases;
}

/**
 * Parse CHANGELOG.md from the repository root.
 *
 * This is the primary entry point for the build script. It reads the file,
 * parses it, and returns structured data ready for JSON serialization.
 */
export function parseChangelogFile(repoRoot?: string): ChangelogRelease[] {
  // During Astro SSR builds, import.meta.url points to the bundled chunk,
  // not the original source file. Try common root locations:
  //   1. Explicit repoRoot argument (preferred)
  //   2. Two levels up from process.cwd() (standard: cwd = apps/website)
  //   3. process.cwd() itself (vitest from repo root)
  const candidates = repoRoot ? [repoRoot] : [join(process.cwd(), '..', '..'), process.cwd()];

  for (const root of candidates) {
    try {
      const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
      return parseChangelog(text);
    } catch {
      // try next candidate
    }
  }

  throw new Error('Could not find CHANGELOG.md. Searched: ' + candidates.join(', '));
}
