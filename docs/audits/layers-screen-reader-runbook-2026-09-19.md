# Layers Panel — Screen-Reader Session Runbook (2026-09-19)

Status: **not yet executed**. No physical assistive-technology session
(NVDA / Orca / VoiceOver) has been run against the Layers panel; every
synthetic check (axe, keyboard E2E, `ariaSnapshot`) is recorded in
`docs/audits/layers-panel-audit-2026-09-19.md` and the workspace-evolution
report. This runbook is the executable script for that session, so the
remaining gap is a scheduled human task rather than an undocumented unknown.

Scope: shared hierarchy semantics after the workspace-aware evolution and the
Layer Details milestone (merged row: drag, disclosure, type icon, name,
badges, details trigger, visibility, lock, solo).

## Prerequisites

- A desktop build (`just dev` or a packaged build) — browser-only runs lose
  the native close lifecycle and some drag behaviour.
- The AT under test, on its native platform:
  - Orca (Linux, primary for this repository's dev OS)
  - NVDA (Windows)
  - VoiceOver (macOS; also exercise Safari/WebKit behaviour differences)
- Settings: default density, default theme, layers panel at its default width.
- A document containing: nested groups ≥ 3 levels, a hidden parent, a locked
  parent, a masked group, a component instance, a text-threaded frame, and an
  image-filled shape (import `tests/e2e/fixtures/layers-mobile-app.svg` plus
  `real-life-still-life.jpg` to get most of these).

## Script

Record PASS/FAIL and the announced string for each step. A step fails if the
AT announces nothing, announces the wrong state, or the state cannot be
changed with the keyboard alone.

1. **Reach the tree.** Tab from the shell until focus lands in the Layers
   tree. Expect a `tree` announcement with its name, a multi-select hint if
   the AT provides one, and the focused row's name and state.
2. **Walk the hierarchy.** Down/Up through rows; Right expands then enters;
   Left collapses then returns to the parent. Expect each row's name, its
   level, position (`x of y` where the AT exposes it), and selection state.
3. **State is spoken, not implied.** Select a hidden-by-ancestor row (child
   of a hidden group) and a directly hidden row; expect distinct
   announcements ("hidden" vs "hidden by <ancestor>"). Repeat for lock.
4. **Rename.** F2 on a focused row, type a new name, Enter. Expect the new
   name on the same row, focus still in the tree, and no announcement storm.
5. **Visibility and lock.** With the row focused, use the context menu
   (Shift+F10) → Hide/Show and Lock/Unlock. Expect the state change to be
   announced (menu item label changes and the row state is re-spoken on
   return).
6. **Non-drag move.** Ctrl+`]` and Ctrl+`[` move the row; Ctrl+Alt+`]` /
   `Ctrl+Alt+[` indent/outdent. Expect the announcement to name the moved
   layer and its neighbor ("Moved X above Y"). Confirm undo restores it.
7. **Filter and act on results.** Type in the filter field; expect the count
   ("N of M layers") and that ancestry stays visible. Use "Select matches"
   and expect the selection count announcement.
8. **Workspace switch.** Switch to Photo (`Ctrl+Shift+4`) and back with a row
   selected, a branch expanded, and a filter active. Expect no remount, no
   lost selection/expansion, and the workspace-filter chips announced as
   toggle buttons with their pressed state.
9. **Details disclosure.** Tab to a row's details button (or focus the row and
   use the context menu → Details where available). Expect the popover to
   open with a name, the closed state announced on Escape, and focus returned
   to the row.
10. **No keyboard traps.** From the tree, Tab leaves forward to the next
    region and Shift+Tab returns; Escape while renaming cancels the rename
    and does not exit isolation.

## Recording

File the result as a dated section appended to
`docs/audits/layers-panel-audit-2026-09-19.md`:

```text
AT: <Orca 46 / NVDA 2026.x / VoiceOver 15.x>
Platform: <Linux/Windows/macOS + version>
Build: <commit SHA>
Steps 1-10: <PASS/FAIL per step, announced-string notes for failures>
Follow-ups: <issue links or "none">
```

Until that section exists, no repository document may claim a physical
screen-reader validation for the Layers panel.
