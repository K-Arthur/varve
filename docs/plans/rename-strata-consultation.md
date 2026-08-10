# Product Rename Consultation — "Strata" → TBD

**Status: CONSULTATION ONLY. No repository changes, renames, domain purchases,
account registrations, or trademark filings have been made.**
**Date:** 2026-08-04
**Author:** K-Arthur (with assistant support)

> **DECISION RECORD (2026-08-04):** Name preference recorded — **Ply**.
> No rename work has been executed. Implementation begins only after an
> explicit go-ahead from the owner, proceeding through milestones M0–M4 in
> §9, each verified with `just gate` before commit.

> **OUTCOME (2026-08-04):** the project was renamed to
> **Varve**, not Ply. This consultation record preserves the intermediate
> preference and the reasoning trail; the rename itself is complete (see
> `CHANGELOG.md` [0.1.0] "About the name" and `TRADEMARKS.md`). Do not act
> on the "Ply" preference — it was not the final choice.

This document is a decision-support package. It contains:

1. The full candidate list (40 names).
2. The best 10 with preliminary conflict findings.
3. A comparison table.
4. The best 3 with a clear recommendation.
5. Suggested identifier forms (repo, executable, package, domain, bundle ID) per finalist.
6. A complete repository rename inventory (audited against the actual codebase).
7. A staged migration and rollback plan.
8. A final verification checklist.

---

## 0. Fixed brand constraint — the logo

The logo is `packages/ui/src/icons/strata-app-icon.svg` (master 1024×1024):

```
<rect width="1024" height="1024" rx="180" fill="#FAFAF8"/>
<path d="M160,208 H672 L736,368 H224 Z" fill="#39D0C6"/>   <- top layer (teal)
<path d="M224,432 H736 L800,592 H288 Z" fill="#E28C3C"/>   <- middle layer (amber)
<path d="M288,656 H800 L864,816 H352 Z" fill="#C54B3A"/>   <- bottom layer (red)
```

**Three stacked, angled layers** (a stylized cross-section of rock strata —
parallelogram slabs, each offset and scaled like a sediment bed). Every
shortlisted name was scored against this mark: the mark must remain visually
unchanged and must read as "layers, depth, stacking, building".

The mark is **independent of the wordmark**. The mark file needs no changes.
The wordmark files (`strata-wordmark*.svg`, `strata-icon*.svg`, and the
`StrataLogo.tsx` component) embed the text "Strata" and must be regenerated
with the final name — a straightforward art task, no design-system change.

---

## 1. Full candidate list (40)

Organised by theme. Tier labels are preliminary, based on registry checks and
known-market knowledge, refined in Sections 3–5.

### A. Layers / stacking / depth (the strongest semantic fit with the logo)

| # | Name | Rationale | Tier |
|---|------|-----------|------|
| 1 | **Ply** | A ply is a layer (plywood, multi-ply). The logo IS three plies. Short, phonetic, brandable | STRONG |
| 2 | **Shale** | Layered sedimentary rock — literally a stratum, without respelling "Strata" | STRONG |
| 3 | **Plinth** | The architectural base layer your work stands on | STRONG |
| 4 | **Lamina** | Latin for layer/plate — elegant, but taken by pmndrs' WebGL "Lamina" | RISKY |
| 5 | **Folia** | Latin for leaves/layers — crowded (health app, doc app, Minecraft server, generative art) | RISKY |
| 6 | **Phyllo** | Layered pastry + Greek leaf — taken by a developer-API company (Phyllo) | RISKY |
| 7 | **Lattice** | Structure — taken (Lattice HR) | RISKY |
| 8 | **Trellis** | Garden structure — crowded (DeFi, insurance, evals) | RISKY |
| 9 | **Strudel** | Layered pastry — taken (music livecoding tool) | RISKY |
| 10 | **Sediment** | Layers of deposit — negative connotation, clunky | WEAK |
| 11 | **Ziggurat** | Stepped pyramid — literal stacked layers; distinctive, but collides with an existing architectural drafting product | MODERATE |
| 12 | **Deckle** | Papermaking frame (deckle-edge paper) — craft heritage, low collision | MODERATE |
| 13 | **Layerly** | Coinage — taken by several active businesses incl. a design-adjacent tool | RISKY |
| 14 | **Slate** | Layered rock — taken (Slate editor, slate.com) | RISKY |
| 15 | **Mantle** | Earth's layered interior — taken (Mantle crypto L2) | RISKY |

### B. Structure / building / composition

| # | Name | Rationale | Tier |
|---|------|-----------|------|
| 16 | **Keystone** | Architectural — taken (KeystoneJS, Keystone cloud) | RISKY |
| 17 | **Cornerstone** | Taken (Cornerstone OnDemand) | RISKY |
| 18 | **Bedrock** | Taken (AWS Bedrock, Minecraft) | RISKY |
| 19 | **Substrate** | Taken (Polkadot) | RISKY |
| 20 | **Scaffold** | Descriptive, hard to protect | WEAK |
| 21 | **Atrium** | Architectural — used (law, property) | MODERATE |
| 22 | **Facet** | A face of a gem/composition — crowded (facet.net, Rust reflection crate, analytics) | RISKY |
| 23 | **Prism** | Taken (Prisma, prism.js) | RISKY |
| 24 | **Composition** | Ordinary descriptive phrase | WEAK |
| 25 | **Pylon** | Obscure, negative associations (traffic) | WEAK |

### C. Craft / studio / print heritage

| # | Name | Rationale | Tier |
|---|------|-----------|------|
| 26 | **Burin** | Engraver's tool — craft heritage; fresh Rust GUI-framework collision | MODERATE |
| 27 | **Atelier** | French for studio/workshop — common word, weak distinctiveness | MODERATE |
| 28 | **Gouache** | Opaque watercolour — art-heritage word; low registry collision | MODERATE |
| 29 | **Vellum** | Drawing surface — taken (vellum.io) | RISKY |
| 30 | **Maquette** | Mockup/model — taken (maquette.js) | RISKY |
| 31 | **Stencil** | Taken (Stencil web-components compiler) | RISKY |
| 32 | **Fresco** | Taken (Adobe Fresco) | RISKY |
| 33 | **Easel** | Taken (Inventables Easel, easel.ly) | RISKY |
| 34 | **Pastel** | Taken (design review tool) | RISKY |
| 35 | **Figment** | Imagination — taken hard (figmentapp.com creative-AI tool, figment.io, Lumosity, figment.so, 32M-download Rust crate) | RISKY |
| 36 | **Tessera** | Mosaic tile — taken (Tessera blockchain/AI) | RISKY |

