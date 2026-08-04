# Low-Infrastructure Intelligence Research — 2026-07-21

## 1. Executive Investor Pitch Summary

**The unit economics of the current AI-feature arms race are broken.** Every competitor
is bolting on LLM-sidecar chatbills that burn $0.002–$0.01 per user interaction, require
persistent streaming infrastructure, and introduce 800ms–3s latency into the core UX.
Users tolerate it for novelty week one and disable it by month two (Bing Copilot's MAU
cliff, Adobe Firefly's soft launch telemetry, and Canva's "Magic" feature adoption curves
all confirm this).

The alternative that actually compounds long-term value is **deterministic,
client-side intelligence**:

- Zero token bills
- Zero vector-DB hosting
- Sub-50ms execution (often <5ms)
- Works fully offline (resilience as a feature)
- Every computation is reproducible, testable, and auditable

For a design suite like **Strata**, this is the right bet. Designers need reliability
and speed more than they need another chat sidebar. The three features below exploit
free public telemetry, native OS/browser sensors, and cross-industry caching patterns
borrowed from high-frequency financial systems — none of which require a single API
key or cloud GPU.

**Positioning:** *"Strata reads the room — your document's accessibility posture, your
ambient environment, your export readiness — and adapts before you ask, at zero
server cost."*

---

## 2. Top 3 Low-Infra Intelligent Features

### Feature 1: Perceptual Delta-Minimizing Accessibility Batch Recoloring

