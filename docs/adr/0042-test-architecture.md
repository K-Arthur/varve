# ADR-0042: Test architecture

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Existing coverage: Vitest/RTL (jsdom), Playwright (web target),
WDIO/Tauri service (real debug binary, `wdio.conf.ts`), axe in E2E,
`fast-check` 4.9 available, per-package parity tests
(`__tests__/parity.test.ts` runs memory vs web backends).
Multi-window testing needs: multiple windows by label, monitor
simulation, reload, arbitrary close order, focus, IPC observation,
restart recovery.

## Alternatives

1. Rely only on WDIO native tests — too slow/expensive for every commit.
2. A layered pyramid: pure model/protocol tests → React tests → Playwright
   browser tests → WDIO native workflows (chosen).

## Decision

- **L1 — pure (fast, no DOM):** dock ops with fast-check property tests
  (invariants from ADR-0021); protocol envelope validation, revision/gap
  arithmetic, coalescing, sequence/duplicate/stale logic (ADR-0023/0024);
  transfer state machine with failure injection at every transition
  (ADR-0029); monitor matching and placement math with fixture topologies
  (negative coordinates, mixed DPI, rotation, missing primary,
  Wayland-denied placement, ADR-0033); layout schema validation and
  migration (ADR-0032); security fuzz (malformed layouts, envelopes,
  geometry, panel-local state — `fast-check`).
- **L2 — React:** panel chrome, detach/reattach/move menus, disabled-state
  reasons, transfer progress/failure UI, workspace manager, monitor map,
  missing-monitor warnings, empty auxiliary window, recovery banner,
  keyboard commands, screen-reader announcements (mock broker + memory
  window service).
- **L3 — Playwright (browser fallback):** single-window dock groups,
  save/restore logical layout, reload, desktop-capability explanation,
  panel focus mode, reset layout (ADR-0034).
- **L4 — WDIO native:** the ten workflows from the program spec
  (detach/reattach; multiple panels one window; missing monitor;
  auxiliary reload; transfer failure; focus/shortcuts; document
  switching; crash recovery; cross-platform geometry; multimodal
  proposal) — driving the real debug binary with `tauri:options`
  and window-label addressing; monitor fixtures via WDIO-driven config
  where the harness supports it, otherwise documented manual fixtures.
- **Contract tests:** the same `NativeWindowService` test suite runs
  against memory, browser, and (where practical) Tauri implementations
  (ADR-0022) — no silent no-ops, correct capability reporting.
- **Baselines:** pre-refactor tests committed first (M1) pin
  single-window panel/visibility/width/multi-doc/undo/selection behavior;
  regressions in those contracts block later milestones.
- Every milestone commits its focused tests with the code (TDD-first);
  the full gate (`pnpm format && typecheck && lint && test`, audits) runs
  before each commit.

## Consequences

- Multi-window behavior is testable without a display server in L1–L3;
  L4 proves native reality on each OS.
- Security claims (ADR-0040) are backed by fuzz tests, not review alone.

## Migration impact

None; new test layers.

## Cross-platform implications

L4 runs per-OS in CI (Linux primary, Windows/macOS scheduled); Wayland
behavior is documented honestly where the harness cannot enforce
placement.

## Security implications

Fuzz suites treat every cross-window input as untrusted; malformed data
must never create windows or invoke commands (asserted).

## Accessibility implications

L2/L3 run axe (`@axe-core/playwright`) plus keyboard-only workflows;
WCAG 2.2 AA gate per window type.

## Performance implications

L1/L2 stay seconds; L4 is a separate nightly/manual gate;
performance budgets (ADR-0038) have their own bench suite
(`.bench.ts`, run separately per AGENTS.md).

## Rejected shortcuts

WDIO-only testing (too slow); browser-only multi-window claims;
mocking native windows without a contract suite; property tests without
invariant assertions.