### D. Modern / coined

| # | Name | Rationale | Tier |
|---|------|-----------|------|
| 37 | **Vecto** | Vector-ish coinage — adjacent to Vectornator/Linearity | MODERATE |
| 38 | **Stackwell** | Taken (fintech) | RISKY |
| 39 | **Stackly** | Coinage — occupied (small SaaS) | MODERATE |
| 40 | **Pixelforge** | Coinage — generic-AI-startup feel, clunky | WEAK |

**Dropped during brainstorming (known conflicts):** Layr (insurance API),
Lamina (pmndrs), Strata-adjacent respellings (Stratum, Stratis, Strato —
excluded by your rules), Tier (scooter rental), Block (Block Inc), Loom
(video), Spline (3D tool), Obsidian (notes), Canvas (Instructure), Sketch
(obvious), Framer/Figura/Canva-likes (excluded by your rules).

---

## 2. Shortlisting methodology

Ten names were selected from the 40 and put through a preliminary conflict
check (Section 3):

**Ply, Shale, Plinth, Burin, Atelier, Folia, Ziggurat, Figment, Layerly, Facet**

Checks performed (2026-08-04):

| Surface | Method | Coverage |
|---|---|---|
| npm | `npmjs.com/package/<n>` + registry API | All 10 |
| crates.io | `crates.io/api/v1/crates/<n>` | All 10 |
| GitHub | `github.com/<n>` (org/user existence) | All 10 |
| AUR | `aur.archlinux.org/rpc/v5/search/<n>` | All 10 + extras |
| Snapcraft | `api.snapcraft.io` search | All 10 + extras |
| Search engines | DuckDuckGo HTML endpoint (partial — rate-limited), Bing/Mojeek (captcha-blocked on this run) | 4 names (Ziggurat, Folia, Figment, Layerly) |
| Flatpak, Microsoft Store, Apple App Store, USPTO/EUIPO, WHOIS | NOT executable from this environment | Manual follow-up (Section 11) |

> **This is a preliminary risk review, not a legal guarantee.** Registry and
> web findings decay quickly; clearance searches on trademark registries,
> store listings, and domains are required before filing or launch.

---

## 3. Best 10 — preliminary conflict findings

### 3.1 Ply — *layers*
- **npm:** taken — `ply` (2014, function-wrapper micro-lib, 1.1k wkly dl, abandoned).
- **crates.io:** taken — `ply` (2017, PLY point-cloud format parser, tiny).
- **GitHub:** `ply` username taken (dormant personal account).
- **AUR:** free. **Snapcraft:** free.
- **Web:** PLY is also a well-known *file format* (Polygon File Format) — a technical descriptor, not a brand; association is harmless-to-positive in the 3D/design world. No known design application named "Ply" surfaced in any check.
- **Trademark:** short marks are registrable but common; a "PLY" Class 9/42 clearance search is mandatory. The PLY file format is unprotectable as a generic technical term, which is *good* (no brand confusion), not bad.
- **International:** benign across major languages (verb "to ply", "ply" = layer). No negative or vulgar readings found.
- **Domains:** `ply.com` is almost certainly a premium/taken domain; realistic options are `ply.app`, `getply.com`, `ply.design`.

### 3.2 Shale — *layered rock*
- **npm:** taken — `shale` (2017 immutable-JS lib, abandoned, ~0 dl).
- **crates.io:** taken — `shale` (2022 key-value store crate, small).
- **GitHub:** `shale` username taken (empty account).
- **AUR:** free. **Snapcraft:** free.
- **Web:** the dominant search results are **shale gas/fracking news** — a persistent SEO noise problem for a consumer product. Not a brand collision, but a searchability liability.
- **Trademark:** appears clear in software classes in the preliminary scan; the word is used by small businesses (glassware, ceramics) in other classes. Clearance search still required.
- **International:** benign in major languages.
- **Domains:** `shale.com` likely taken; `shale.app`, `getshale.com` realistic.

### 3.3 Plinth — *architectural base*
- **npm:** taken — `plinth` (deprecated gulp tool, 2016, dead).
- **crates.io:** taken — `plinth` (**new, active**: June 2026, "AI-first 3D game framework built on Bevy" by Luminary Analytics; 3 releases in a month). This is a live collision in the Rust/developer space.
- **GitHub:** `Plinth` username taken (tiny account).
- **AUR:** free. **Snapcraft:** free.
- **Web:** some non-software uses (plinths/museum displays, a UK education product "Plinth"). No design-tool collision found.
- **Trademark:** appears clear in software classes; architectural-adjacent classes may have art/display uses. Clearance required.
- **International:** benign; the word exists in several languages (Greek plinthos) with neutral meaning. Pronunciation ("plinth" with the final *th*) is the main friction point for non-native speakers.
- **Domains:** `plinth.com` taken (plinth? — verify); `plinth.app`, `plinth.so` realistic.

### 3.4 Burin — *engraver's tool*
- **npm:** taken — `burin` (2018 abandoned CLI generator).
- **crates.io:** taken — `burin` (**new, active**: July 2026, a Rust GUI framework on the "auralis" signal kernel; 68k lines, 3 releases in days). Another fresh, active Rust collision in the GUI space.
- **GitHub:** `burin` username taken (active personal account, 359 stars).
- **AUR:** free. **Snapcraft:** free.
- **Trademark:** clear in the scan; craft heritage word. **Pronunciation** is the weakness: "BYOOR-in" vs French "buh-RAN" — expect spelling-pronunciation friction.
- **International:** benign.
- **Domains:** `burin.com` taken; `burin.app` realistic.

### 3.5 Atelier — *studio/workshop*
- **npm:** taken — `atelier` (2016 abandoned build tool).
- **crates.io:** taken — `atelier` (2022 crypto/trading framework, mostly yanked).
- **GitHub:** `atelier` org taken (**Atelier Ace** — the hospitality group behind Ace Hotel; an active trademark holder in a different class).
- **AUR:** `atelier-git` and **Atelier B** (decades-old formal-methods verification toolchain) exist. **Snapcraft:** free.
- **Assessment:** a common French word used by thousands of businesses; weak distinctiveness, hard to protect. Design-adjacent meaning is attractive but the mark is weak.

