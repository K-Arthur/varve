/**
 * Workspace onboarding tips as Did-You-Know tips.
 *
 * Every workspace declares `onboarding.tips` — four authored, workspace-
 * specific hints each ("Use Frame (F) to create artboards…", "Switch to
 * Prototype mode…"). Until now nothing read that field: `WorkspaceConfig`
 * carried roughly 28 authored tips across the eight built-in workspaces and
 * the user was never shown any of them, while the Did-You-Know surface drew
 * only from the global, workspace-blind `TIPS` list. That is the same
 * decorative-config problem workspace invariant 9 exists to prevent.
 *
 * Rather than build a second tip surface, workspace tips are adapted into the
 * existing `Tip` shape and merged into the same queue, so they inherit the
 * daily cap, the idle trigger, dismissal, and "don't show again" for free.
 * A workspace tip is eligible only while its workspace is active — that is
 * the whole point of it being workspace-specific — so the gating happens at
 * selection time rather than through a `condition`.
 */

import {
  getWorkspaceConfig,
  WORKSPACE_LABELS,
  type WorkspaceMode,
} from '../../workspace/workspaceTypes';
import type { Tip } from './tips';

/**
 * FNV-1a over the tip text.
 *
 * Tip ids must be stable across sessions or the dismissed-tip set stops
 * matching. Indexing into the array would be simpler, but then inserting a
 * tip in the middle silently reassigns every later tip's dismissal. Hashing
 * the content keeps a tip's identity across reordering, and deliberately
 * changes it when the text is rewritten — a materially different tip should
 * be allowed to surface again.
 */
function tipHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Stable id for a workspace tip. Exported for tests and diagnostics. */
export function workspaceTipId(mode: WorkspaceMode, text: string): string {
  return `workspace:${mode}:${tipHash(text)}`;
}

/**
 * The active workspace's declared onboarding tips, as Did-You-Know tips.
 *
 * Returns an empty list for a workspace that declares none, and for an
 * unknown mode — `getWorkspaceConfig` falls back to Design, so a stale
 * persisted mode shows Design's tips rather than throwing.
 */
export function workspaceTips(mode: WorkspaceMode): Tip[] {
  const declared = getWorkspaceConfig(mode).onboarding.tips ?? [];
  const seen = new Set<string>();
  const tips: Tip[] = [];
  for (const body of declared) {
    const text = body.trim();
    if (text.length === 0) continue;
    const id = workspaceTipId(mode, text);
    // Two identical strings in one workspace would otherwise produce one id
    // twice, and dismissing one would silently dismiss both.
    if (seen.has(id)) continue;
    seen.add(id);
    tips.push({
      id,
      title: `${WORKSPACE_LABELS[mode] ?? 'Workspace'} workspace`,
      body: text,
      category: 'panels',
    });
  }
  return tips;
}
