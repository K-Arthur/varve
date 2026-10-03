import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.hoisted(() => ({ outputPath: vi.fn<(path: string) => string>() }));
vi.mock('@playwright/test', () => ({ test: { info: () => info } }));

import { evidencePath } from '../e2e/helpers/evidence-output';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'varve-evidence-test-'));
  info.outputPath.mockImplementation((path) => join(root, 'run', 'case', path));
  vi.stubEnv('VARVE_E2E_CAPTURE_ROOT', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('E2E evidence ownership', () => {
  it('uses the current test output, including its retry/project isolation', () => {
    expect(evidencePath('comic-workflow/panels.png')).toBe(
      join(root, 'run', 'case', 'comic-workflow', 'panels.png'),
    );
    info.outputPath.mockImplementation((path) => join(root, 'retry-1', path));
    expect(evidencePath('comic-workflow/panels.png')).toBe(
      join(root, 'retry-1', 'comic-workflow', 'panels.png'),
    );
  });

  it('requires an explicit root to produce review captures and preserves scene groups', () => {
    vi.stubEnv('VARVE_E2E_CAPTURE_ROOT', join(root, 'review'));
    expect(evidencePath('comic-workflow/panels.png')).toBe(
      join(root, 'review', 'comic-workflow', 'panels.png'),
    );
  });

  it('preserves an owning producer capture-directory override', () => {
    expect(evidencePath('gpu-acceleration/canvas.png', join(root, 'gpu-review'))).toBe(
      join(root, 'gpu-review', 'canvas.png'),
    );
  });

  it.each(['../published.png', 'scene/../../published.png', '..\\published.png', '/published.png'])(
    'rejects output escape: %s',
    (path) => expect(() => evidencePath(path)).toThrow(/must be relative/),
  );
});

function specFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? specFiles(path) : entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

it('ordinary browser specs declare no default published screenshot destination', () => {
  const directory = fileURLToPath(new URL('../e2e/', import.meta.url));
  const offenders: string[] = [];
  for (const path of specFiles(directory)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        /(?:^|[/\\])(?:docs[/\\]screenshots|apps[/\\]website[/\\]public[/\\]screenshots)(?:[/\\]|$)/.test(
          node.text,
        )
      ) {
        offenders.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      if (ts.isCallExpression(node)) {
        const segments = node.arguments.flatMap((argument) =>
          ts.isStringLiteral(argument) ? [argument.text] : [],
        );
        if (segments.join('/').includes('docs/screenshots')) offenders.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(offenders).toEqual([]);
});
