# ADR-0215: Animated image / media timeline system

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Varve can import GIF/APNG/WebP as static images only (animated GIF is
explicitly rejected at `@varve/import`; animated APNG/WebP silently import as
frame 0). There is no media timeline: playback clocks are property-animation
only (`TimelineEngine`), the render IR is time-blind, `ImageCache` serves
`HTMLImageElement`s, and WebKitGTK has no `ImageDecoder`. The audit
(`docs/audits/animated-image-media-current-state-2026-08-09.md`) confirms the
gaps. We need first-class animated-image support — import, display, scrub,
preview, synchronize with the motion timeline, export — without weakening the
existing keyframe architecture or regressing static images.

## Decision

### D1 — Animated media is a time-addressable asset capability, not keyframes

Original encoded bytes stay authoritative in `Document.assets`. An optional
`animated?: AnimatedAssetMetadata` on `DocumentAsset` (schema 2.19, additive)
carries probed container metadata: kind, frame count, canvas dims, loop count,
per-frame `{durationMs, rect, blend, disposal}`, decoder version. Full RGBA
frame sets are never serialized; decoded/composited frames are disposable
cache state. Per-usage media settings (`ImageFillData.media`:
loopMode/rate/startOffset/inPoint/outPoint/posterFrame) make one asset
re-usable with independent phases while sharing bytes and metadata. Media
frames never become `AnimationTrack` keyframes.

### D2 — One deterministic pipeline, one compositor

`(document time, usage settings, asset timing)` ⇒ one displayed frame, in
canvas, thumbnails, static export, video export, tests. Playback is driven by
the existing editor clock (media time slaved to `motion.currentTime` while the
motion timeline plays; an independent media clock only when playing from the
inspector outside Motion mode). Disposal/blend/rect composition semantics
live in exactly one TS module (`packages/engine/src/media/compositor.ts`),
shared by every provider; providers return source frames
(rect + RGBA + timing + disposal/blend hints) and only
pre-composited full canvases where the underlying decoder cannot expose raw
frames (WebP, Chromium `ImageDecoder`). No `<img>` autoplay anywhere.

### D3 — Decoder provider chain

`ImageDecoder` (Chromium: GIF/WebP/AVIF) → native Tauri IPC
(`crates/varve-media`, gif 0.14 + png 0.18 APNG + image-webp 0.2, both already
in the lockfile) → WASM (same crate via wasm-bindgen glue in `varve-wasm`) →
pure-TS GIF decoder (web fallback and node-env golden path). Ordering is
runtime-dependent (`traceDispatch` pattern); WebKitGTK lands on native. All
decoding is bounded (128 MiB / 65 535 px / 64 MiPixels / 10 000 frames /
decoded-bytes pre-check) and malformed input yields typed errors, never
panics.

### D4 — Time → frame and composition infrastructure

Cumulative timing table with O(log n) binary-search lookup and exact boundary
semantics; zero-duration collapse policy; reverse playback expressed as rate
< 0. A byte-budgeted LRU composited-frame cache
(key: assetId + frame + decoderVersion + decode size + color policy; budgets
from `memoryBudget.ts` tiers), an evictable checkpoint store (stride 32,
shared 8 MiB budget) so seek doesn't replay from 0, and a scheduler with
request dedup, generation-token cancellation (stale results never install),
direction-aware prefetch, and scrub batching (latest request wins).

### D5 — Rendering integration with minimal invalidation

Per-usage resolved frame rides in `FillIR.image.frame`; animated-image nodes
join the IR-cache exclusion set (the existing motion `animatedNodeIds`
mechanism), so only their small per-node IR rebuilds per frame — no whole-scene
invalidation. A single main-thread replay seam (`resolveReplayImage` media
hook) serves the current frame to paint paths, masks, warps, mockups,
thumbnails and export; it is a no-op fast path when no animated assets exist.
The redraw coordinator bumps a `mediaStamp` only when some usage's resolved
frame actually changed (per-usage last-presented bookkeeping); a node on a
500 ms source frame does not invalidate every RAF. Scenes containing animated
fills render on the main thread in v1 (worker exclusion is conservative;
per-frame worker bitmap transport is a follow-up). Offscreen usages skip
decode/prefetch while logical time advances.

### D6 — Schema, import, export

- Schema 2.19 migration is additive and idempotent: it only adds optional
  fields (`DocumentAsset.animated`, `ImageFillData.media`); old static
  documents are untouched and validate unchanged. Canonical hash key order
  updated.
- Import: the animated-GIF rejection is lifted; content-level probing
  (GIF: GCE/Netscape/rects; APNG: acTL/fcTL; WebP: VP8X/ANIM/ANMF) accepts
  animated and static variants without false positives. Static remains static.
- Export: static exports use an explicit poster policy (usage posterFrame,
  default 0); video export resolves media at each sample time (deterministic,
  wall-clock independent); media-to-GIF export uses the source timing table.
  APNG/animated-WebP export is a documented follow-up.

### D7 — UI

Inspector "Animation" section (play/pause, scrub, duration/frame count, loop
mode, speed, start offset, in/out trim, poster, Previous/Next Frame), a
virtualized duration-proportional frame strip in the timeline when an animated
image is selected (uniform-frames toggle, keyboard access, ARIA labels, no
input stealing), a Layers-panel "Animated · N frames" badge, deterministic
poster thumbnails, and opt-in diagnostics. Reduced motion: passive previews
static; explicit Play allowed.

### D8 — Out of scope for v1 (design reserved)

Editable frame animation (convert/deleting/reordering/painting frames),
media onion skin, animated-AVIF import, worker-renderer support for animated
fills, downscale decode, APNG/animated-WebP export. Each is a documented
follow-up; the model above is designed so they slot in without schema churn.

## Consequences

- Static images: zero behavior change; media machinery is metadata-gated.
- Playback creates no undo/autosave entries (editor runtime state only,
  `patch()` like the motion tick).
- Deterministic rendering/export: video output independent of wall clock and
  machine speed.
- Native decoding on Linux/WebKitGTK satisfies the mandatory desktop path;
  WASM and TS-GIF cover the web; Chromium uses ImageDecoder where beneficial.
- The property-animation timeline and the media timeline are separate
  concepts that share one clock and one canvas — no clock proliferation.
