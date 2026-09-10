/**
 * intelligenceRegistry — command metadata and fuzzy dispatch for the AI chat
 * assistant, shared by the chat panel and the QuickActionsBar.
 *
 * @varve/ai cannot depend on @varve/editor (would create a workspace
 * dependency cycle back through @varve/editor -> @varve/ai). Commands that
 * only need the scene Document (contrast audit, debt scan) run directly
 * against @varve/scene. Commands that need editor/selection state (rename
 * layers, harmonize spacing) are exposed here as metadata only — the actual
 * behavior is supplied by the caller as a handler callback, keeping the
 * dependency direction one-way (editor -> ai, never ai -> editor).
 */
import { type Document, runDebtScan, runIntelligenceAudit } from '@varve/scene';

export type IntelligenceCategory = 'accessibility' | 'debt' | 'naming' | 'spacing';

export interface IntelligenceCommandMeta {
  id: string;
  label: string;
  category: IntelligenceCategory;
  keywords: string[];
}

export const INTELLIGENCE_COMMANDS: IntelligenceCommandMeta[] = [
  {
    id: 'check-contrast',
    label: 'Check contrast',
    category: 'accessibility',
    keywords: ['contrast', 'accessibility', 'wcag', 'a11y'],
  },
  {
    id: 'scan-debt',
    label: 'Scan for design debt',
    category: 'debt',
    keywords: ['debt', 'scan'],
  },
  {
    id: 'suggest-names',
    label: 'Suggest layer names',
    category: 'naming',
    keywords: ['name layers', 'rename layers', 'suggest names', 'name', 'rename', 'naming'],
  },
  {
    id: 'harmonize-spacing',
    label: 'Harmonize spacing',
    category: 'spacing',
    keywords: ['spacing', 'harmonize'],
  },
];

/**
 * Fuzzy-matches a chat message to the best-scoring command by keyword
 * overlap. Ties break toward the earlier-registered (higher-priority)
 * command, since INTELLIGENCE_COMMANDS is ordered by priority.
 */
export function matchIntelligenceCommand(message: string): IntelligenceCommandMeta | null {
  const lower = message.toLowerCase();
  let best: { cmd: IntelligenceCommandMeta; score: number } | null = null;
  for (const cmd of INTELLIGENCE_COMMANDS) {
    const score = cmd.keywords.filter((k) => lower.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { cmd, score };
    }
  }
  return best?.cmd ?? null;
}

/** Editor-supplied callbacks for commands that need selection/editor state.
 *  Each returns a human-readable summary of what it did. */
export interface IntelligenceDispatchHandlers {
  suggestNames?: () => string;
  harmonizeSpacing?: () => string;
}

export interface IntelligenceDispatchContext {
  document: Document;
  handlers?: IntelligenceDispatchHandlers;
}

export interface IntelligenceDispatchResult {
  id: string;
  label: string;
  summary: string;
}

function summarizeAudit(doc: Document): string {
  const issues = runIntelligenceAudit(doc);
  if (issues.length === 0) return 'No contrast issues found — all text meets WCAG AA.';
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return `Found ${issues.length} contrast issue${issues.length === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}). Open the Audit tab to review and auto-fix.`;
}

function summarizeDebt(doc: Document): string {
  const report = runDebtScan(doc);
  const total = report.issues.length;
  if (total === 0) return 'No design debt found — the document is clean.';
  return `Found ${total} design debt issue${total === 1 ? '' : 's'}: ${report.totalErrors} error${report.totalErrors === 1 ? '' : 's'}, ${report.totalWarnings} warning${report.totalWarnings === 1 ? '' : 's'}, ${report.totalInfo} info. Open the Debt tab to review and auto-fix.`;
}

/**
 * Matches a chat message to a command and runs it. Scene-native commands
 * (contrast, debt) always run for real. Editor-only commands (naming,
 * spacing) run the caller-supplied handler if present, otherwise return a
 * message explaining the command needs the editor's selection/document
 * context (e.g. when called from a context that only has a read-only doc).
 */
export function dispatchIntelligence(
  message: string,
  ctx: IntelligenceDispatchContext,
): IntelligenceDispatchResult | null {
  const cmd = matchIntelligenceCommand(message);
  if (!cmd) return null;

  switch (cmd.id) {
    case 'check-contrast':
      return { id: cmd.id, label: cmd.label, summary: summarizeAudit(ctx.document) };
    case 'scan-debt':
      return { id: cmd.id, label: cmd.label, summary: summarizeDebt(ctx.document) };
    case 'suggest-names': {
      const handler = ctx.handlers?.suggestNames;
      return {
        id: cmd.id,
        label: cmd.label,
        summary: handler
          ? handler()
          : 'Suggest names is only available from the editor (needs a selection).',
      };
    }
    case 'harmonize-spacing': {
      const handler = ctx.handlers?.harmonizeSpacing;
      return {
        id: cmd.id,
        label: cmd.label,
        summary: handler
          ? handler()
          : 'Harmonize spacing is only available from the editor (needs a selection).',
      };
    }
    default:
      return null;
  }
}
