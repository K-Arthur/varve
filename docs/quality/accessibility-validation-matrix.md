# Accessibility Validation Matrix

**Status:** Current test and manual-validation contract  
**Last reviewed:** 2026-09-09

This matrix keeps automated evidence, browser interaction checks, and
platform assistive-technology work separate. A passing automated test covers
the named path only; it is not a certification of the whole editor or of
user-authored output.

## Website evidence

| Area | Automated coverage | Boundary |
|---|---|---|
| Landmarks, names, roles, and contrast | `apps/website/tests/e2e/axe.spec.ts`, `visibility.spec.ts` | Computed DOM and axe coverage does not test a native screen reader. |
| Navigation, menus, and focus restoration | `apps/website/tests/e2e/navigation.spec.ts` | Representative routes and menu states only. |
| Reflow and text enlargement | `apps/website/tests/e2e/reflow.spec.ts`, `visibility.spec.ts` | Representative routes at 320–1920 CSS px and a deterministic 200% text-size fixture; localization and RTL remain separate work. |
| Touch target and reduced-motion behavior | `apps/website/tests/e2e/touch-targets.spec.ts`, route-level visual tests | Emulated pointer/media conditions are not physical-device evidence. |
| Trust and export guidance | `/accessibility` and `/docs/tools/export` route, SEO, asset, visual, and build checks | Copy and structure are tested; user comprehension requires research. |

## Editor browser evidence

| Workflow | Evidence |
|---|---|
| Major-region Tab and Shift+Tab order; no positive `tabindex`; canvas exit | `tests/e2e/a11y/focus-order.spec.ts` |
| Responsive Layers, Inspector, and Resources drawers; containment, Escape, and trigger restoration | `tests/e2e/a11y/responsive-panels.spec.ts` |
| Canvas accessible name, object labels, minimap scope, and selection alternatives | `tests/e2e/canvas/name-labels.spec.ts` |
| Canvas keyboard zoom, numpad behavior, wheel pan, and focal-point zoom | `tests/e2e/canvas/input-navigation.spec.ts` |
| Tool-family discoverability and workspace-specific availability | `tests/e2e/canvas/toolbar-layout.spec.ts`, `toolbar-per-mode.spec.ts`, `workspace-mode.spec.ts`, `drawing-mode-focus.spec.ts` |
| Audit/status surface and a real contrast remediation workflow | `tests/e2e/canvas/design-mode-audit.spec.ts` |
| History panel semantic scans | `tests/e2e/canvas/history-panel-a11y.spec.ts` |

The remaining editor inventory is intentionally explicit: every tool family,
status message, canvas alternative, zoom/overflow combination, and native
window must still be exercised in the supported platform assistive technology
matrix before a regulated or procurement claim.

## Manual assistive-technology pass

Run the same task script on the supported desktop/browser combinations and on
representative mobile hardware before making an external conformance claim.
Record the screen reader, browser/OS version, viewport or display scaling,
input device, route/document fixture, observed announcement, and result.

1. Open a blank document, locate the menubar, toolbar, layers tree, canvas,
   inspector, and status region using only the keyboard.
2. Create, name, select, hide, lock, reorder, and delete a shape from the
   layers tree. Confirm the selected object and operation result are
   announced without duplicate or stale messages.
3. Focus the canvas and use the documented keyboard alternatives for tool
   selection, zoom, pan, selection, and cancellation. Confirm the canvas has
   a usable name and the current tool/selection state is understandable.
4. Open and close a menu, popover, dialog, and each responsive drawer. Confirm
   focus is contained while open, Escape closes the transient surface, and
   focus returns to the initiating control.
5. Switch representative workspaces and open a status/preflight surface.
   Confirm unavailable controls are not reachable and status changes are
   announced at the appropriate urgency.
6. Open a representative export workflow. Verify the final output using the
   format-specific checklist in
   [`output-accessibility-guidance.md`](../architecture/output-accessibility-guidance.md).

Current status: Linux Chromium automation is available and covered by the
listed specs. Native Orca, NVDA, VoiceOver, TalkBack, physical iOS/Android,
and user research sessions were not run for the 2026-09-09 audit follow-up.
