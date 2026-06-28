/**
 * @strata/editor — Strata editor UI surfaces (Strata plan §5).
 *
 * The shell, tools, canvas, panels, and shortcut system. Exported `Shell` is
 * the top-level component consumed by apps/web and apps/desktop.
 */

export type { EditorState, ToolId } from './context';
export { EditorProvider, useEditor } from './context';
export { Shell } from './Shell';
