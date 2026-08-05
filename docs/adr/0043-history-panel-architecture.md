# ADR-0043: History panel architecture

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0019, ADR-0023, ADR-0044

## Context

There is no panel registry; panels are statically composed in `Shell.tsx`
with per-workspace visibility (`workspace/workspaceTypes.ts:40-60`). The
History panel must be a first-class registered panel, not a block inside the
shell.

## Alternatives

1. A bespoke always-visible sidebar — violates workspace config and
   persistence patterns.
2. A full detachable window framework first — out of scope; no such
   architecture exists.
3. A workspace-integrated panel following the established 6-step recipe
   (chosen): context state + toggle → `actions/registerAll.ts` →
   `SHORTCUT_DEFS` → `menu/defs.ts` + `localization.ts` → Shell composition →
   `PanelId`/`PanelConfig` per-mode table.

## Decision

`HistoryPanel` is a `PanelId`-registered panel (visible by default in design
mode, toggleable everywhere), with **focused modes** instead of one
unstructured list: Steps, Checkpoints, Branches, Compare, Merge conflicts,
Recovery/integrity. The step list reuses the proven virtualization recipe
(`useFlatTree`-style structural diffing + `@tanstack/react-virtual`,
`LayersTree.tsx:522-532`) with `aria-setsize` rows and lazy, bounded
thumbnails. Rows show: action label, icon, actor/origin, timestamp
(metadata), affected-object count, current-head marker, saved-state marker,
checkpoint marker, branch-head markers, Git-reference marker where known,
warning indicator; expansion reveals atomic operations and affected entities.
Interactions: navigate, preview (isolated, ADR-0044), revert, move working
head, branch from revision, checkpoint create/rename/pin, compare, merge,
copy id, show affected objects, filter/search, open conflict resolver,
integrity warnings. Distinct language for Preview/Restore/Revert/Checkout/
Branch/Merge. Dirty-state navigation shows explicit options (checkpoint,
branch, stash-to-recovery, discard-with-confirmation, cancel) — never a
silent overwrite. Large histories: virtualization, collapsing repetitive
sections, clustering autosave/recovery revisions, incremental range loading,
text/tree alternative for screen readers.

## Consequences

- **Migration impact:** none; new panel.
- **Backward compatibility:** panel visibility persists via existing
  settings stores.
- **Cross-platform/Performance:** virtualization bounds rendering; hidden
  panels don't render previews.
- **Security:** n/a.
- **Accessibility:** keyboard-complete workflow (open/focus, prev/next,
  preview, return to current, checkpoint, branch, compare, revert, switch,
  resolver open), screen-reader announcements, visible focus, focus
  restoration, 200 % zoom, reduced motion.
- **Rejected shortcuts:** appending a big History block into Shell.tsx;
  unbounded row rendering; mutating live state on hover.
