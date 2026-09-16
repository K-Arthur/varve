/**
 * Border token-shorthand guard.
 *
 * `--border-micro` and `--border-micro-accent` are full border shorthands
 * (`1px solid <color>`). Nesting a shorthand token inside a border longhand
 * produces an invalid declaration at computed-value time (`border: 1px solid
 * 1px solid ...`) and the line silently paints nothing. That is how the
 * Mockups section and the Preflight warnings panel lost every separator for
 * an unknown number of releases (found 2026-09-15 while reviewing dividers).
 *
 * The tokens are derived from `tokens.css` instead of hardcoded so a new
 * shorthand token is covered automatically.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function findRepoRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    current = path.dirname(current);
  }
  throw new Error(`could not locate the repository root from ${start}`);
}

const repoRoot = findRepoRoot(__dirname);
const tokensCss = readFileSync(path.join(repoRoot, 'packages/ui/src/tokens/tokens.css'), 'utf8');

function shorthandBorderTokens(): string[] {
  const found: string[] = [];
  const declaration = /--([a-z0-9-]+):\s*([^;]+);/g;
  for (const match of tokensCss.matchAll(declaration)) {
    const [, name, value] = match;
    if (!name || !value) continue;
    if (/(^|\s)(solid|dashed|dotted)\s/.test(value) && /\d(px|rem)/.test(value)) {
      found.push(`--${name}`);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(css|tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

function nestingPattern(tokens: string[]): RegExp {
  return new RegExp(
    `border(-?(top|right|bottom|left|block|inline)(-(start|end))?)?\\s*:\\s*['"]?\\s*(?:1px|2px|0|thin|medium)\\s+(?:solid|dashed|dotted)\\s+(?:var\\([^)]*)?(${tokens
      .map((t) => t.replace(/[-]/g, '\\-'))
      .join('|')})`,
    'i',
  );
}

/** The guard's own fixtures contain the historical strings; skip it. */
const GUARD_FILE = 'borderTokenShorthand.test.ts';

describe('border shorthand tokens', () => {
  it('detects the shorthand tokens from tokens.css', () => {
    const tokens = shorthandBorderTokens();
    expect(tokens).toContain('--border-micro');
    expect(tokens).toContain('--border-micro-accent');
  });

  it('matches the historical broken form and not the corrected form', () => {
    const pattern = nestingPattern(['--border-micro']);
    expect(pattern.test('border: 1px solid var(--border-micro);')).toBe(true);
    expect(pattern.test("borderTop: '1px solid var(--border-micro)',")).toBe(true);
    expect(pattern.test('border: var(--border-micro);')).toBe(false);
    expect(pattern.test('border-top: var(--border-micro);')).toBe(false);
    expect(pattern.test('border-top: 1px solid var(--color-border-subtle);')).toBe(false);
  });

  it('are never nested inside a border longhand or shorthand', () => {
    const tokens = shorthandBorderTokens();
    const pattern = nestingPattern(tokens);
    const offenders: string[] = [];
    for (const root of ['packages/editor/src', 'packages/ui/src']) {
      for (const file of sourceFiles(path.join(repoRoot, root))) {
        if (file.endsWith(GUARD_FILE)) continue;
        const text = readFileSync(file, 'utf8');
        for (const [index, line] of text.split('\n').entries()) {
          if (pattern.test(line)) {
            offenders.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    }
    expect(
      offenders,
      `Shorthand border token nested in a longhand:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
