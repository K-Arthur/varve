# Low-Infrastructure Intelligence Features — BMAD-Lite Research Report

> **Date:** 2026-07-21
> **Framework:** BMAD-Lite (Breakthrough Method of Agile AI-Driven Development)
> **Core Mandate:** Zero recurring cloud cost, zero latency overhead, high user utility, privacy-by-design

---

## 1. Executive Investor Pitch Summary

**The thesis:** The market is flooded with $0.30/token LLM wrappers that burn venture capital on inference while delivering generic chat sidebars. Real defensibility lies in *deterministic ambient intelligence* — features that anticipate user needs using signals already available on the device, with zero recurring cloud cost and zero latency.

**Unit economics advantage:** A conventional AI feature costs $0.002–$0.05 per interaction (API inference) plus $0.10–$0.50/GB/mo for vector storage. At 1M MAU with 10 daily interactions, that's **$600K–$9M/mo** in variable costs. The features below cost **$0/mo** in cloud infrastructure — all computation is client-side, all data sources are free/public/OS-native. The marginal cost per user is zero.

**Competitive longevity:** LLM wrappers die when the API pricing changes, the model is deprecated, or a competitor launches a thinner wrapper. Deterministic models on local telemetry are portable, private, and improve without server-side investment. They also survive offline and in low-connectivity regions — instantly expanding TAM.

---

## 2. Top 3 Low-Infra Intelligent Features

---

### Feature 1: Ambient Context Engine (OS Signal Fusion)

**Research Origin:** Cross-industry pollination from financial HFT (ultra-low-latency signal fusion), OS design (Android/iOS contextual assistants that died because they phoned home), and IDE telemetry (VS Code's predictive edit — which works *because it's local*).

**Practical Value:** The application proactively configures itself based on a fused signal vector from the host OS — no cloud call, no user configuration.

#### Data Sources (zero-auth, zero-cost)

| Signal | Source | Latency |
|--------|--------|---------|
| Window focus / app foreground | `navigator.visibility` + OS API | 0ms (local) |
| Network state & type | `navigator.connection` | 0ms |
| Battery & power mode | `navigator.getBattery()` | 0ms |
| Locale, timezone, temperature unit | `Intl` APIs | 0ms |
| Idle state | `requestIdleCallback` + pointer event gaps | 0ms |
| Display refresh rate / HDR | `window.screen` / `matchMedia` | 0ms |
| File system recent files | OS MRU list (Tauri `fs` plugin) | <5ms |
| Clipboard content type | `navigator.clipboard.read()` metadata | <2ms |
| Memory pressure | `navigator.deviceMemory` | 0ms |
| Pointer/pen/touch input mode | PointerEvent checks | 0ms |

#### What It Enables (No Gimmicks)

- **Auto-save schedule adapts:** On battery + idle → batch saves. On AC + active → save every edit. Saves battery on mobile, prevents data loss on desktop.
- **Tool defaults mutate by context:** Pen detected? Auto-select Draw workspace and show brush palette. Keyboard + no pointer? Focus search bar, enable keyboard nav hints. Touch + mobile viewport? Enlarge hit targets, simplify toolbar.
- **Preload strategy adapts to network:** On `slow-2g` → defer all image preloading, skip analytics. On WiFi + AC power → prefetch next-likely assets.
- **Locale-sensitive defaults:** Date picker defaults to local calendar system, number inputs show local separators, unit picker defaults to local measurement system — all without locale dropdowns or user settings.
- **Clipboard-aware creation:** User copies a URL, then opens the app → "Paste as link" is the default action, not "New blank document." User copies an image → "Paste as image layer" is surfaced.

**Memory/CPU budget:** <2MB RAM, <1% CPU (event-driven, no polling). Payload: zero (no network).

---

### Feature 2: Local Telemetry Micro-Forecasting Engine

