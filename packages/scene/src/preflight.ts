/**
 * Combined preflight — merges print-production checks (bleed, colour,
 * resolution, page size) with typography checks (missing fonts, broken
 * text chains, overset text) into a single result for the Print Mode
 * preflight panel.
 *
 * Also reports, per check category, whether it was actually evaluated
 * ("verified") or skipped for lack of external data such as an installed-
 * font registry or live text-layout measurements ("unavailable"). A
 * document with zero issues from unavailable checks is NOT the same as a
 * document verified clean — the panel must show both.
 */

import type { Document } from './document';
import { type PrintPreflightIssue, runPrintPreflight } from './printPreflight';
import { runTypographyPreflight, type TypographyIssue } from './typographyPreflight';

export type CombinedPreflightSeverity = 'error' | 'warning' | 'info';

export interface CombinedPreflightIssue {
  source: 'print' | 'typography';
  severity: CombinedPreflightSeverity;
  category: string;
  message: string;
  nodeId?: string;
}

export type PreflightCheckId =
  | 'bleed'
  | 'color-profile'
  | 'resolution'
  | 'oversize'
  | 'rgb-in-cmyk'
  | 'missing-font'
  | 'broken-chain'
  | 'overset-text'
  | 'safe-area'
  | 'tac';

export interface PreflightCheckStatus {
  id: PreflightCheckId;
  label: string;
  status: 'verified' | 'unavailable';
  /** Present when status is 'unavailable': why the check could not run. */
  reason?: string;
}

export interface CombinedPreflightResult {
  issues: CombinedPreflightIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** True when errorCount === 0 among verified checks. */
  ready: boolean;
  checks: PreflightCheckStatus[];
}

export interface CombinedPreflightOptions {
  /** Installed/available font family names, e.g. from the app's FontRegistry. */
  availableFonts?: Set<string>;
}

export function runCombinedPreflight(
  doc: Document,
  options: CombinedPreflightOptions = {},
): CombinedPreflightResult {
  const requiredColorMode = doc.colorConfig?.mode === 'cmyk' ? 'cmyk' : undefined;
  const fontsAvailable = !!options.availableFonts && options.availableFonts.size > 0;

  // v2.18 (ADR-0159): stories are authoritative for migrated documents;
  // legacy chains remain readable for pre-2.18 documents.
  const stories = doc.stories;
  const textChains = doc.textChains as Record<string, import('./typography').TextChain> | undefined;
  const chains = textChains
    ? new Map(Object.entries(textChains).filter((entry) => !!entry[1]))
    : undefined;

  const printResult = runPrintPreflight(doc, { requiredColorMode });
  const typographyResult = runTypographyPreflight(doc, {
    availableFonts: options.availableFonts,
    chains,
    stories,
  });

  const issues: CombinedPreflightIssue[] = [
    ...printResult.issues.map(normalizePrintIssue),
    // Font-availability data wasn't supplied: every text node would otherwise
    // appear "missing" against an empty font set. Surface that as an
    // unavailable check (below) instead of a wall of false positives.
    ...typographyResult.issues
      .filter((i) => fontsAvailable || i.category !== 'missing-font')
      .map(normalizeTypographyIssue),
  ];

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const checks: PreflightCheckStatus[] = [
    { id: 'bleed', label: 'Bleed', status: 'verified' },
    { id: 'color-profile', label: 'Colour profile', status: 'verified' },
    { id: 'resolution', label: 'Image resolution', status: 'verified' },
    { id: 'oversize', label: 'Page size', status: 'verified' },
    {
      id: 'rgb-in-cmyk',
      label: 'RGB content in CMYK output',
      status: requiredColorMode === 'cmyk' ? 'verified' : 'unavailable',
      reason:
        requiredColorMode === 'cmyk' ? undefined : 'Document is not configured for CMYK output.',
    },
    {
      id: 'missing-font',
      label: 'Missing fonts',
      status: fontsAvailable ? 'verified' : 'unavailable',
      reason: fontsAvailable ? undefined : 'No installed-font registry data was supplied.',
    },
    { id: 'broken-chain', label: 'Broken text chains', status: 'verified' },
    {
      id: 'overset-text',
      label: 'Overset text',
      status: 'unavailable',
      reason: 'Live text-layout measurement is not yet connected to preflight.',
    },
    {
      id: 'safe-area',
      label: 'Printable-area violations',
      status: 'unavailable',
      reason: 'Per-node safe-area geometry checking is not yet implemented.',
    },
    {
      id: 'tac',
      label: 'Total Area Coverage',
      status: requiredColorMode === 'cmyk' ? 'verified' : 'unavailable',
      reason: requiredColorMode === 'cmyk' ? undefined : 'TAC is only relevant for CMYK documents.',
    },
  ];

  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    ready: errorCount === 0,
    checks,
  };
}

function normalizePrintIssue(issue: PrintPreflightIssue): CombinedPreflightIssue {
  return {
    source: 'print',
    severity: issue.severity,
    category: issue.category,
    message: issue.message,
    nodeId: issue.nodeId,
  };
}

function normalizeTypographyIssue(issue: TypographyIssue): CombinedPreflightIssue {
  return {
    source: 'typography',
    severity: issue.severity,
    category: issue.category,
    message: issue.message,
    nodeId: issue.nodeId ?? issue.frameId,
  };
}
