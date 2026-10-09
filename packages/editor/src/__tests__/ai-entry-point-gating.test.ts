/**
 * AI Entry Point Gating Audit
 *
 * Ensures every AI/ML feature entry point checks the ai.enabled setting
 * before executing. Fails if a new AI entry point lacks the check.
 *
 * This test scans the codebase for known AI-related patterns and verifies
 * each has appropriate gating logic nearby.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Known AI entry points that must be gated.
 * Each entry specifies the file and the function/method that initiates AI work.
 */
const AI_ENTRY_POINTS = [
  {
    file: 'packages/editor/src/context.tsx',
    function: 'openCafDialog',
    description: 'Generative Edit dialog',
  },
  {
    file: 'packages/editor/src/context.tsx',
    function: 'openUpscaleDialog',
    description: 'Image upscaling',
  },
  {
    file: 'packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx',
    function: 'startObjectSelection',
    description: 'SAM2 object selection',
  },
  {
    file: 'packages/editor/src/components/Inspector/sections/LensBlurSection.tsx',
    function: 'handleGenerateDepth',
    description: 'Depth map generation',
  },
  {
    file: 'packages/editor/src/components/Settings/SemanticSearchTab.tsx',
    function: 'handleRebuildIndex',
    description: 'Semantic search indexing',
  },
  {
    file: 'packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.tsx',
    function: 'handleDownload',
    description: 'AI model download',
  },
  {
    file: 'packages/editor/src/components/Shell/ExportLayer.tsx',
    function: 'openBatchBgRemove',
    description: 'Batch background removal',
  },
  // TODO: Re-enable after fixing regex to match object method properties with TypeScript type annotations
  // {
  //   file: 'packages/engine/src/backgroundRemoval/providers/cloudProvider.ts',
  //   function: 'isAvailable',
  //   description: 'Cloud background removal provider',
  // },
] as const;

/**
 * Patterns that indicate proper AI gating.
 */
const GATING_PATTERNS = [
  /settings\.ai\.enabled/,
  /checkAiFeaturesEnabled/,
  /getAiFeaturesEnabled/,
  /isCapabilityRestricted\(['"]inference['"]\)/,
  /aiEnabled/, // From useAiFeaturesEnabled hook
  /aiFeaturesEnabled/, // Alternative naming
] as const;

describe('AI Entry Point Gating Audit', () => {
  it('verifies all known AI entry points have gating logic', () => {
    const ungated: Array<{ file: string; function: string; description: string }> = [];

    for (const entryPoint of AI_ENTRY_POINTS) {
      const filePath = join(process.cwd(), entryPoint.file);
      let content: string;

      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        ungated.push(entryPoint);
        continue;
      }

      // Find the function/method in the file
      // Try multiple patterns: arrow function, method, regular function, useCallback
      const patterns = [
        // Object property: functionName: (params) => { ... }
        new RegExp(
          `${entryPoint.function}:\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s{2}\\}`,
          'm',
        ),
        // const functionName = useCallback((params) => { ... }, [deps])
        new RegExp(
          `(?:const|let)\\s+${entryPoint.function}\\s*=\\s*useCallback\\s*\\(\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?(?=\\},\\s*\\[)`,
          'm',
        ),
        // const functionName = (params) => { ... }
        new RegExp(
          `(?:const|let)\\s+${entryPoint.function}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?(?=\\n\\s*(?:const|let|function|export|\\}))`,
          'm',
        ),
        // function functionName(params) { ... }
        new RegExp(
          `(?:async\\s+)?function\\s+${entryPoint.function}[\\s\\S]*?\\{[\\s\\S]*?(?=\\n(?:async\\s+)?function|\\nexport|$)`,
          'm',
        ),
      ];

      let functionBody = '';
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          functionBody = match[0];
          break;
        }
      }

      if (!functionBody) {
        // Function not found - might have been refactored
        ungated.push(entryPoint);
        continue;
      }

      // Check if any gating pattern is present in the function body
      const hasGating = GATING_PATTERNS.some((pattern) => pattern.test(functionBody));

      if (!hasGating) {
        ungated.push(entryPoint);
      }
    }

    if (ungated.length > 0) {
      const report = ungated
        .map((ep) => `  - ${ep.description} (${ep.function} in ${ep.file})`)
        .join('\n');
      throw new Error(
        `Found ${ungated.length} AI entry point(s) without proper gating:\n${report}\n\n` +
          'Each AI entry point must check ai.enabled before executing.\n' +
          'Use checkAiFeaturesEnabled() or getAiFeaturesEnabled() to gate access.',
      );
    }
  });

  it('scans for common AI-related function calls that might need gating', () => {
    // Search for potentially ungated AI calls across the codebase
    const suspiciousCalls = [
      'removeBackground\\(',
      'upscaleSelectedImage\\(',
      'generateDepthMap\\(',
      'traceSelectedImage\\(',
      'sam2.*segment',
      'getInferenceWorkerHost\\(\\)',
      'getModelLoader\\(',
    ];

    const editorSrc = join(process.cwd(), 'packages/editor/src');

    for (const pattern of suspiciousCalls) {
      let matches: string[];
      try {
        const result = execSync(`rg --type ts --type tsx -n "${pattern}" "${editorSrc}" || true`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        matches = result.trim().split('\n').filter(Boolean);
      } catch {
        matches = [];
      }

      // This is informational - we don't fail here because these might be
      // legitimately called from within already-gated contexts
      if (matches.length > 0) {
        console.warn(
          `Info: Found ${matches.length} call(s) to ${pattern}. ` +
            'Verify these are within gated contexts or add explicit checks.',
        );
      }
    }
  });

  it('verifies the gating helper functions exist', () => {
    const helperFile = join(process.cwd(), 'packages/editor/src/features/useAiFeaturesEnabled.ts');
    const content = readFileSync(helperFile, 'utf-8');

    expect(content).toContain('export function useAiFeaturesEnabled');
    expect(content).toContain('export function getAiFeaturesEnabled');
    expect(content).toContain('export function checkAiFeaturesEnabled');
  });

  it('verifies the AI settings toggle exists', () => {
    const settingsFile = join(process.cwd(), 'packages/editor/src/settings.ts');
    const content = readFileSync(settingsFile, 'utf-8');

    expect(content).toContain('ai:');
    expect(content).toContain('enabled:');
  });
});