### 3.6 Folia — *leaves / layers*
- **npm:** taken (2017, dead). **crates.io:** taken — FoLiA linguistic XML library (active). **GitHub:** org taken (myfolia.com, defunct gardening network).
- **Web — the killer finding:** Folia is actively occupied by **four+ products**: Folia Health (health tracking, 30k users), Folia document-annotation app by Branchfire, folia.app (generative-art platform), folia.com research tool — plus **Folia**, the well-known multithreaded **Minecraft server** by PaperMC, and folia.js in music software.
- **Assessment:** beautiful name, badly crowded. Excluded.

### 3.7 Ziggurat — *stepped pyramid*
- **npm:** taken (2016 Babel tool, dead). **crates.io:** **free** (the only finalist with a free bare crate name). **GitHub:** username taken (dormant). **AUR:** only unrelated R packages. **Snapcraft:** free.
- **Web:** occupied across several software categories, including **"Ziggurat — Architectural Design & Drafting Software"** (legacy product, but on-record in exactly our category), the **Ziggurat FPS game**, Square's "Ziggurat iOS architecture", and a blockchain-security project.
- **Assessment:** distinctive and logo-perfect (three stepped layers!), but the design/drafting-software collision and the game association raise trademark and search confusion risk. Would need a professional clearance pass.

### 3.8 Figment — *imagination*
- **npm:** taken (dead). **crates.io:** taken — **figment**, the 32M-download configuration library by Sergio Benitez (Rocket). Household name in Rust.
- **Web:** figmentapp.com (creative-AI visual toolkit), figment.io (web3 data), Lumosity's Figment, figment.so (Figma-to-website), a Figma plugin named Figment, Figment Marketing agency.
- **Assessment:** effectively unlaunchable as a distinct mark in the creative-software space. **Excluded.**

### 3.9 Layerly — *coinage*
- **npm:** free. **crates.io:** free. **GitHub:** username taken (with a `layerly-affiliate` repo).
- **Web:** **four active Layerly businesses**: layerly.io (web design agency), **layerly.app (a gradient-generator design tool — direct category collision)**, layerly.net (3D-printing studio), layerly.com.au + layerly.tech.
- **Assessment:** fragmented but genuinely occupied, including by a design tool. **Excluded.**

### 3.10 Facet — *a face of a composition*
- **npm:** taken (2014 config mixin, dead). **crates.io:** taken — `facet` (Rust reflection library, 543k downloads, active). **GitHub:** org taken (facet.net — a network/service company).
- **Web:** facet.net, facet.com (property), multiple Facet analytics/AI products.
- **Assessment:** crowded across web3, analytics, and Rust. **Excluded.**

### 3.11 Backup candidates checked in passing

| Name | AUR | Snap | npm/crates | Verdict |
|---|---|---|---|---|
| Deckle | free | free | not checked | craft-heritage word; needs a web pass before joining a shortlist |
| Gouache | free | free | not checked | art-medium word; needs a web pass |

---

## 4. Comparison table

| Name | Meaning | Logo fit (3 stacked layers) | Pronunciation | Memorability | Searchability | Collision risk | Domain / package availability | International | Overall |
|---|---|---|---|---|---|---|---|---|---|
| **Ply** | A layer (plywood) | **Perfect** — the mark is literally three plies | Unambiguous /plaɪ/ | Excellent (3 letters) | Good (PLY file format adds tech noise only) | **Low** — no design product found; dead micro-libs only | Domains hard (`ply.com` premium); `ply.app` likely; npm/crates taken (dead/small), AUR/Snap free | Clean | **#1** |
| **Shale** | Layered sedimentary rock | Strong — a stratum, angled beds | Unambiguous /ʃeɪl/ | Very good | **Weak** — shale-gas news dominates results | Low | Domains hard; registries free except dead libs | Clean | **#2** |
| **Plinth** | Architectural base layer | Strong — the foundation slab | Slight friction (final "th") | Good | Good | **Medium** — new active Bevy crate; some non-software uses | Domains hard; npm dead, crates taken (new), AUR/Snap free | Clean | **#3** |
| Burin | Engraver's tool | Weak-ish (single tool, not layers) | Friction (BYOOR-in vs buh-RAN) | Good | Good | Medium — new active Rust GUI crate | npm dead, crates taken (new), AUR/Snap free | Clean | #4 |
| Atelier | Studio/workshop | Moderate (a place, not layers) | Clean | Good | Poor (common word) | Medium-high — Atelier Ace, Atelier B | Occupied everywhere | Clean | #5 |
| Ziggurat | Stepped pyramid | **Perfect** | Clean, but long | Excellent (distinctive) | Good | **High** — existing architectural drafting software + game | Best registry availability of all (free crates.io) | Clean | #6 |
| Folia | Leaves/layers | Strong | Clean | Good | Poor (crowded) | **High** — 4+ active products | Occupied everywhere | Clean | Excluded |
| Figment | Imagination | Weak | Clean | Good | Poor (crowded) | **Very high** — creative-AI tool + 32M-dl Rust crate | Occupied everywhere | Clean | Excluded |
| Layerly | Coinage | Good | Clean | Good | Poor (fragmented) | **High** — 4 active businesses incl. a design tool | Free registries, taken brands | Clean | Excluded |
| Facet | Face of a composition | Moderate | Clean | Good | Poor (crowded) | **High** — Rust reflection crate, facet.net | Occupied everywhere | Clean | Excluded |

---

## 5. Best 3 — recommendation

### 1. **Ply** (recommended)
- The only shortlist name where the *literal meaning* is "a layer", and the
  existing logo is three plies. The rebrand narrative writes itself:
  "One ply, two plies — your design is the stack."
- No known design-product collision; every registry hit is a dead or tiny
  technical artifact. The PLY 3D file format is a descriptor, not a brand,
  and the association is flattering in the graphics/3D world.
- Short, phonetic, spellable, sayable in every major language, works as
  noun and verb, scales to any future capability (raster, motion, print,
  AI features) without renaming again.
