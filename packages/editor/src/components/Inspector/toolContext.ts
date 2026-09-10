/**
 * Tool context — where the active tool's own settings live while nothing is
 * selected.
 *
 * The Inspector and the floating Tool Options popover both read this map, so
 * neither surface can point at controls the other does not render:
 *
 * - `inspector`: the tool owns compact, persistent choices that the Inspector
 *   composes in place of object properties (Frame presets).
 * - `tool-options`: the tool's settings open beside the toolbar (brush,
 *   marquee, magic wand, text defaults, crop). The Inspector names the tool
 *   and offers a button that opens that popover.
 * - `null`: the tool has no settings of its own (shapes, pen, navigation,
 *   Page). The Inspector shows the page/canvas/document settings instead of a
 *   dead-end message; Page's print overrides live at the top of those.
 */
import type { ToolId } from '../../tools/types';

export type ToolContextSurface = 'inspector' | 'tool-options';

const INSPECTOR_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['frame']);

const TOOL_OPTIONS_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'paint',
  'eraser',
  'pencil',
  'smudge',
  'marquee',
  'ellipseMarquee',
  'pixelLasso',
  'magicWand',
  'text',
  'crop',
]);

export function toolContextSurface(tool: ToolId): ToolContextSurface | null {
  if (INSPECTOR_TOOLS.has(tool)) return 'inspector';
  if (TOOL_OPTIONS_TOOLS.has(tool)) return 'tool-options';
  return null;
}

/** True when the floating Tool Options popover has content for this tool. */
export function hasToolOptions(tool: ToolId): boolean {
  return TOOL_OPTIONS_TOOLS.has(tool);
}
