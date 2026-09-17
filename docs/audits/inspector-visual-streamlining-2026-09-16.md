# Inspector visual streamlining — 2026-09-16

## Scope

This slice reduces presentation redundancy across the registry-backed Inspector
sections. It does not alter section availability, document state, commands,
selection semantics, or persisted identifiers.

## Finding

`DisclosureSection` gave every section its own padded rounded card. On a normal
selection this repeated the same border, surface, and corner treatment through
the entire right rail. The repetition made sections look like independent
dialogs and competed with the selected object's header, while the section
manager and collapse affordances already provided the structural hierarchy.

## Decision

**Streamline, not remove.** Sections now share the Inspector surface and use a
single token-backed bottom separator. Headers remain sticky, keyboard-focusable
`h3 > button` disclosures; expanded content remains mounted only while open;
actions remain beside the trigger. Field-level grouping and focus states are
unchanged.

This is intentionally a host-level change rather than per-section CSS. It gives
all current and future registry sections one visual contract and avoids adding
near-identical variants to dozens of section components.

## Evidence and research basis

The existing Inspector organization audit identified the panel as a long,
manual composition hub and the disclosure architecture explicitly warned
against nested cards (`docs/audits/inspector-organization-audit-2026-08-30.md`,
sections 1 and 6; `docs/architecture/disclosure-system.md`, sizing/spacing).
The paint research also records the failure mode of hiding frequent controls
behind extra clicks. This change therefore removes visual chrome only; it does
not move paint, geometry, typography, or advanced controls behind another
interaction.

## Validation target

- Verify normal shape, mixed selection, document context, and a specialist
  section in Chromium.
- Verify section collapse, focus restoration, section-manager recovery, and
  narrow Inspector layout remain functional.
- Run the affected plan after this slice; the pre-existing dirty worktree is
  recorded separately rather than bundled into this change.