- Honest caveats: (a) `ply.com` will be premium — plan for `ply.app` +
  `getply.com`; (b) a USPTO/EUIPO clearance search on "PLY" in Class 9/42
  must be done — 3-letter marks frequently have partial conflicts in other
  goods classes; (c) GitHub org `ply` is taken — use a repo under your
  personal account (`K-Arthur/ply`) or a new org (`getply`).

### 2. **Shale**
- Keeps the geological soul of "Strata" (shale is a stratum) without being
  a respelling. Modern, calm, professional.
- Clean registry profile. The liability is search: "shale" is dominated by
  fracking news and will fight SEO for the app's lifetime. Choose Shale
  only if you accept that noise and plan aggressive brand-SEO (shale.app,
  "shale design app" content).

### 3. **Plinth**
- Architectural "base layer" meaning that compliments the mark's stacked
  slabs; distinctive and dignified.
- Caveats: an active Bevy game-framework crate named `plinth` (June 2026)
  and the pronunciation friction of the final "th". Both manageable — the
  crate is niche (Rust gamedev) and pronunciation is learned once.

**Fallback order:** Ply → Shale → Plinth → Burin → Ziggurat (Ziggurat is
the best "logo story" after Ply, but its design-software collision and game
association make it a legal clearance lottery — only pick it if clearance
comes back clean).

---

## 6. Suggested identifier forms per finalist

Pattern mirrors the current layout (`strata-*` crates, `@varve/*` packages,
`dev.strata.desktop`). Crate names use a suffix where the bare name is taken
on crates.io.

| Identifier | Ply | Shale | Plinth |
|---|---|---|---|
| GitHub repo | `K-Arthur/ply` (or org `getply/ply`) | `K-Arthur/shale` | `K-Arthur/plinth` |
| npm scope | `@ply/*` (editor, engine, ui, …) | `@shale/*` | `@plinth/*` |
| Cargo crate prefix | `ply-core`, `ply-engine`, `ply-bridge`, `ply-desktop` | `shale-core`, … | `plinth-core`, … |
| Rust lib/bin | `ply_desktop_lib` / `ply-desktop` | `shale_desktop_lib` / `shale-desktop` | `plinth_desktop_lib` / `plinth-desktop` |
| Executable | `ply-desktop` | `shale-desktop` | `plinth-desktop` |
| Tauri identifier | `dev.ply.desktop` | `dev.shale.desktop` | `dev.plinth.desktop` |
| macOS bundle ID | `dev.ply.desktop` | `dev.shale.desktop` | `dev.plinth.desktop` |
| Windows publisher | `K-Arthur (Ply Founder)` | … | … |
| Flatpak app-id | `dev.ply.desktop` | `dev.shale.desktop` | `dev.plinth.desktop` |
| AUR package | `ply-desktop-bin` | `shale-desktop-bin` | `plinth-desktop-bin` |
| Desktop file / WM class | `dev.ply.desktop` | `dev.shale.desktop` | `dev.plinth.desktop` |
| Document extension | `.strata` (unchanged, see §8) | same | same |
| MIME | `application/x-strata` (unchanged) | same | same |
| Website | `ply.app` + GitHub Pages `https://K-Arthur.github.io/ply/` | `shale.app` | `plinth.app` |
| Social | `@plyapp` / `@getply` (verify each platform) | `@shaleapp` | `@plinthapp` |

(If you choose a name outside these three, the same template applies —
replace the stem everywhere it appears in §7.)

---

## 7. Repository rename inventory (audited)

Audit date 2026-08-04. ~300 files contain "strata" (case-insensitive,
excluding `node_modules`, `target`, `dist`, lockfiles). Categories below
are the complete rename surface, with concrete locations.

### 7.1 Repository / workspace names
- Local directory: `Strata/` (repo root).
- GitHub: `K-Arthur/Strata`; referenced in `tauri.conf.json` homepage,
  root `Cargo.toml` (`repository`), `packaging/aur/*/PKGBUILD` (`url`,
  release URLs), `packaging/flatpak/*.yml` (source URL), README, docs.
- GitHub Pages base path: `SITE_BASE ?? '/Strata'` in
  `apps/website/astro.config.mjs` — changes with the repo name.
- Active git worktrees exist under `.worktrees/` (5 branches) — they must be
  merged/rebased *after* the rename lands on `master` (see §9, M1 note).

### 7.2 pnpm packages (17)
`@varve/{ai, codegen, collab, compositor, editor, engine, help, home,
import, layout, platform, print, prototype, scene, shared, ui, website}`
(`packages/*/package.json`, `apps/website/package.json`). Every `@varve/*`
import across `packages/**`, `apps/**`, `tests/**` and vitest aliases.

### 7.3 Cargo crates (13)
`strata-core, strata-colour, strata-wasm, strata-upscale, strata-bridge,
strata-trace, strata-bgremove, strata-sync, strata-print, strata-layout,
strata-engine` (workspace `Cargo.toml`) + `strata-desktop` (bin) and
`strata_desktop_lib` (lib) in `apps/desktop/src-tauri/Cargo.toml`. Crate
names also appear in `Cargo.lock` (regenerated, not hand-edited).

### 7.4 Tauri configuration (`apps/desktop/src-tauri/tauri.conf.json`)
- `productName: "Strata Desktop"`, window `title: "Strata"`.
- `identifier: "dev.strata.desktop"` — **determines the app-data dir**
  (Linux `~/.local/share/dev.strata.desktop`, macOS
  `~/Library/Application Support/dev.strata.desktop`, Windows
  `%APPDATA%\dev.strata.desktop`).
- `publisher: "K-Arthur (Strata Founder)"`, `homepage`,
  `longDescription` ("Strata is a local-first…").
- File association: ext `strata`, name "Strata Document", MIME
  `application/x-strata` (§8 — keep).
- `desktopTemplate: linux/dev.strata.desktop.desktop`; deb/rpm hicolor
  file lists keyed on `dev.strata.desktop*.png/.svg`; MIME XML file
  `linux/dev.strata.desktop.xml`.
- `tauri.test.conf.json` (same identifier, used by wdio).

### 7.5 Native code (`apps/desktop/src-tauri/src/lib.rs`)
- `glib::set_prgname("dev.strata.desktop")` + `set_application_name("Strata")`
  (Wayland icon resolution — must stay in lockstep with the desktop file).