**Research Origin:** Adapted from operational forecasting in supply chain (Croston's method for intermittent demand) and time-series anomaly detection in observability platforms, but inverted — instead of detecting server anomalies, predict *user* behavioral states from local event streams.

**Practical Value:** The application learns usage patterns entirely on-device and uses them to predictively pre-configure state, cache resources, and adapt workflows — without ever sending data to a server.

#### Data Sources (Entirely Local)

- User interaction timestamps (click, keypress, tool switch, command invocations)
- File/project open/close events
- Viewport geometry changes
- Session duration and time-of-day buckets
- Feature usage frequency counters

#### Model (Pure Client-Side, No ML Runtime Needed)

- **Exponential smoothing** for tool-switch prediction: `S_t = alpha * X_t + (1-alpha) * S_{t-1}` (alpha=0.3). Predicts the next tool or command the user will invoke based on weighted recency.
- **Holt-Winters triple exponential smoothing** for daily/weekly session patterns. T=96 (15-min buckets over 24h). Predicts *when* the user will next use the app and what they typically do in that time window.
- **Markov chain (k=1)** for workflow sequences: `P(tool_next | tool_current)` from a sliding window of the last 200 tool transitions. Enables pre-warming caches for the 3 most likely next tools.
- **Croston's method** for intermittent feature activation: predicts *when* a rarely-used but valuable feature (e.g., "export PDF/X") will next be needed, so its dependencies can be lazily pre-loaded.

#### What It Enables

- **Predictive cache warming:** Before the user switches to the paint tool, pre-load brush textures. Before they open the export dialog, parse the document's print settings. Before they switch to a project last opened at this time-of-day yesterday, preload its assets.
- **Adaptive shortcut learning:** After a tool is used 3+ times via menu, the system offers a keyboard shortcut assignment. After a shortcut is never used in 30 days, it offers to reclaim it. All without a settings dialog.
- **Smart resource eviction:** LRU cache with predictive weighting: evict resources least likely to be needed in the next 5 minutes based on the Markov chain, not just least recently used.
- **Progressive onboarding decay:** Feature hints for a tool disappear permanently after the user has used that tool 5+ times. No "dismiss forever" checkbox needed.

**Memory/CPU budget:** ~200KB for model state (4 matrices of 32x32 floats), <0.5% CPU per prediction (O(1) lookup after build). Payload: zero (no network).

---

### Feature 3: Semantic Local-First Content Mesh

**Research Origin:** Adapted from enterprise knowledge graph systems (Neo4j's graph traversal patterns) and local search indexing (Spotlight, Everything, Wox), but generalized into an application-agnostic, zero-infrastructure cross-app context layer.

**Practical Value:** A lightweight, local-only entity graph that connects files, contacts, calendar events, clipboard history, bookmarks, and app-internal assets — enabling cross-app intelligence without any cloud sync or third-party API.

#### Data Sources (All Local, All Free)

| Source | Access Method | Privacy Level |
|--------|--------------|---------------|
| File system metadata | Tauri `fs` plugin / File System Access API | Full local |
| Clipboard history | Memory ring buffer (last 50 items, no persist) | Ephemeral |
| Browser bookmarks (same-origin) | `bookmarks` API (web extensions) | Per-origin |
| Calendar (local) | iCal file parse from filesystem | Full local |
| Contact vCards | File scan from ~/Contacts (opt-in) | Full local |
| App-internal assets | Document asset table | In-app only |
| Recent searches | `localStorage` key-value | Per-app |

#### Graph Model (In-Memory, ~5MB for 10K Nodes)

```
Node types: File, Contact, CalendarEvent, ClipboardItem, Bookmark, Asset, SearchQuery
Edge types: references, contains, created_by, opened_together, similar_to, attached_to

Storage: adjacency list (Map<NodeId, Set<Edge>>) + inverted index (Map<string, Set<NodeId>>)
Query: BFS with depth limit (3) + term matching on inverted index
```

#### What It Enables

- **Zero-config asset suggestions:** When a user inserts an image into a document, the mesh surfaces files from *recently opened folders* and *files with similar names* — not just the default file picker's last location.
- **Auto-tagging from context:** A document created while a calendar event "Q3 Review" was active, with a file named `chart-data.csv` in the clipboard history — the mesh suggests tags `[Q3 Review, chart-data, csv-import]` for the new document.
- **Cross-document reference resolution:** "Open linked file" for a file that was moved last week — the mesh's `similar_to` edges (based on name hash + containing folder proximity) find candidates even when the direct path is stale.
- **Clipboard-enhanced paste:** If the user copies text containing a date like "next Friday" and pastes into a date field, the mesh resolves it to an absolute date using the current locale's week start. If they copy a file path and paste into an image picker, it resolves to the actual image.
- **Smart "recent" that actually works:** The mesh ranks recent items by *graph centrality* — a file that was emailed, attached to a calendar invite, and opened in the editor gets higher priority than a file opened once by accident.

**Memory/CPU budget:** ~5MB for 10K nodes/edges, ~10MB for the inverted index. Build time: <100ms from cached serialization. Query time: <1ms for depth-3 BFS on 10K nodes. Index build on app open: ~50ms (async, non-blocking). Payload: zero (no network).

---

## 3. TDD & Verification Blueprint

### Feature 1 — Ambient Context Engine

```
Test Suite: ambientContextEngine.test.ts

TEST "battery-aware save scheduling":
  GIVEN navigator.getBattery() returns { charging: false, level: 0.15 }
  WHEN initAmbientContext() resolves
  THEN context.signal.saveStrategy === 'batch-debounced-30s'

TEST "network-aware preload":
  GIVEN navigator.connection.effectiveType === 'slow-2g'
  WHEN context.signal.networkQuality computed
  THEN preloadBudget === 0
  AND imageDecodeBudget === 'none'

TEST "pen detection toggle":
  GIVEN PointerEvent with pointerType === 'pen'
  WHEN pointer event handler runs
  THEN context.signal.activeInput === 'pen'
  AND suggestedWorkspace === 'draw'

TEST "clipboard-aware creation":
  GIVEN clipboard lastItem MIME type === 'text/plain'
  AND content matches /^https:\/\//
  WHEN createDocument() called from home
  THEN defaultAction.label === 'Paste as link'

TEST "idle batching" (latency assertion):
  GIVEN user idle for 120s (no pointer/keyboard)
  WHEN idle handlers fire
  THEN batchSave() called within 5s
  AND no synchronous work > 50ms
```

### Feature 2 — Local Telemetry Micro-Forecasting

```
Test Suite: telemetryForecaster.test.ts

TEST "tool-switch prediction":
  GIVEN telemetry log: [select, select, paint, select, paint, paint]
  WHEN forecaster.predictNextTool()
  THEN result.tool === 'paint'
  AND result.confidence > 0.6

TEST "predictive cache pre-warm" (latency assertion):
  GIVEN predictedNextTool === 'paint'
  WHEN cacheWarmHandler fires
  THEN preloadPipeline('brush-textures') called
  AND execution < 5ms (just enqueue, not load)

TEST "negative case — cold start":
  GIVEN empty telemetry log
  WHEN forecaster.predictNextTool()
  THEN result === null
  AND no errors thrown

TEST "adaptive shortcut suggestion":
  GIVEN tool 'exportPDF' used 4x via menu in last session
  WHEN forecaster.getShortcutSuggestion('exportPDF')
  THEN result.shortcut === null  (threshold is 5)
  THEN after 1 more use:
  WHEN forecaster.getShortcutSuggestion('exportPDF')
  THEN result.shortcut === 'Ctrl+Shift+E'

TEST "memory budget" (stress):
  GIVEN 10,000 tool transitions recorded
  WHEN model serialized()
  THEN JSON.stringify(result).length < 50,000 bytes
```

### Feature 3 — Semantic Content Mesh

```
Test Suite: contentMesh.test.ts

TEST "cross-document reference":
  GIVEN graph has File("report.pdf") with edge -> CalendarEvent("Q3 Review")
  AND edge -> SearchQuery("Q3 review metrics")
  WHEN queryByTerm("Q3", { maxDepth: 2 })
  THEN result contains File("report.pdf")
  AND result.length <= 5

TEST "clipboard date resolution":
  GIVEN clipboard.lastItem.text === "next Friday"
  AND locale === "en-US" (week starts Sunday)
  WHEN parseClipboardDate()
  THEN result === (next Friday's ISO date)
  AND execution < 5ms

TEST "zero-config suggestion":
  GIVEN graph has File("/projects/q3/chart-data.csv")
  AND File("/projects/q3/report-final.pdf")
  AND user is inserting image in report-final.pdf
  WHEN suggestRelatedFiles('image')
  THEN result[0] is proximity-ranked by parent folder

TEST "recent centrality ranking":
  GIVEN File A opened 3h ago but linked to 2 calendar events
  AND File B opened 10min ago with no other edges
  WHEN getRecent(5)
  THEN File A ranked above File B

TEST "index build performance" (benchmark):
  GIVEN 10,000 nodes with 2 edges each
  WHEN buildIndex()
  THEN execution < 100ms
  AND memory.delta < 12MB
```

---

## 4. Subagent Execution Backlog

### Feature 1 — Ambient Context Engine

```
PRIORITY 1 (core signal layer — needed by all consumers)
[CE-1] Module: packages/shared/src/ambient/signals/signalSources.ts
  - Implement 10 signal source functions (battery, connection, locale, idle, memory,
    pointer, display, time, windowFocus, clipboard)
  - Each returns typed SignalValue or null
  - No side effects, no state

[CE-2] Module: packages/shared/src/ambient/signals/signalFusion.ts
  - Fuse raw signals into AmbientContextSnapshot
  - Derive higher-order signals: saveStrategy, preloadBudget, activeInputMode, suggestedWorkspace
  - Pure function, no dependencies

[CE-3] Module: packages/shared/src/ambient/signals/subscriptionManager.ts
  - EventEmitter pattern for signal change subscriptions
  - Throttle: no more than 1 emit per 200ms
  - Subscription with cleanup (returns unsubscribe fn)

PRIORITY 2 (UI consumers)
[CE-4] Component: Backed by CE-1/CE-2/CE-3
  - useAmbientContext() hook that returns fused snapshot
  - Re-renders only when relevant signal changes (shallow compare)
  - Server-side render safe (graceful degradation to defaults)

[CE-5] Integration: Auto-save strategy dispatch (already has autoSaveService)
  - Wire saveStrategy signal -> autoSaveService.updateConfig()
  - Battery-low + idle -> flush immediately. Battery-low + active -> debounce 30s.
  - AC + active -> real-time.

[CE-6] Integration: Tool palette mutation
  - Wire activeInputMode + suggestedWorkspace -> workspace mode switch
  - Pen detected -> prompt workspace switch (one-time nudge per session)
  - Touch + mobile -> enlarge toolbar hit targets

PRIORITY 3 (defence)
[CE-7] Test file: signals/signalSources.test.ts, signalFusion.test.ts, subscriptionManager.test.ts
  - 9 tests per the TDD blueprint
  - All signal sources return null when API unavailable (no crash)

[CE-8] Documentation: docs/architecture/ambient-context.md
  - Decision log: why OS signals over cloud signals (latency, privacy, offline)
  - Source-of-truth signal type definitions
```

### Feature 2 — Local Telemetry Micro-Forecasting

```
PRIORITY 1 (core model)
[TF-1] Module: packages/shared/src/forecast/models/exponentialSmoothing.ts
  - Generic Holt-Winters implementation (alpha, beta, gamma params)
  - Single-step prediction: predict(values, params) -> number
  - Configurable seasonality period (default 96 for 15-min daily buckets)

[TF-2] Module: packages/shared/src/forecast/models/markovChain.ts
  - k=1 Markov chain from event transition pairs
  - buildFromTransitions(events[]) -> TransitionMatrix
  - predictNext(currentState, matrix) -> {state, confidence}[]

[TF-3] Module: packages/shared/src/forecast/models/crostonsMethod.ts
  - For intermittent demand (rare feature activation)
  - predict(intervals[], sizes[]) -> {nextInterval, expectedSize}

[TF-4] Module: packages/shared/src/forecast/telemetryStore.ts
  - Ring buffer for event log (last 1000 events)
  - Typed events: ToolSwitch, CommandInvoke, FileOpen, SessionStart/End
  - Auto-serialize to localStorage on pagehide (no explicit save needed)
  - load() on init from localStorage

PRIORITY 2 (predictor facade + consumers)
[TF-5] Module: packages/shared/src/forecast/predictor.ts
  - Facade combining all 3 models:
    - ToolSwitch prediction -> Markov chain
    - Session timing prediction -> Holt-Winters
    - Rare feature prediction -> Croston
  - cacheWarmHints(): returns ranked list of {resource, probability}
  - nextTools(): returns top-3 predicted next tools + confidence

[TF-6] Integration: Predictive cache warming
  - Wire cacheWarmHints() -> resource preloader
  - Only preload resources with probability > 0.4
  - Cancel previous preloads when new prediction arrives
  - Execution latency budget: < 2ms (prediction is O(1))

[TF-7] Integration: Adaptive shortcut suggestion
  - Wire tool frequency counter -> "New shortcut available" toast
  - ActionRegistry.registerShortcutSuggestion(id, shortcut)
  - User accepts -> register real handler. User dismisses (3x) -> suppress forever.

PRIORITY 3 (defence)
[TF-8] Test file: forecast/models/*.test.ts
  - 5 behavioural tests + 1 stress test per TDD blueprint

[TF-9] Integration: Cold-start graceful degradation
  - No telemetry -> all predictions return null
  - Cache warming disabled until 50+ events collected
  - localStorage quota exceeded -> drop oldest 25% of events
```

### Feature 3 — Semantic Content Mesh

```
PRIORITY 1 (graph engine)
[SM-1] Module: packages/shared/src/mesh/graph.ts
  - Node/Edge types with adjacency list storage
  - addNode(node), addEdge(srcId, tgtId, type), removeNode(id)
  - BFS traversal with maxDepth param and visited-set dedup
  - O(1) node lookup by ID, O(d) edge enumeration

[SM-2] Module: packages/shared/src/mesh/invertedIndex.ts
  - Term -> Set<NodeId> mapping (lowercased, split on /[\s_-]+/)
  - addToIndex(id, terms[]), removeFromIndex(id), search(term) -> Set<NodeId>
  - Rebuild from scratch in < 50ms for 10K nodes

[SM-3] Module: packages/shared/src/mesh/queries.ts
  - queryByTerm(term, opts?): union of BFS + inverted index
  - getRelated(id, type?): edges from node
  - centralityScore(id): weighted sum of edge count + recency + connection diversity
  - suggestTags(content, graph): matches calendar events, recent files, search history

PRIORITY 2 (data sources)
[SM-4] Module: packages/shared/src/mesh/sources/fileSystemSource.ts
  - Scan recent files from Tauri/WebFS API
  - Extract metadata: name, path, size, modifiedAt, parent folder
  - Add as File nodes + folder containment edges

[SM-5] Module: packages/shared/src/mesh/sources/clipboardRing.ts
  - In-memory ring buffer (last 50 clipboard items)
  - Store MIME type + content preview (<200 chars) + timestamp
  - No persistence (privacy — ephemeral only)
  - Add as ClipboardItem nodes timestamp-ordered

[SM-6] Module: packages/shared/src/mesh/sources/calendarSource.ts
  - Parse .ics files from filesystem (Tauri fs plugin)
  - Extract event title, start/end, attendees, description
  - Add as CalendarEvent nodes + created_by edges to organizer contacts

[SM-7] Module: packages/shared/src/mesh/sources/appInternalSource.ts
  - Walk document asset table -> Asset nodes
  - Walk document search history -> SearchQuery nodes
  - Walk component library -> Component nodes

PRIORITY 3 (rebuild + query facade)
[SM-8] Module: packages/shared/src/mesh/meshFacade.ts
  - Singleton: init(sources[]), rebuild(), query(q), suggest(userContext)
  - rebuild(): async, runs source scans in parallel via Promise.all
  - Auto-rebuild on file change events (debounced 5s)
  - Serialize/deserialize graph to IndexedDB for cold-start speed

PRIORITY 4 (UI consumers)
[SM-9] Integration: Smart file picker
  - Wire suggestRelatedFiles() -> file picker initial filter
  - Show "Suggested" section before "Recent" in file picker
  - Only active when mesh has 10+ nodes

[SM-10] Integration: Auto-tagging on document save
  - Wire suggestTags(documentName, content) -> tag editor pre-fill
  - Shown as discreet badge suggestions (not auto-applied)
  - User taps badge -> tag applied. User ignores -> no action.

PRIORITY 5 (defence)
[SM-11] Test file: mesh/*.test.ts
  - 5 tests per TDD blueprint
  - Stress test: 10K node graph build < 100ms
  - Privacy: clipboard ring never persisted (assert on serialization)

[SM-12] Guard: Privacy controls
  - Opt-in per source type (filesystem, calendar, clipboard, app-internal)
  - Stored in localStorage as string[] of enabled sources
  - On disable: immediately purge that source's nodes from graph
  - UI: Settings -> Privacy -> Content Mesh sources (toggle switches)
```

---

## 5. Cascade Review & Verification (Self-Audit)

### Audit Finding 1: Feature 1 Ambient Context — Signal Source Fragility

**Risk:** `navigator.getBattery()` is deprecated in some Chromium builds (behind flag). `navigator.connection` is undefined in Firefox. The whole system degrades to null signals, making it effectively disabled on ~15% of browsers.

**Remediation:** Every signal source must return `null` (not throw) when the API is unavailable. The fusion layer treats `null` as "use the default." No signal is required. Added to CE-1's acceptance criteria: "All signal sources return `null` when API unavailable — no crashes." Added to CE-2: "fusion produces valid snapshot even when 8/10 signals are null." Tests already guard this (TDD blueprint).

### Audit Finding 2: Feature 2 Telemetry — LocalStorage Quota on Mobile

**Risk:** The 1000-event ring buffer, when serialized with tool transitions + timestamps, can reach 150-300KB. On mobile Safari (iOS), `localStorage` is capped at 5MB total per origin, and the ring buffer alone consumes 6% of that budget. If other components (settings, document drafts, recovery points) also use localStorage, the user could hit quota in a long session.

**Remediation:**
1. Add LRU pruning: when serialized size exceeds 200KB, drop oldest 25% of events before writing.
2. Add `localStorage` quota detection before write: if `navigator.storage.estimate()` shows <500KB remaining, switch to session-only mode (no persist).
3. Compress timestamps: store as deltas from session start (32-bit ints instead of ISO strings), saving ~40% per event.
4. All added to TF-4's acceptance criteria.

### Audit Finding 3: Feature 3 Content Mesh — IndexedDB Write Amplification

**Risk:** Every file system change triggers a mesh rebuild (debounced 5s). With aggressive file watchers (Dropbox syncing, git checkout writing 200 files), the debounce keeps resetting. The user can experience a 10-minute window where the mesh never stabilizes, burning CPU on repeated rebuilds.

**Remediation:**
1. Add a **minimum interval** of 30s between rebuilds regardless of debounce resets.
2. Track per-source `lastChangeTime` — if the source changed <1s before rebuild triggered, skip it (stale-but-close-enough).
3. Partial updates: instead of full rebuild, only add/remove the changed nodes. Only fall back to full rebuild if the change count exceeds 20% of total node count.
4. Added to SM-8's acceptance criteria: "Rebuild skipped if last rebuild was <30s ago."

### Audit Finding 4: Cross-Feature — Network Dependency Creep

**Risk:** Over time, a developer adding "just one quick API call" to enhance a local feature can introduce network dependencies. Example: "let's also fetch Wikipedia data for auto-tags" or "let's validate timezone against a public NTP server." Each addition is individually harmless but collectively reintroduces the latency and failure modes the architecture was designed to avoid.

**Remediation:**
1. **Architecture rule (hard):** All three features must function 100% identically with `navigator.onLine === false`. The test suite must include a mode where all network APIs return "unavailable" and every assertion still passes.
2. **Code review gate:** Any merge request touching the ambient/forecast/mesh modules that introduces an `async` function not deriving from a local/OS API must be flagged.
3. **Doc block:** Top of each feature module: `// NETWORK-DEPENDENCY-STATUS: zero-network — all data sources are local/OS-native. Do not add network calls.`

### Audit Finding 5: Feature 2 — Cold-Start Predictability

**Risk:** Until 50+ events are collected, all predictions return `null`. On a fresh install, the user sees zero benefit from the entire forecasting system until they've used the app meaningfully — potentially hours or days.

**Remediation:**
1. Ship **heuristic priors** as the initial model state: a generic tool-transition probability matrix derived from aggregate behavior (e.g., "after using select, the most likely next tool is select again, then paint, then text"). This is a single JSON blob (~2KB) bundled at build time.
2. The heuristic prior is overridden by actual telemetry after `k` observations per cell (k=3 minimum).
3. Result: the system appears "smart" from first launch, and gets *more* personalized over time rather than going from "dumb" to "smart."
4. Added to TF-5: "predictor returns heuristic priors when telemetry count < 50."

### Audit Finding 6: Feature 1 & 3 — Clipboard as Data Source (Privacy)

**Risk:** Reading clipboard content (`navigator.clipboard.read()`) requires user permission (`<button onclick="...">Paste</button>` or browser permission prompt). On some browsers, it's only available in `secureContext` (HTTPS) and requires transient activation. A feature that silently monitors the clipboard creates trust issues even if the data never leaves the device.

**Remediation:**
1. Feature 1 (Ambient Context) only reads clipboard *content type* metadata (`navigator.clipboard.read().then(items => items.map(i => i.type))`), not the actual data. This requires clipboard-read permission but reveals no content.
2. Feature 3 (Content Mesh) clipboard ring is **opt-in only** (disabled by default). When enabled, it stores only MIME type + length + first 50 chars (truncated). Full content never stored.
3. Feature 3 clipboard ring is **ephemeral only** (not persisted across sessions). TF-4's serialization explicitly filters out clipboard items.
4. UI: Each clipboard-related feature shows a one-time consent dialog: "Allow [App Name] to access clipboard content type for smart paste suggestions? [No, thanks] [Enable]"

### Cost Summary (Operational, Per Feature)

| Item | Ambient Context | Telemetry Forecast | Content Mesh |
|------|----------------|-------------------|--------------|
| Cloud infrastructure | $0/mo | $0/mo | $0/mo |
| Third-party API keys | 0 required | 0 required | 0 required |
| Per-user storage | 0 bytes (transient) | ~200KB localStorage | ~12MB IndexedDB |
| CPU budget (idle) | 0% (event-driven) | <0.5% per prediction | ~2% during rebuild (<100ms) |
| CPU budget (active) | <0.1% | <0.1% | 0% (queries O(1) BFS) |
| Offline capability | Full | Full | Full |
| Private by default | Yes | Yes | Yes (opt-in clipboard/calendar) |
| Time to value | Instant | Gradual (heuristic priors) | After first rebuild (~2s) |

**Total recurring infrastructure cost for all three features: $0.00/mo.**

---

## 6. Implementation Sequencing & ROI

| Phase | Features | Developer-Days | Milestone | ROI Signal |
|-------|----------|---------------|-----------|------------|
| **Phase A** (Week 1) | CE-1, CE-2, CE-3, CE-7 | 3 | Ambient signal layer complete | Demo: "app adapts to battery/network/pen" |
| **Phase B** (Week 2) | TF-1, TF-2, TF-3, TF-4, TF-5, TF-8 | 4 | Forecast engine complete with heuristic priors | Demo: "app predicts next tool from session 1" |
| **Phase C** (Week 3) | SM-1, SM-2, SM-3, SM-8, SM-11 | 4 | Mesh engine + in-app asset auto-tagging | Demo: "cross-document reference suggestions" |
| **Phase D** (Week 4) | CE-4, CE-5, CE-6, TF-6, TF-7, SM-9, SM-10 | 5 | All 3 features wired into UI surfaces | Demos: auto-save adapts, predictive cache warming, smart file picker |
| **Phase E** (Week 5) | SM-4, SM-5, SM-6, SM-7, SM-12 | 3 | All data sources + privacy controls | Demo: calendar-aware tagging, opt-in panel |

**Total: 19 developer-days** for a feature suite that competes with teams spending $2M+/yr on LLM inference. The three features provide **9 distinct demo-able differentiators** for investor presentations, each with zero marginal infrastructure cost and clear competitive moats (local-only, offline-native, privacy-by-design).
