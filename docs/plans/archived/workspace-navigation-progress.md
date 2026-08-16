# Workspace Navigation — progress tracker

Companion to `docs/architecture/workspace-navigation.md` (current state and
decisions). Milestones landed 2026-08-05.

## Landed

- [x] Audit + current-state map (state owner / UI / input / persistence /
      tests / gaps per surface) — architecture doc §1.
- [x] Hypothesis verification (10/10) — architecture doc §1.
- [x] Unified navigation model: `NavigationTarget` / `NavigationRequest` /
      `NavigationResult` / coordinator (`packages/editor/src/navigation/`).
- [x] Typed deep links (`varve://navigate/…`) + legacy `finding:` /
      `?finding=` compat; web + Tauri listener teardown; parked-link
      timeout/cancellation; cross-document open-or-cancel via platform.
- [x] Findings registry (`audit/findingsRegistry.ts`) + IntelligencePanel
      publishes scan results; finding deep links resolve.
- [x] Effective workspace configuration: store live (`workspaceStore.ts`),
      toggles record overrides, switch applies the full projection
      (panels + overlays + default tool), reset clears overrides.
- [x] Shell consumes effective config for status bar / tab strip /
      page-nav / preferred panel widths (no hard-coded conditions).
- [x] Workspace switcher: complete APG radiogroup contract (roving
      tabindex, arrows, Home/End, Enter/Space, overflow focus restore).
- [x] Document tabs: Save / Don't save / Cancel dirty-close flow
      (background-tab save activates first; failed save keeps the doc).
- [x] Unsaved-change protection: tool-created shapes/text now mark the
      document and session dirty (createShapeAt/createTextNodeAt), with a
      state.dirty fallback in closeTab and the tab dirty dot.
- [x] Minimap: fit-all = document bounds (double-click/Enter/Space/Home);
      aria-label matches behavior.
- [x] Side buttons 3/4 → selection history (pure classifier + pipeline).
- [x] Workspace mode is application-global — decision locked by test.
- [x] Tests: unit + component for all of the above (see architecture doc §7).
- [x] Docs: architecture doc + this tracker.

## Deferred (reasons in architecture doc §9)

- [ ] Viewport back/forward history (side buttons use selection history).
- [ ] Toolbar composition driven by `WorkspaceConfig.toolbar`.
- [ ] Panel collapse/ordering state engine.
- [ ] Persist open tabs across restart.
- [ ] Page rename + delete confirmation UI.
- [ ] `tauri-plugin-deep-link` registration in `tauri.conf.json`.
- [ ] Remove deprecated `shortcuts.extra` / `performance` config fields.