- Print dialog titles "Strata Export" (2×), `author: "Strata"` (3×).

### 7.6 Linux packaging
- `apps/desktop/src-tauri/linux/dev.strata.desktop.desktop` (+ `.installed.desktop`):
  `Name=Strata`, `Exec=strata-desktop %F`, `Icon=dev.strata.desktop`,
  `StartupWMClass=dev.strata.desktop`, `MimeType=application/x-strata`.
- `apps/desktop/scripts/install-dev-icons.sh`: `APP_ID="dev.strata.desktop"`,
  emits `strata-desktop.desktop` alias, `StartupWMClass=strata-desktop`,
  `MimeType=application/x-strata`.
- `packaging/aur/strata-desktop-bin/PKGBUILD` (+ `.SRCINFO`): pkgname,
  `_appname`, `provides/conflicts`, AppImage source URL
  `Strata-${pkgver}-linux-x86_64.AppImage`, desktop/MIME install paths,
  embedded README text.
- `packaging/flatpak/dev.strata.desktop.yml`: `app-id`, `command: strata`,
  module `name: strata`, source URL.

### 7.7 Icons and brand assets
- Mark (KEEP UNCHANGED): `packages/ui/src/icons/strata-app-icon.svg` (+
  `-dark` variant), `strata-icon.svg`, `strata-icon-symbolic.svg`,
  `strata-icon-gradient.svg`.
- Wordmarks (REGENERATE text): `strata-wordmark*.svg` (6 files),
  `StrataLogo.tsx` + `StrataLogo.test.tsx`.
- Generated ladder: `apps/desktop/src-tauri/icons/hicolor/**`
  (`dev.strata.desktop*.png`), `icons/icon.{png,icns,ico}`.
- Generator scripts: `scripts/generate-icons.sh`,
  `apps/desktop/build-icons.sh`, `install-dev-icons.sh` — filenames and
  `APP_ID` change together.

### 7.8 User-facing strings
- "About Strata": `Menubar.tsx`, `Menubar.test.tsx`,
  `menu/nativeAdapter.ts`, `menu/localization.ts`, `actions/registerAll.ts`,
  `Settings/SettingsDialog.tsx`; menu snapshots
  (`menu/__tests__/__snapshots__/*.snap`) — regenerate snapshots, do not
  hand-edit.
- Window title, splash/startup, onboarding/did-you-know tips, help content
  (`packages/help/src/content/*`), home shell texts
  (`packages/home/src/HomeShell.tsx` and friends).

### 7.9 CI / release / scripts
- `.github/workflows/{ci,release,build,ci-debug,e2e-keyboard-nav,
  model-validation,quantize,website-deploy}.yml` — job names, artifact names
  (`strata-wasm`, `strata-debug-*`, `strata-visual-diff-*`, `strata-native-artifacts-*`),
  release name "Strata ${{ tag }}", release URL.
- `scripts/tauri-e2e.sh`, `scripts/desktop/preflight.mjs`,
  `scripts/release/*.mjs` (artifact naming, SBOM, website manifest),
  `scripts/generate-*.sh`, `scripts/audit-*.mjs` (some contain the name in
  messages only).
- Env vars (`STRATA_*`): `STRATA_E2E_PORT`, `STRATA_VISUAL_3X`,
  `STRATA_TAURI_E2E`, `STRATA_PERF_URL`, `STRATA_PERF_DUPS`,
  `STRATA_BUNDLE_DIR`, `STRATA_DESKTOP_BINARY`, `STRATA_BGREMOVAL_BENCH_DIR`,
  `STRATA_SECTIONS__`, `STRATA_ACCEPT`, `STRATA_ASSET_BASE__`,
  `STRATA_TYPEAHEAD_MS`, `STRATA_EXT`, `STRATA_FILE_MIME`,
  `STRATA_NODE_MIME` (last three are code constants, §8).

### 7.10 Website / legal / docs
- `apps/website/**`: package name, `<Layout title="Strata - …">`,
  index copy ("Try Strata beta", "About Strata"), `astro.config.mjs`
  SITE_BASE, `public/manifest.webmanifest`, screenshots naming, GitHub
  Pages deploy workflow.
- `TRADEMARKS.md` — the trademark-usage policy itself must be rewritten
  for the new mark (old mark can remain as a historical reference).
- `README.md`, `CHANGELOG.md` (keep history, add rename entry), `SECURITY.md`,
  `THIRD_PARTY_NOTICES` (check only), `AGENTS.md` (project name references),
  `docs/**` (~150 files; `docs/agents/session-history.md`,
  `docs/brand/strata-brand-guide.md`, `docs/brand-guide.md`,
  `docs/plans/*`, `docs/architecture/*` are the densest).

### 7.11 Tests, fixtures, snapshots
- Menu snapshots (see 7.8), `clipboard.test.ts` (MIME strings),
  `dnd-types.ts` constants, wdio installer spec (`STRATA_BUNDLE_DIR`),
  e2e specs asserting "Strata" labels (`tests/e2e/startup/startup.spec.ts`,
  `tests/e2e/home/*`, `tests/e2e/tauri/smoke.spec.ts`), `StrataLogo.test.tsx`,
  help-content tests, `tests/wdio/installer.e2e.ts`.

---

## 8. Identifiers that should NOT be renamed (compatibility surface)

These are load-bearing for existing users, files, and data. **Do not
blind-global-replace them.** Where a change is still desired, the migration
in §9 applies.

