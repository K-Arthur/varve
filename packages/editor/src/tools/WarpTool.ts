/**
 * Warp tool — activates the warp edit surface for the current selection.
 *
 * Behavior:
 *  - Compatible single selection with an existing warp stack: the first
 *    enabled modifier becomes the active edit target (overlay + Inspector).
 *  - Compatible single selection without warps: adds a default envelope
 *    modifier (one undo transaction) and targets it.
 *  - Multi-selection: wraps the selection in a shared warp group (one shared
 *    envelope, not one modifier per child).
 *  - Incompatible selection: announces why warp is unavailable.
 *
 * The heavy interaction (cage/mesh handles) happens in WarpOverlay, not in
 * this tool — mirroring the SelectionOverlay architecture.
 */

import { makeWarpPreset } from '@varve/engine';
import { warpsOnNode, warpUnsupportedReason } from '@varve/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext } from './types';

export class WarpTool extends BaseTool {
  override id = 'warp' as const;

  cursor(): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    super.onActivate?.(ctx);
    // A previous document/selection can have left a transient target behind;
    // Warp activation always establishes a fresh authoritative edit surface.
    ctx.setWarpEdit?.(null);
    if (ctx.selection.length === 0) return;
    const ids = ctx.selection;
    const reasons = ids
      .map((id) => ctx.document.nodes[id])
      .filter(Boolean)
      .map((n) => warpUnsupportedReason(n))
      .filter((r): r is string => r !== null);
    if (reasons.length > 0) {
      if (ctx.announce) ctx.announce(`Warp unavailable: ${reasons[0]}`);
      return;
    }
    if (ids.length > 1) {
      // Shared envelope across the selection (grouped, one undo entry).
      if (typeof ctx.applyWarpToSelection === 'function') {
        ctx.applyWarpToSelection('four-edge');
      }
      return;
    }
    const nodeId = ids[0]!;
    const node = ctx.document.nodes[nodeId];
    if (!node) return;
    const existing = warpsOnNode(node).find((w) => w.enabled !== false);
    if (existing) {
      ctx.setWarpEdit?.({ nodeId, modifierId: existing.id });
      return;
    }
    ctx.beginTransaction();
    try {
      const modifier = makeWarpPreset('four-edge');
      ctx.updateNode(nodeId, (n) => ({ ...n, warps: [...warpsOnNode(n), modifier] }));
      ctx.setWarpEdit?.({ nodeId, modifierId: modifier.id });
    } finally {
      ctx.commitTransaction();
    }
  }

  /**
   * WarpOverlay owns the pointer gesture, but the tool owns the edit surface.
   * Abort first so an uncommitted handle drag cannot survive the tool switch,
   * then clear the target so no cage can outlive Warp mode.
   */
  override onDeactivate(ctx: ToolContext): void {
    ctx.abortTransaction();
    ctx.setWarpEdit?.(null);
  }

  override onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key === 'Escape') {
      ctx.setWarpEdit?.(null);
      ctx.setTool('select');
      return true;
    }
    return false;
  }
}
