# Menubar submenu contract — research ledger (2026-09-15)

Scope: the remaining defects recorded by
`docs/audits/menubar-flyout-dismissal-2026-09-15.md` section 4 — disabled
submenu parents, submenu type-ahead/Home-End, keymap-aware shortcut text, stale
availability, and open flyouts whose parent becomes unavailable.

This ledger distinguishes normative standards, advisory guidance, product
decisions, and repository conventions. The two APG pages are guidance built on
WAI-ARIA 1.2 (normative); they are not a standard in themselves.

## Sources consulted in this session

| # | Source | Date accessed | Relevant finding | Applies to | Decision |
|---|---|---|---|---|---|
| R1 | W3C WAI ARIA APG, "Menu and Menubar Pattern": https://www.w3.org/WAI/ARIA/apg/patterns/menubar/ | 2026-09-15 | Keyboard contract for menus: ArrowUp/Down traverse items; Home/End move to first/last item (with wrapping, Home/End is still the documented first/last route); a printable character moves focus to the next item whose label begins with it; Enter/Space on a parent `menuitem` opens the submenu and focuses its first item; ArrowRight opens a submenu, or moves to the next menubar item when the focused item has no submenu; Escape closes the level and returns focus to the parent/invoking context. Parent items carry `aria-haspopup="menu"` and `aria-expanded`. Note 1: disabled menu items are focusable but cannot be activated. | `menubarKeynav.ts` dropdown + submenu branches | Added Home/End and printable-prefix type-ahead to the submenu so both menu levels behave identically. Kept the repository's documented adaptation for disabled items (DOM `disabled` + skipped by navigation) rather than the APG "focusable disabled" variant — see D2 below. |
| R2 | W3C WAI ARIA APG, "Developing a Keyboard Interface", section "Focusability of disabled controls": https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ | 2026-09-15 | Disabled controls may be removed from the focus order with the HTML `disabled` attribute when their presence is inferable from nearby focusable elements, or kept focusable with `aria-disabled="true"` when discoverability depends on focus. Authors are "encouraged to adopt consistent pattern-based conventions". | `Menubar.tsx` disabled rendering, `menubarFocus.ts` skip-disabled focus effects | The repository already adopted one convention (DOM `disabled` + skip) and documents it in `menubarFocus.ts`. The defect was inconsistency: disabled submenu parents stayed enabled and opened. Fixed by applying the existing convention to them; no convention change. |
| R3 | Same APG page, section "Keyboard Shortcuts" | 2026-09-15 | "The primary means of making functions and their shortcuts discoverable is by making the target elements focusable and revealing key assignments on the element itself." Shortcuts should be localized and must not conflict with OS/AT/browser keys. | Menubar visible shortcut text + `aria-keyshortcuts` | Visible shortcut text now resolves through `getEffectiveBinding(id)` (the same resolver as `aria-keyshortcuts`), so a user remap is shown instead of a key that no longer executes. |
| R4 | Repository convention: `packages/editor/src/menu/menubarFocus.ts` header comment; `docs/architecture/menu-system.md` "Interaction and overlay contract" | 2026-09-15 | Menubar focus effects deliberately "never land on a disabled item — focus() on disabled buttons silently no-ops, stranding focus outside the menu"; `nextEnabledIndex` skips disabled items and wraps. | Disabled-parent guards | Preserved. Disabled items remain skipped, not focusable; guards added so availability is enforced on every activation path (pointer hover/click and Enter/Space/ArrowRight), not just when the item happens to be unreachable. |
| R5 | Repository policy: `AGENTS.md` hub-file import budgets; `.health-baseline.json` | 2026-09-15 | `Menubar.tsx` is limited to 2,891 lines / 22 imports; new work must not grow hub imports. | Implementation | No import added or removed from `Menubar.tsx`; shared helpers are imported by `menubarKeynav.ts` (a leaf module) where needed. |

## Product decisions

- **D1 — one type-ahead implementation.** The submenu reuses
  `@varve/ui/utils/menuTypeAhead` (`shouldTypeAhead`, `matchMenuTypeAhead`,
  `getTypeAheadResetMs`, `isResetKey`) instead of a second matcher. The buffer
  is shared across menu levels and reset whenever a level opens, switches, or
  closes, so a prefix typed in the dropdown cannot leak into a submenu search.
- **D2 — disabled parents follow the repository convention.** They render with
  DOM `disabled` (matching leaf commands), lose hover/click activation, cannot
  be opened with Enter/Space/ArrowRight, and their flyout closes if it is
  already open when availability changes. This is an intentional adaptation of
  APG note 1; it is recorded here rather than silently applied.
- **D3 — availability is data, not a snapshot.** The open flyout is closed by an
  effect when its parent becomes disabled, and the `rawMenus` memo now tracks
  `bleedGuidesVisible`, `document.masters`, the document node count, and the
  active file path so command availability cannot outlive its inputs.
- **D4 — known limitation left open.** The menubar's asynchronous context
  settle (`useMenubarContextEffects`) still force-closes an open menu when
  `activeId`/`workspaceMode` change after opening. The two Playwright failures
  recorded by the predecessor audit reproduce independently of this slice; the
  root cause is documented in the audit and left to the integration owner
  because a safe fix changes menu lifetime semantics, not just the submenu.

## What would count as contrary evidence

- A user report that disabled menu rows should stay focusable for discovery
  would be the trigger to revisit D2 (the APG explicitly allows either
  convention, chosen consistently).
- A remap UX report showing users prefer the default key beside a command
  regardless of their override would revisit R3; nothing in the current product
  suggests that (the keymap editor writes overrides and the shortcut palette
  already shows effective bindings).