| Identifier | Where | Reason to keep |
|---|---|---|
| `.strata` file extension | `STRATA_EXT`, `packages/platform/src/pure.ts:23`, tauri `fileAssociations`, MIME XML, PKGBUILD | Existing documents on disk must keep opening; double-click-to-open stays working |
| `application/x-strata` MIME | tauri.conf.json, desktop files, PKGBUILD MIME XML, install-dev-icons.sh | Registered in desktop environments; changing orphans old files |
| `application/vnd.strata+json` (clipboard) | `packages/editor/src/clipboard.ts` | Cross-version copy/paste; write old MIME (plus new) and read both |
| `application/x-strata-node`, `application/x-strata-file` (dnd) | `packages/editor/src/dnd-types.ts` | Intra-app drag state between old/new sessions |
| `strata-editor-settings`, `strata-settings` (localStorage) | `packages/editor/src/settings.ts`, `components/Settings/settings.ts` | User preferences would reset; migrate with read-old → write-new + backup (the repo already has this pattern in `packages/editor/src/archive/settingsBackup*`) |
| IndexedDB backup database + object stores | `packages/engine/src/backup/stores/indexeddb.ts` (`DB_NAME` const) | Backups/caches; migrate records idempotently (key-based copy) |
| `app_data_dir` (derived from `dev.strata.desktop`) | tauri identifier; used in `lib.rs` (`.app_data_dir()`, `path()` calls) | Caches, backups, models, recent-file paths live here. **If the identifier changes: one-time copy (not move) old dir → new dir on first launch, leave old dir intact for rollback** |
| Document JSON schema / `DocumentCodec` version numbers | `@varve/scene` codec + migrations | Bump forward, never rename; migration IDs must stay stable |
| Update-signing keys / updater channel | none configured today (no updater plugin) — note for future | When an updater is added, bind keys to the NEW identity and retire the old channel only after the transition release |
| GitHub Actions secrets / environments | repo settings | Scoped to the repo, unaffected by the rename |
| Historical changelog entries, git history, tags | CHANGELOG.md, git | Preserve; add a rename note instead |

---

## 9. Staged migration and rollback plan

**Ground rules:** every milestone is one small, coherent commit set; `just gate`
(format, typecheck 15/15, lint, full test suite, token/emoji audits) plus the
architecture audit (`node scripts/audit-architecture.mjs --ci`) must pass
before commit; `git tag` each milestone for instant rollback; never combine
a user-visible change (M2+) with an internal one (M1).

### M0 — Baseline (day 0, no rename)
- `git tag pre-rename-<name>`, record `git rev-parse HEAD`.
- Run full gate + architecture audit; snapshot CI green state.
- **Rollback:** not needed — no changes.

### M1 — Internal build-system rename (no user-visible change)
- Rename: pnpm workspace scope `@varve/*` → `@<name>/*`, crate names
  (`strata-*` → `<name>-*`), directory names (`crates/strata-core` →
  `crates/<name>-core`, `packages/*` stay as-is), imports, vitest aliases,
  workflow artifact names, script names/messages, `STRATA_*` env vars
  (old names kept as deprecated aliases for one release cycle).
- Tooling: pnpm/cargo workspaces + codemod for imports; typecheck as the
  gate (`pnpm typecheck` must pass before commit — it catches every missed
  import site).
- Verification: `pnpm format && pnpm typecheck && pnpm lint && pnpm test`,
  `cargo test --workspace` (or `just test`).
- **Rollback:** `git revert` of the M1 commit — internal names only, zero
  user impact.

### M2 — Product identity (user-visible, no data migration)
- Tauri `productName`/window title, About/menus/help strings, desktop files,
  `glib::set_application_name`, icons + wordmark regeneration, executable
  name (`strata-desktop` → `<name>-desktop`), `install-dev-icons.sh`,
  website copy, README, docs, `TRADEMARKS.md`.
- Verification: `just gate` + Playwright smoke
  (`npx playwright test tests/e2e/startup/startup.spec.ts
  tests/e2e/tauri/smoke.spec.ts --project=chromium`) + desktop build
  (`just test` covers wdio desktop build).
- **Rollback:** revert; no data touched.

### M3 — Identifiers + data migration (the only risky step)
- Change Tauri `identifier` → `dev.<name>.desktop`; desktop-file names,
  WM class, Flatpak app-id, AUR pkgname, macOS bundle ID, Windows
  publisher metadata.
- Ship the **one-time migration** (new binary, first run):
  1. If new `app_data_dir` missing and old exists → **copy** (never move)
     old → new (backups, model caches, settings files).
  2. localStorage: read `strata-*` keys → write `<name>-*` keys → keep old
     as backup (reuse the `settingsBackup` archive pattern).
  3. IndexedDB: idempotent key-based copy of backup records.
  4. Clipboard/dnd: keep writing old MIME types alongside new; read both.
  5. Recent files: carried by the settings migration.
- Transitional packaging: AUR old package `strata-desktop-bin` keeps
  `provides=<name>-desktop` for one cycle, then is orphaned; Flatpak ships
  the new app-id (old sandbox installs remain functional and independent);
  release artifacts rename to `Name-<ver>-<platform>` with SHA256SUMS
  regenerated; GitHub repo rename with redirects; update every URL in §7.1.
- Verification: fresh-install path + upgrade path both tested; E2E:
  open an old `.strata` file from disk, confirm settings/backups/recent
  files survive the upgrade; `just gate`.
- **Rollback:** revert M3; old binary still reads the untouched old dir
  (this is why we copy, not move). The old AUR package + old Flatpak app-id
  still installable.

### M4 — Cleanup (after ≥1 release on the new identity)
- Remove old-name env aliases, old settings-key fallbacks, old clipboard
  MIME writes (keep reading old MIME for another release), old AUR package.
- Final sweep with the §10 checklist; update AGENTS.md/ephemeral-tree docs.

**Coordination notes:**
- Five git worktrees exist (`.worktrees/*`). The rename lands on `master`;
  worktrees merge after M3 using `git mv`-aware merge or manual
  reconciliation (they were branched pre-rename).
- The rename must be one "brand event" in CHANGELOG.md with a migration
  note for any existing users (currently 0.1.0 beta — the audience is
  tiny; now is the cheapest moment to rename).

---

## 10. Final verification checklist (no "Strata" left behind)

Run after M4 (each check must return zero unintended hits):

- [ ] `rg -i 'strata' --hidden -g '!**/.git/**' -g '!**/node_modules/**' -g '!**/target/**' -g '!**/dist/**' -g '!**/pnpm-lock.yaml' -g '!**/Cargo.lock'` → only: (a) the do-not-rename list in §8, (b) historical changelog/audit entries, (c) `TRADEMARKS.md` historical note.
- [ ] `pnpm typecheck` — 15/15 packages.
- [ ] `pnpm lint` — 0 new errors.
- [ ] `pnpm test` — full suite green; snapshots regenerated (menu, labels).
- [ ] `pnpm bench` — no perf regression on render/replay paths (rename touched no hot paths, but confirm).
- [ ] `pnpm audit:tokens` (120/120) and `pnpm audit:emoji` (zero).
- [ ] `node scripts/audit-architecture.mjs --ci` — thresholds unchanged.
- [ ] `just test` — cargo workspace + wdio desktop build green.
- [ ] E2E: fresh install + upgrade-from-old-binary path; `.strata` files
      open; settings/backups/recent files survive; copy/paste works across
      old and new builds; double-click file association opens the new app.
