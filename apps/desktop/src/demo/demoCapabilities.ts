/**
 * What the public browser demo does *not* offer, and why.
 *
 * The demo is the real editor, so the honest thing is to withhold the
 * capabilities a browser tab cannot do justice to rather than ship a degraded
 * imitation of them. Three decisions, each grounded in a real limit:
 *
 *  - **On-device inference** (background removal, upscaling, visual search)
 *    costs a ~25 MB ONNX Runtime download before the first result and then
 *    runs a heavy compute job in the tab. It is also the clearest case where
 *    native desktop genuinely wins, so gating it is both kinder and truer.
 *  - **Print production** (PDF, CMYK, bleed, colour-managed output) has no
 *    pipeline to talk to in a browser — `getPrinters()` returns an empty list.
 *    Raster and vector export stay, so a visitor can always take work out.
 *  - **Workspaces** are limited to the three the editor itself calls primary.
 *    Print is broken per the above, Motion needs a frame budget a WASM +
 *    Canvas2D tab cannot hold, and Codegen/Logo/Email are narrow power-user
 *    surfaces that only add confusion to a first impression.
 *
 * Excluding these also removes the ONNX runtime and model payload from the
 * deployed artifact — see `demoAssetPrunePlugin` in vite.config.ts.
 */

import { setCapabilityRestrictions } from '@varve/editor';
import type { DemoConfig } from './demoMode';

/** Workspaces the demo exposes, in the editor's own display order. */
export const DEMO_WORKSPACE_MODES = ['design', 'drawing', 'image'] as const;

/** Apply the demo's restrictions. No-op on every non-demo page load. */
export function applyDemoCapabilities(config: DemoConfig): void {
  if (!config.active) return;
  setCapabilityRestrictions({
    restricted: new Set(['inference', 'printProduction'] as const),
    workspaceModes: [...DEMO_WORKSPACE_MODES],
    upgradeUrl: config.downloadUrl,
  });
}