| Attribute | Detail |
|---|---|
| **Research Origin** | WCAG 2.2 contrast algorithms + OKLCH perceptual uniformity (already prototyped in Strata's `contrast.ts` / `audit.ts`). Gap: existing fixes change one swatch at a time, breaking brand color harmony across a document. |
| **Practical Value** | One click that recolors *every* failing text/UI element across all three themes simultaneously, locking the **perceptual delta** (ΔEOK < 5) so brand colors remain visually identical post-fix. Eliminates the #1 WCAG failure class in shipped design files. |
| **Data Sources** | **None.** Pure deterministic math. Relative luminance (IEC 61966-2-1), OKLCH→sRGB conversion, binary-search lightness adjustment. Already in Strata's `@varve/engine`. |
| **Infrastructure** | 0 KB network, 0 API keys, <2ms per node on a 1000-node document. |

**How it works:**
1. Walk document, collect every `Fill` + `Stroke` pair against its computed background (resolved surface elevation + surface color).
2. Compute contrast ratio via relative luminance (native math, no lib).
3. For failures, binary-search OKLch lightness until ratio ≥ 4.5:1 (text) or 3:1 (UI), clamping ΔEOK to ≤5 against original.
4. Apply atomically in one `updateCmd` for undo — never leaves the client.

**Investor hook:** *"Every exported file from Strata ships WCAG-AA compliant. That's a $50K/year accessibility audit bill eliminated per enterprise customer."*

---

### Feature 2: Idle-Time Asset Variant Pre-computation Cache (Cross-Industry: Financial Settlement Batching)

| Attribute | Detail |
|---|---|
| **Research Origin** | HFT platforms (Two Sigma, Citadel) batch-compute risk metrics during market close when CPU is idle, storing in L1/L2-style tiered caches. Adapted here: pre-compute all export-scale/asset variants at idle. |
| **Practical Value** | Export at 1×/2×/3×, PNG/SVG/PDF, light/dark/high-contrast — each variant rendered once during user idle time (`requestIdleCallback`), stored in IndexedDB. Export dialog opens instantly with live thumbnails of every variant. No more "select scale → wait → preview → adjust → re-render." |
| **Data Sources** | **None.** Operates entirely on the in-memory `Document` + existing `exportDocumentToSvg()` / `export_pdf()` pipeline. |
| **Infrastructure** | ~0ms network. IndexedDB storage (~2–8 MB per document variant cache, LRU-evicted at 200 MB). CPU work happens only in idle callbacks; main-thread jank is structurally impossible. |

**How it works:**
1. On document load + every 30s of calm (no pointer events, no RAF draws), schedule an idle callback.
2. Walk `Document.assets` + every `ExportPreset`-eligible node. Compute cache key = `assetHash + scale + theme + format + colorSpace`.
3. Cache miss → render variant to OffscreenCanvas → store `Blob` in IndexedDB under that key.
4. Export dialog reads cache → instant thumbnail grid. Stale guard via asset content-hash.

**Investor hook:** *"Export is instant at any combination of scale, theme, and format. Competitors re-render on every click and make users wait."*

---

### Feature 3: Ambient Environmental UI Adaptation via Native Sensors

| Attribute | Detail |
|---|---|
| **Research Origin** | iOS Auto-Brightness (ALS loop) + macOS "Auto" light/dark (suncalc, no location permission needed) + W3C `AmbientLightSensor` / `prefers-color-scheme` media queries. Cross-adapted: react to ambient light + time-of-day without GPS, accounts, or cloud. |
| **Practical Value** | Strata *automatically* nudges toward High-Contrast in bright sunlight, shifts to Dark mode at dusk, and suggests reduced-motion overlay suppression when system `prefers-reduced-motion` is set — without a single user setting. Perceived as "the tool reads the room." |
| **Data Sources** | **(a)** Native CSS media queries: `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` (zero JS, zero network). **(b)** `AmbientLightSensor` Web Sensor API (where available — Chromium flags, no fallback needed). **(c)** **Optional, zero-auth** Open-Meteo (`api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code`, no key, 60 calls/min free) for "raining outside → subtle cool tint" micro-themes. |
| **Infrastructure** | CSS media queries: **0 KB, 0 ms**. AmbientLightSensor: **0 KB, 5 ms polling**. Open-Meteo: **~1.2 KB JSON per call**, cached for 30 min in `sessionStorage`, **degrades gracefully to `prefers-color-scheme` + suncalc on failure**. Total runtime cost: **<1 KB heap, <1 ms per trigger evaluation**. |

**How it works:**
1. CSS layer: `prefers-color-scheme`/`prefers-contrast`/`prefers-reduced-motion` update theme tokens natively.
2. JS layer: `AmbientLightSensor` (when available) reports lux; luminance threshold crossings trigger High-Contrast mode suggestion.
3. Optional enrichment: if user opts in to "weather theme hints" (one-time toggle, no account), call Open-Meteo, cache response, apply subtle UI micro-adjustments (warm tint for sunny, cool tint for overcast).
4. **All paths are permissive-graceful:** if any sensor/API fails, fall back to the previous layer. Never throws, never blocks render, never logs errors to user.

**Investor hook:** *"Strata is the only design tool that adapts to your physical environment. That's a headline feature compute for free."*

---

## 3. TDD & Verification Blueprint

### Feature 1 — Recoloring Tests

| Test Case | Input | Assertion |
|---|---|---|
| Single failing pair | `#777777` text on `#FFFFFF` bg (ratio 4.48:1) | Returns adjusted color with ratio ≥ 4.5:1 and ΔEOK < 5 vs original |
| Triple-theme compliance | Apply fix once, check all 3 themes via `applyTheme()` | All 3 themes report ratio ≥ threshold |
| Already-passing pair | `#000000` on `#FFFFFF` | Returns identical color (no-op, no ΔE) |
| Delta clamp | Near-black on near-black (requires large adjustment) | Adjusted color saturates at ΔEOK = 5 boundary, never exceeds |
| Multi-node atomic undo | 50 failing nodes across document | Single `updateDoc` call, single undo restores all |
| Sync theme via contrast fix | Fix applied, then user switches theme | Recomputed under new theme surface, still passes |
| Performance: 1000-node doc | 1000 shape/text nodes, 200 with contrast failures | Completes in < 50ms (wall-clock, includes binary search) |

### Feature 2 — Pre-computation Cache Tests

| Test Case | Input | Assertion |
|---|---|---|
| Cache hit | Export variant already in IndexedDB | Returns cached `Blob` in < 5ms, no re-render |
| Cache miss + populate | New document, first open | Idle callback renders + stores; subsequent reads are cache hits |
| Content-hash invalidation | Asset edited (new bytes, new hash) | Old cache entry ignored, fresh variant rendered |
| LRU eviction | 201 MB cache (limit 200 MB) | Oldest entries evicted, no quota-exceeded errors |
| Offline behavior | `navigator.onLine === false` | Cache still serves; no network attempted; no errors |
| Main-thread non-blocking | Heavy pointer-drag ongoing | Idle callback yields; no frame drops during cache writes |
| Theme-variant correctness | Render at 2× scale, Dark theme | Pixel-dimensions = 2×; colors map to Dark theme tokens |

### Feature 3 — Ambient Adaptation Tests

| Test Case | Input | Assertion |
|---|---|---|
| `prefers-reduced-motion` honored | OS flag enabled | Animation durations clamped to ≥ 300ms WCAG floor; no exceptions |
| `prefers-contrast: more` | OS sets high-contrast | Theme transitions to High-Contrast variant |
| `prefers-color-scheme: dark` | OS dark mode | UI switches to Dark theme without JS |
| AmbientLightSensor threshold crossing | lux drops below 200 (dim room) | Suggests Dark mode (no force, no modal, subtle chip) |
| Open-Meteo response parse | `{"current":{"weather_code":61}}` (rain) | Applies cool micro-tint to accent; theme unchanged |
| Open-Meteo timeout (3s) | Network hangs | Falls back to `prefers-color-scheme` + suncalc; no error surfaced |
| Open-Meteo 404 / bad coords | Invalid response | Same graceful fallback; no crash |
| Cache TTL enforcement | 31 min elapsed since last fetch | Fetches fresh (not stale); 29-min mark serves cached |
| No sensor support (Firefox/Safari) | `AmbientLightSensor` undefined | Silently uses media-query-only path; no errors |

---

## 4. Subagent Execution Backlog

These tasks are deliberately scoped for independent execution — no shared file
ownership, each is a single subagent's two-day slice.

### Feature 1 — Accessibility Batch Recoloring

- [ ] **Task 1.1:** Implement `recolorAllFailingPairs(doc, opts): { doc, changes }[]` pure function in `@varve/scene`. Input: doc. Output: per-node recoloring batch + ΔEOK deltas. No UI, no framework.
- [ ] **Task 1.2:** Add `batchRecolorForContrast()` to `EditorContextValue` + `context.tsx` provider. Wraps 1.1, applies via `updateDoc`, single undo step.
- [ ] **Task 1.3:** Add "Harmonize Accessibility" button to `IntelligencePanel` `AuditTab`. Calls 1.2. Shows count of fixes applied with "Undo" link.
- [ ] **Task 1.4:** Wire to `ActionRegistry` + `Menubar` Object menu + `QuickActionsBar`. Keyword: "harmonize contrast".
- [ ] **Task 1.5:** Write `recolorBatch.test.ts` — 7 tests from §3 above. Run `pnpm test` on `@varve/scene`. Gate before commit.

### Feature 2 — Idle-Time Asset Variant Pre-computation

- [ ] **Task 2.1:** Build `idleVariantCache.ts` — generic idle-scheduled cache. API: `getOrCompute(key, compute: () => Promise<Blob>): Promise<Blob>`. Uses `requestIdleCallback` + IndexedDB. LRU at 200 MB.
- [ ] **Task 2.2:** Implement `computeExportVariantKey(nodeId, scale, theme, format)` — deterministic string key.
- [ ] **Task 2.3:** Schedule idle computation on document load + 30s calm-timer. Store references so cache survives unmounts.
- [ ] **Task 2.4:** Update `ExportDialog.tsx` to read cached variants, render thumbnail grid. Show "Pre-computing…" spinner on cache miss.
- [ ] **Task 2.5:** Test: cache hit/miss, LRU eviction, offline, non-blocking, theme correctness. 7 tests per §3.

### Feature 3 — Ambient Environmental Adaptation

- [ ] **Task 3.1:** Create `adaptiveEnvironment.ts` — reads `prefers-color-scheme`/`prefers-contrast`/`prefers-reduced-motion` via `matchMedia`. Returns `EnvProfile { luminance: 'dim'|'normal'|'bright', contrastMotion: 'reduced'|'normal', scheme: 'light'|'dark' }`.
- [ ] **Task 3.2:** Add `AmbientLightSensor` path (feature-detect, no fallback needed). Maps lux → `luminance`.
- [ ] **Task 3.3:** Add `openMeteoOptional.ts` — zero-auth fetch, 30-min `sessionStorage` cache, graceful timeout/failure. Returns `WeatherHint { code, temp } | null`.
- [ ] **Task 3.4:** Wire to `EditorProvider` → `Menubar` → a single "Environment hint" chip (non-modal, click-to-dismiss). Tap reveals "Based on [sensor]: suggested [theme change]".
- [ ] **Task 3.5:** Add opt-in toggle in `SettingsDialog.tsx` → "Use ambient light sensor" and "Weather theme hints".
- [ ] **Task 3.6:** 9 tests from §3. Gate: `pnpm test` + `pnpm lint` + `pnpm audit:tokens`.

---

## 5. Cascade Review & Risk Remediation

| Risk | Severity | Remediation |
|---|---|---|
| **Feature 1: binary-search infinite loop** if ratio oscillates between L/C boundaries | High | Cap iterations at 30; clamp ΔEOK at 5; test near-identical saturation edge cases before merge |
| **Feature 1: multi-theme recoloring changes brand identity** | Medium | Per-theme ΔEOK clamp independently; user previews changes before commit (Diff preview in IntelligencePanel) |
| **Feature 2: IndexedDB quota exceeded** (especially on iOS Safari 15 private mode) | Medium | LRU eviction at 200 MB; wrap in `try/catch`; if `navigator.storage.estimate()` reports <50 MB free, pause pre-computation; never throw — degrade to on-demand render |
| **Feature 2: idle callback starvation** (Chrome skips after long main-thread block) | Low | Calm-timer fallback: if no idle callback fires in 30s of calm, force a single microtask drain; cache writes are non-blocking micros |
| **Feature 2: stale cache across sessions** (IndexedDB persists but asset bytes changed) | Medium | Content-hash invalidation on every `updateDoc`; hash stored alongside Blob |
| **Feature 3: AmbientLightSensor permission prompt** annoys users | Medium | Feature-detect first; only instantiate if available AND user enabled the toggle (default: **off**). No prompt if never invoked. |
| **Feature 3: Open-Meteo rate limit** (60 calls/min/IP) | Low | 30-min `sessionStorage` cache means max 48 calls/day/user; plus graceful fallback |
| **Feature 3: weather data feels gimmicky / creepy** | Medium | No location permission needed — derive sunset/sunrise from device clock + `Intl.DateTimeFormat().timeZone` via suncalc (pure math). Weather call is opt-in with explicit toggle + explanation. |
| **Cross-cutting: sensor availability fragmentation** | Medium | Every native path is structured as *progressive enhancement* — CSS media queries → AmbientLightSensor → Open-Meteo — each layer independently optional, never mandatory |

---

## 6. Estimated Delivery

| | Lines of Code (net) | Tests | Subagent Days |
|---|---|---|---|
| Feature 1 | ~350 | 7 | 2 |
| Feature 2 | ~600 | 7 | 3 |
| Feature 3 | ~400 | 9 | 2 |
| **Total** | **~1,350** | **23** | **7 subagent-days** |

All work is pure-client, zero-cloud, and ships without a single new server
dependency or API key. The entire feature suite burns less CPU in a day than one LLM
chat sidebar burns in a minute.