- [ ] Desktop: window title, About dialog, menus, splash, installer
      product name show the new name; Wayland icon resolves (prgname ==
      desktop file stem).
- [ ] Store/package listings: AUR, Flatpak, MS Store, App Store entries
      updated or transitioned; old names orphaned deliberately, not silently.
- [ ] Website: title/meta, manifest, screenshots, download URLs, support
      links, legal notices updated; GitHub Pages path redirects work.
- [ ] Docs sweep: README, AGENTS.md, docs/** brand references updated.
- [ ] `TRADEMARKS.md` rewritten for the new mark; old mark noted as
      historical.
- [ ] Registry checks re-run for the final name (npm/crates/GitHub/AUR/
      Snap/Flathub/MS Store/App Store) and a trademark clearance search
      (USPTO TESS + EUIPO + WIPO) completed and filed with this document.

---

## 11. Legal disclaimer and trademark-vs-copyright distinction

**Preliminary risk review.** This document is a product-naming screen, not
legal advice. The registry and web checks were performed on 2026-08-04 and
decay. Before launch:

1. **Trademark clearance for the product name** (mandatory): USPTO TESS,
   EUIPO, WIPO Global Brand Database, plus UKIPO/DPMA depending on launch
   markets; search Class 9 (software), Class 42 (SaaS/design services),
   and Class 41 (educational/creative services). "Ply" in particular is a
   short mark — expect prior registrations in other classes; a clearance
   opinion decides whether the app class is clear.
2. **Copyright and licensing for the logo and assets** (unchanged by the
   rename): the logo mark is original artwork in a project licensed
   FSL-1.1-MIT; the name change does not affect its copyright. What
   *must* happen: the trademark-usage policy (`TRADEMARKS.md`) is
   re-issued for the new mark, forks must update their branding per that
   policy, and wordmark SVG/text assets are re-created (the mark itself
   stays pixel-identical).
3. **Domain and store registration**: no domains were purchased, no
   accounts registered, no trademarks filed, and no code renamed during
   this consultation.

---

---

## 12. Round 2 — SEO, friction, distribution and marketability

Added 2026-08-04 after the owner asked for a second pass weighted toward
searchability, launch friction, and distribution (GitHub Pages-first,
source-available license, future store listings). **Ply remains the
recommendation; this section adds comparators and a scored rubric.**

### 12.1 Scoring rubric (used for every name in this round)

| Axis | What it measures | Weight |
|---|---|---|
| SEO ownership | SERP competition for the exact word; can the app own page 1 for "brand" and "brand + design app" | high |
| Friction | Pronunciation, spelling, international readings, trademark-clearance likelihood | high |
| Distribution | npm / crates.io / AUR / Snap / Flatpak / GitHub Pages URL / store-listing availability | high |
| Marketability | Design-tool feel, memorability, brand story, room to grow | medium |
| Logo fit | Reads as "three stacked angled layers" | medium |

### 12.2 New candidates checked (registry sweep, 2026-08-04)

| Name | Meaning / story | npm | crates.io | GitHub user | AUR | Snap |
|---|---|---|---|---|---|---|
| **varve** | A varve is one annual sediment layer — literally one stratum. Each layer you add is a varve | FREE | FREE | taken (dormant) | free | free |
| **twill** | Diagonal weave — its angled stripes echo the three angled slabs of the logo | taken (dead microframework) | taken (45 dl styling lib) | taken | free | free |
| **travertine** | Layered limestone used in architecture and interiors | FREE | FREE | taken | **taken (exact)** | free |
| **pleat** | Folded layers (pleated stack) | taken (dead) | taken (16 dl bloom-filter lib) | **FREE** | free | free |
| **outcrop** | Where rock strata are exposed at the surface | FREE | FREE | taken | free | free |
| **caliche** | Desert soil hardened into stacked crust layers | FREE | FREE | taken | free | free |
| deckle | Papermaking frame; deckle-edge paper | taken (dead Next.js shell) | FREE | taken | free | free |
| gouache | Opaque watercolour (artist heritage) | taken (dead) | taken (GPU render lib) | taken | free | free |
| loess | Wind-deposited layered sediment | taken (dead) | taken (5k dl parser) | taken | free | free |
| quire | A stack of folded sheets | taken (dead) | taken (85k dl YAML parser) | taken | **taken (exact)** | free |
| litho | Lithography (print heritage) | taken (empty) | taken (GraphQL lib) | taken | free | free |
| intaglio | Intaglio printmaking | taken (dead ORM) | taken (1.6M dl interner) | taken | free | free |
| chert | Layered flint rock | taken (empty) | taken (DSL lib) | taken | free | free |
| stipple | Stippling drawing technique | taken (dead) | taken (new UI toolkit) | taken | free | free |

All "taken" npm/crates hits are dead or tiny technical libraries — none is a
design product; the load-bearing findings are the FREE cells (varve,
travertine, outcrop, caliche are fully free on npm + crates + AUR + Snap).

### 12.3 Top challengers — profiles

**Varve** (strongest new candidate)
- Meaning: a single annual sediment layer — the most precise "strata" echo in
  the whole exercise without respelling Strata. Brand story: "every layer you
  add is a varve" — your design is a geological record.
- SEO: **pristine** — essentially zero existing brand competition; the app can
  own "varve" and "varve design app" immediately. Best SEO score of any name
  in either round (better than Ply, which shares SERPs with the PLY file format).
- Friction: pronunciation "varv" (rhymes with *carve*) — most people will say
  it right, but a minority says "VAR-vee"; spelling is unambiguous.
- Distribution: free on npm, crates.io, AUR, Snap; `dev.varve.desktop`
  Flatpak ID; GitHub Pages `K-Arthur.github.io/varve`; `varve.app` likely
  registrable; `@varveapp` handles plausible. GitHub username `varve` is
  taken (dormant) — repo under your account, as with Ply.
- Marketability: high memorability *once explained*; a mystery-word name
  needs a one-line tagline in marketing, onboarding, and the website hero.
- Trademark: a rare word — clearance very likely clean in software classes.

**Twill**
- Meaning: diagonal weave whose angled stripes are the visual twin of the
  three-slabs logo; "layers, woven together".
- SEO: moderate — twill fabric searches dominate, but "twill" is
  brand-ownable with the app context; better than shale, worse than varve/ply.
- Friction: excellent — one syllable, unambiguous spelling and pronunciation
  in every major language.
- Distribution: npm/crates occupied by dead/tiny libs (fine under a scope);
  AUR/Snap free; `dev.twill.desktop`, `K-Arthur.github.io/twill`, `twill.app`.
- Marketability: reads slightly "textile/fashion"; the fabric connotation is
  the one reservation. Strong, warm, tactile word.

**Travertine**
- Meaning: layered building stone — architecture-grade layering; classy.
- SEO: low competition, but searches skew to tile/stone products (noise, not
  brand conflict).
- Friction: long (10 letters) but phonetic; fine internationally.
- Distribution: **AUR exact-name collision** (someone owns the `travertine`
  AUR package) — a real, if minor, packaging frictions.
- Marketability: elegant and premium — arguably too upscale for a free tool;
  reads "interiors/architecture" more than "graphic design".

**Pleat** — folds of a stack; clean pronunciation; the only candidate with a
free GitHub username — but reads fashion, and npm/crates are taken.

**Outcrop / Caliche** — fully free registries and zero SEO competition, but
geology-academic tone (outcrop) or hard-to-pronounce Spanish origin
(caliche "ka-LEE-chee"). Honorable mentions only.

### 12.4 Scored table (1–5, totals out of 25)

| Name | SEO | Friction | Distribution | Marketability | Logo fit | Total |
|---|---|---|---|---|---|---|
| **Ply** | 4 | 5 | 4 | 5 | 5 | **23** |
| **Varve** | 5 | 3 | 5 | 4 | 5 | **22** |
| **Twill** | 4 | 5 | 4 | 3 | 5 | **21** |
| Pleat | 4 | 5 | 4 | 4 | 4 | 21 |
| Travertine | 4 | 4 | 4 | 4 | 4 | 20 |
| Outcrop | 5 | 4 | 5 | 3 | 4 | 21* |
| Caliche | 5 | 2 | 5 | 3 | 4 | 19 |

\* Outcrop scores well on paper but fails the marketability smell test — it
reads like a geology app, not a design tool.

**Conclusion of Round 2:** Ply keeps the #1 spot — it wins on the two axes
that matter most at launch (friction and marketability) and is the only name
whose dictionary meaning ("a layer") is instantly understood by everyone.
**Varve is the designated alternate**: if the owner wants maximum SEO
ownership and is willing to carry a tagline ("Design in layers"), Varve has
the cleanest launch profile of the entire exercise — free on every registry
checked. Twill is the third option, chosen for pronunciation and its direct
visual echo of the logo, at the cost of a mild fabric association.

### 12.5 Distribution factors specific to this project

- **GitHub Pages-first publishing:** the repo rename is the launch URL:
  `K-Arthur.github.io/<name>` — short names (Ply, Varve, Twill) give short
  URLs. The `SITE_BASE ?? '/Strata'` value in `apps/website/astro.config.mjs`
  must change with the repo rename; the PWA manifest, `<title>`/meta/OG tags,
  and a `sitemap.xml` should ship in the same release. A custom domain
  (e.g., `ply.app`, `varve.app`) can be attached to Pages via CNAME later
  without renaming anything.
- **npm scope:** publishing any future WASM/engine packages requires an npm
  org (`@getply`/`@getvarve`) — create it at launch even if unused, to park
  the scope. Bare npm names are taken for most short words; the scope is the
  real distribution surface.
- **crates.io:** Varve is the only finalist with a free bare crate name;
  Ply/Twill would use suffixed crates (`ply-core`, `twill-core`) — which is
  the intended pattern anyway.
- **AUR / Snap:** free for Ply, Varve, Twill, Pleat, Caliche, Outcrop;
  Travertine and Quire have exact AUR collisions.
- **Flatpak / store listings:** app-id `dev.<name>.desktop` and executable
  `<name>-desktop` work for all; rare words (Varve) face fewer existing apps
  in App Store / Microsoft Store search, while "Ply" will have some
  non-design apps to outrank — verify listings manually at launch.
- **License (FSL-1.1-MIT, source-available, free product):** no naming
  constraint from the license itself. Two practical notes: (1) the
  trademark policy (`TRADEMARKS.md`) must be re-issued for the new mark, and
  forks under the license must strip it — same rule as today; (2) the name
  should not sound premium-only or subscription-coded, which none of the
  finalists do.
- **Social handles:** check and park `@<name>app` / `@get<name>` on the four
  main platforms at decision time; rare words are more likely free.

> **DECISION RECORD (addendum, 2026-08-04):** Round 2 researched and scored.
> Ply reaffirmed as the recommendation. Varve designated alternate (best SEO
> and cleanest registry profile). No rename work has been executed; nothing
> changes until an explicit go-ahead.

> **EXECUTION RECORD (addendum, 2026-08-04):** The rename to **Varve** was
> executed. Repo, packages (`@varve/*`), crates (`varve-*`), Tauri identifier
> (`dev.varve.desktop`), product name, website, and app icons are Varve.
> Compatibility identifiers deliberately kept stable: `kind 'strata'` values
> in the SQLite schema, `.strata` extension support, `strata-*` localStorage /
> IndexedDB keys that still carry live data (migrated with read-fallbacks or
> one-time copies, never deleted), legacy app-data dir migration
> (`dev.strata.desktop` → `dev.varve.desktop`), clipboard MIME types, and
> historical fixtures/docs. The native document extension is now `.varve`
> (see `docs/architecture/new-design-creation.md`); `.strata` files remain
> openable through the same versioned migration pipeline.

---

*Appendix: this document was produced from a live audit of the repository
at HEAD (2026-08-04). The decision record above was added on the same date;
no source, packaging, or branding files were modified during the consultation.*
