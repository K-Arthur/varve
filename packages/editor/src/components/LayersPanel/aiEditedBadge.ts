/**
 * Helpers for the AI-edited layer badge.
 *
 * Shows a small AI indicator on layers that have been modified by any
 * AI tool (Generative Edit, Background Removal with AI model, etc.).
 * The badge is unobtrusive but visible, with a tooltip explaining which
 * tool and model were used.
 */

import type { Document, NodeId } from '@varve/scene';

export interface AiEditInfo {
  /** Short label for the badge tooltip (e.g. "AI Fill", "AI Remove"). */
  label: string;
  /** Model used (e.g. "LaMa", "PatchMatch", "IS-Net"). */
  model: string;
  /** When the edit was made, as epoch milliseconds. */
  timestamp: number;
  /** Optional: which generative edit mode was used. */
  mode?: 'fill' | 'remove' | 'replace' | 'expand';
}

/**
 * Check if a node has been edited by any AI tool and return edit metadata.
 * Returns null if the node has no AI provenance.
 */
export function getNodeAiEditInfo(doc: Document, nodeId: NodeId): AiEditInfo | null {
  if (!doc.generativeEdits) return null;

  // Find any generative edit that resulted in this node
  for (const edit of Object.values(doc.generativeEdits)) {
    if (edit.resultNodeId === nodeId) {
      const provider = edit.provider;
      const modelName =
        provider.modelId ?? (provider.runtime === 'patchmatch' ? 'PatchMatch' : 'Unknown');

      const modeLabel: Record<typeof edit.mode, string> = {
        fill: 'AI Fill',
        remove: 'AI Remove',
        replace: 'AI Replace',
        expand: 'AI Expand',
      };

      return {
        label: modeLabel[edit.mode] ?? 'AI Edit',
        model: modelName,
        timestamp: edit.updatedAt,
        mode: edit.mode,
      };
    }

    // Also check if this node is the source node with an accepted result
    // (the source may have been modified in place for some operations)
    if (edit.sourceNodeId === nodeId && edit.acceptedVariationId) {
      const provider = edit.provider;
      const modelName =
        provider.modelId ?? (provider.runtime === 'patchmatch' ? 'PatchMatch' : 'Unknown');

      const modeLabel: Record<typeof edit.mode, string> = {
        fill: 'AI Fill',
        remove: 'AI Remove',
        replace: 'AI Replace',
        expand: 'AI Expand',
      };

      return {
        label: modeLabel[edit.mode] ?? 'AI Edit',
        model: modelName,
        timestamp: edit.updatedAt,
        mode: edit.mode,
      };
    }
  }

  // TODO: Check for other AI tools when they land (Background Removal, Upscale, etc.)
  // that persist provenance in a different format

  return null;
}

/**
 * Format a timestamp for display in the tooltip.
 */
export function formatAiEditTimestamp(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    // Use relative time for recent edits
    const now = Date.now();
    const diff = now - timestamp;
    const hours = diff / (1000 * 60 * 60);
    const days = diff / (1000 * 60 * 60 * 24);

    if (hours < 1) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes < 1 ? 'just now' : `${minutes}m ago`;
    }
    if (hours < 24) {
      return `${Math.floor(hours)}h ago`;
    }
    if (days < 7) {
      return `${Math.floor(days)}d ago`;
    }

    // Use absolute date for older edits
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'unknown';
  }
}
