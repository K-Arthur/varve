# ADR-0239: Six task workspaces and ordered shortcuts

*Status: accepted — 2026-09-27*

## Context

The editor had eight runtime modes, although Logo is a Design workflow and
Codegen is an export/panel surface shared by the editor. The mode keys also
skipped numbers and did not follow the visible switcher order. That made the
switcher, menus, key hints, and help disagree about which task environments
Varve actually provides.

Email remains distinct because it combines visual authoring with authored
source blocks, responsive preview, source mapping, and compatibility checks.
The recommendation is architectural; Varve has no reliable workspace usage
data to support a frequency claim. Evidence and failure cases are recorded in
`docs/audits/workspace-customization-research-2026-09-27.md`.

## Decision

The six core workspaces are ordered as follows:

| Key | Workspace | Focus |
|---|---|---|
| `Ctrl+Shift+1` | Design | General visual design, components, prototyping, and Logo workflows |
| `Ctrl+Shift+2` | Print | Multi-page layout and print production |
| `Ctrl+Shift+3` | Draw | Raster painting and freehand drawing |
| `Ctrl+Shift+4` | Photo | Nondestructive photo editing |
| `Ctrl+Shift+5` | Motion | Timeline animation |
| `Ctrl+Shift+6` | Email | Email authoring and compatibility workflows |

On macOS, the modifier is Command: `⌘⇧1` through `⌘⇧6`. The editor
switcher, its overflow menu, arrow-key traversal, View > Workspace, shortcut
help, and marketing workspace descriptions must use this same order.

Logo remains discoverable within Design. `Ctrl+Shift+7` opens Design and
reveals Logo Tools. Code export remains a shared panel and workflow;
`Ctrl+Shift+8` opens it in the current workspace. `Ctrl+Alt+Shift+L` toggles
Logo Tools and switches to Design when opening from another workspace; the
desktop app's `Ctrl+Shift+J` toggles the shared Code panel. Browsers can reserve
`Ctrl+Shift+J`, so the Code show action at `Ctrl+Shift+8` and View menu remain
available. These are actions, not workspace selectors or radio items. The
legacy `workspaceLogo` and
`workspaceCodegen` action identifiers are retained at the action/shortcut
boundary, while legacy `logo` and `codegen` preference keys exist only long
enough to migrate customized arrangements into named layouts.

## Consequences

- Six-mode order is represented once for the runtime switcher and tested
  against the sequential shortcut registry bindings.
- Workspace radio controls remain a six-item set. Logo and Code commands are
  separated from that set in menus, accessibility roles, and documentation.
- Existing Logo and Code customizations migrate as named layouts without
  changing Design preferences or changing workspace on layout application.
- Email authoring remains a dedicated workspace, while compilation and
  preview surfaces share generated results and preserve authored source.
- Future changes to workspace identity or ordering require updating the
  canonical workspace contract and its shortcut, menu, help, website, and
  visual checks together.
