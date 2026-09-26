# Token Sync — multi-source validation audit

- **Date:** 2026-09-25
- **Status:** handed off for independent validation
- **Scope:** multi-source import, source switching, source content editing,
  plus the external-update (three-way merge) slice committed alongside it.

## 1. Commits in scope

| Hash | Subject | Notes |
| --- | --- | --- |
| `78c28571b` | feat(tokens): apply external source updates with a three-way merge | deletion semantics, identity-less path matching, base capture, conflict review UI |
| `426f43650` | feat(editor): switch token sources and edit source content safely | source switcher, source detail preview, validated source editing |
| (in this handoff) | test(e2e): scope token sync assertions + validation audit | the E2E locator fixes in §5.2 and this document land together |

Note: commits referenced by another agent (`a1c592ca0`, `666f46397`,
`a58a1acae`, `aa66a9fe9`) are **not present in this checkout**
(`git cat-file -t <sha>` → MISSING). Validation below describes only what
exists here.

## 2. Where the feature is exposed

| Surface | Location |
| --- | --- |
| Menu | View → Variables and Tokens… (`Menubar.tsx`, action `openVariablesPanel`) |
| Command palette | "Open Variables and Tokens" (category `view`) |
| Host dialog | `VariablesPanelDialog` (title "Variables and tokens") |
| Panel | `TokenSyncPanel` — sources list, source switcher, source detail, import/preview/apply, external updates, source editing, export |

## 3. Scenario → assertion → test

| # | Scenario | Assertions | Test |
| --- | --- | --- | --- |
| 1 | Document created before DTCG support existed | Empty state invites ("a source is created for you"); first import creates the store and a source | E2E `token-sync-import.spec.ts` "a fresh document can import, undo, and redo an import"; component "imports into a fresh document that has no token store at all" |
| 2 | Import multiple sources | Two rows, each with its own file name, `In sync` status, and token count; destination select offers "New source for …" | E2E `token-sync-multi-source.spec.ts` steps 1–2; component "lists every source with its own name and status" |
| 3 | Switch source → selected source previewed | Exactly one token list rendered; its `aria-label` equals `Tokens in <file>`; contents show that source's paths and not the other's | E2E multi-source step 3; component "previews only the selected source when the source is switched" |
| 4 | Edit a source with non-DTCG data | `role="alert"` notice containing "is not a JSON object and cannot be imported" + "nothing was changed"; token rows and source list unchanged | E2E multi-source step 4; component "rejects non-DTCG source content with an error notice and applies nothing" |
| 5 | Actions still work after the rejected edit | Export not `aria-disabled`; Cancel edit clears the editor and the notice; source switching still works | E2E multi-source step 4 tail; component "keeps every other action working after a rejected edit" |
| 6 | External update (three-way) | Re-import reports `1 updated, 1 deleted`; apply changes the document; export proves the edited value and the deletion in bytes | E2E `token-sync-update.spec.ts` "a re-import applies upstream edits and deletions as one update" |
| 7 | No-op must not announce success | Match reported as "matches this document"; Apply disabled | E2E `token-sync-update.spec.ts` "an unchanged re-import reports a no-op instead of success" |
| 8 | Conflict requires a decision | Apply `aria-disabled` until a choice is made; resolution applies the chosen side | component "requires an explicit decision for a concurrent edit" |

## 4. Commands to validate

```bash
# Unit/component (fast)
npx vitest run packages/editor/src/components/TokenSync packages/editor/src/tokenSync \
  packages/scene/src/tokens packages/tokens

# E2E — ALWAYS wrap in the heavy lease, one worker
node scripts/quality/heavy-lease.mjs "e2e: token sync validation" -- \
  npx playwright test \
    tests/e2e/inspector/token-sync-import.spec.ts \
    tests/e2e/inspector/token-sync-update.spec.ts \
    tests/e2e/inspector/token-sync-multi-source.spec.ts \
    --project=chromium --workers=1 --reporter=list

# Types + lint on the touched scope
pnpm --filter @varve/editor exec tsc -p tsconfig.json --noEmit
pnpm typecheck:e2e
pnpm exec biome check packages/editor/src/components/TokenSync packages/editor/src/tokenSync

# Audits
pnpm audit:docs && pnpm audit:emoji && pnpm audit:tokens

# Website page
pnpm --filter @varve/website exec astro check
pnpm --filter @varve/website exec astro build
```

Expected: 54 unit/component tests in the token scope, 7 E2E tests across
the three specs, 0 audit violations (subject to §5).

## 5. Known issues at handoff

1. **`pnpm audit:docs` is red from another agent's uncommitted edits** —
   `docs/architecture/canvas2d-system.md` and `render-pipeline.md` link to
   `docs/audits/canvas-fluidity-2026-09-25.md`, which does not exist yet.
   Not my change; it blocked the docs/website commit. Once that file lands,
   the pending docs+website commit can go in unchanged.
2. **Two E2E defects were mine; both are fixed in this handoff:**
   - `token-sync-import.spec.ts` asserted the source name unscoped; the new
     source menu and detail panel repeat it (3 matches → strict-mode
     violation). Now scoped to the source row.
   - `token-sync-multi-source.spec.ts` used `getByLabel('Tokens in …')`,
     which substring-matches both possible list labels. Now scopes by
     `.token-sync-panel__tokens` and asserts its `aria-label`.
   Re-run after both fixes: **7/7 passed** across the three token-sync specs.
3. **Chromium "Target crashed" under load** — observed once on the import
   spec while another session held the machine. Documented contention class
   (`AGENTS.md`), not a product defect; it passed on rerun.
4. **Visual inspection tooling** — this session's image-read path served
   stale bytes for previously-read files; screenshots were verified with a
   text renderer (`identify` + ASCII downsample) and re-read from fresh
   paths. Worth a second human look at
   `docs/screenshots/design-tokens-page/`.

## 6. Status per lane

| Lane | Status |
| --- | --- |
| Implemented | source switcher, source detail preview, source content editing + validation, three-way update, conflict review, scoped export |
| Automated pass | 54 unit/component; E2E 7/7 across the three token-sync specs (confirmed after the §5.2 fixes) |
| Visually inspected | website feature page (desktop 1440, narrow 390, hero/capabilities/matrix); token-sync E2E screenshots |
| Native-verified | not run (browser lane only) |
| Deferred | live file watching, Git-backed sources, vendor adapters, bulk conflict resolution |
