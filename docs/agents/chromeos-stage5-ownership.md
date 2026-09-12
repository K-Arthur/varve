# ChromeOS Stage 5 ownership record

**Task:** `chromeos-stage5-2026-09-12`
**Coordinator:** opencode (release engineering session)
**Started:** 2026-09-12
**Updated:** 2026-09-12
**Base SHA:** `4d8e85aabb9ddfb768bc7d9974fd19499bfa18da`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`

## Scope owned by this task

Stage 5 of the ChromeOS program — Linux ARM64 compatibility, packaging, and
installation (the task decomposition requested in this session, distinct from
the Stage 1 document's staged plan). Specifically:

- ARM64 artifact evidence: checksum verification against published
  `SHA256SUMS.txt`, `dpkg` control metadata, ELF architecture, glibc symbol
  floor, dependency closure on arm64-only Debian 12/13 models.
- AppImage payload audit and the resource-preservation defect found there.
- User-facing ChromeOS Linux installation/update/uninstall contract, backed by
  the verified v0.2.1 artifact names and checksums.
- Marketing-website changes for the ChromeOS Linux route: download guidance,
  getting-started link, troubleshooting entry, and a dedicated guide page.
- Support-matrix wording at the evidence level actually reached. ChromeOS
  Linux ARM64 stays a separate route from generic Linux ARM64.

The task does **not** claim Duet hardware validation. No Duet is attached to
this session; the device checklist in the Stage 5 audit is the handoff.

## Files owned (one writer at a time)

| Path | Purpose |
|---|---|
| `docs/agents/chromeos-stage5-ownership.md` | This record |
| `docs/audits/chromeos-stage5-linux-arm64-2026-09-12.md` | Research ledger, artifact evidence, simulations, remaining gaps |
| `docs/release/chromeos-linux.md` | Canonical installation/update/uninstall guide |
| `docs/release/platform-support-matrix.md` | Evidence-tier wording for the ChromeOS/Linux ARM64 rows |
| `docs/release/README.md` | Docs index entry for the new guide |
| `scripts/release/prune-appimage-bundled-libs.mjs` | AppImage resource-preservation fix |
| `scripts/release/prune-appimage-bundled-libs.test.mjs` | Regression test for the prune plan |
| `package.json` | One entry added to `test:ci:tools` for the new test only |
| `apps/website/src/pages/docs/chromeos-linux.astro` | New user guide page |
| `apps/website/src/pages/docs/getting-started.astro` | Link to the ChromeOS guide |
| `apps/website/src/pages/download.astro` | ChromeOS row/notes in Linux guidance |
| `apps/website/src/pages/support/troubleshooting.astro` | ChromeOS Linux troubleshooting entries |

## Shared interfaces and single-writer surfaces

| Surface | Stage 5 contract |
|---|---|
| Release artifact names/checksums | Documentation reads published v0.2.1 metadata; no release is created or modified |
| Tauri bundle configuration | Read-only in Stage 5; the AppImage fix is post-bundle, not a bundler config change |
| `package.json` | One test-list entry only; no dependency or script changes |
| Website release manifest | Read-only; website copy derives from the committed generated manifest |
| Renderer/input/editor source | Not touched — no Chromebook-only mode is introduced |

## Coordination rules

- Unrelated dirty paths (font storage, clipboard, generative editing, presets,
  demo service worker, and others) belong to other active work and are never
  staged, reformatted, or committed here.
- Before each patch and commit, re-check `git status --short`; stage only the
  paths listed for the current milestone.
- Serialize commits on `master`. No rebase, reset, global stash, history
  rewrite, force-push, or worktree removal.
- Reserve `VARVE_E2E_PORT=1493` for website/browser validation from this task.
- Temporary evidence lives in `/tmp/varve-chromeos-stage5-*`; nothing from
  there is committed except distilled results in the audit document.

## Handoffs

- **Device run (primary gap):** the Duet 11M889 hardware checklist in the Stage
  5 audit. Package/install evidence here does not prove GUI rendering, pen or
  touch input, portals, fonts, or suspend/resume on a Chromebook.
- **AppImage verification after the fix:** the next release must confirm
  `usr/lib/Varve/onnxruntime-libs/<os>-<arch>/libonnxruntime.so` is present in
  both architectures and that the host-library behavior is unchanged.
- **Support tier promotion:** only after a real Duet GUI run and the checklist
  are recorded; the matrix stays at the current evidence tier until then.
