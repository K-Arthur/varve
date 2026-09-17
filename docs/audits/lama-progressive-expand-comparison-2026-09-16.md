# Progressive/iterative Expand vs. the shipped staged-border tiling — 2026-09-16

Status: disposable comparison, real-model evidence, negative result. Tests
whether growing an Expand margin through several smaller passes (each pass
resized/windowed near the boundary, its result feeding the next) beats the
already-shipped spatial-tiling strategy (`'staged-border'` in
`generativeEdit/expandFallback.ts`). It does not: two different faithful
implementations of progressive growth both performed clearly worse than the
shipped strategy on the same real photographs. No production code changed as
a result of this comparison; it is recorded so the idea is not re-proposed
and re-tried without this evidence.

## Question

For a large single-direction Expand margin, would repeatedly (1) resizing/
windowing the region nearest the current boundary, (2) generating a new
increment there, and (3) treating that result as the new source for the next
pass — two or three times, growing the frame each time — produce visibly
better results than the shipped approach? And is the shipped approach
actually what a real user gets for a case like this, or was the earlier
[decode-interpolation check](lama-decode-interpolation-2026-09-16.md)
testing an unrepresentative path?

## Correction to the earlier check

The ten photos in the decode-interpolation check all produced Expand output
frames above `MAX_COHERENT_MODEL_PIXELS` (1,048,576 px in
`expandFallback.ts`), so in production every one of them would already route
through `chooseExpandGenerationStrategy` → `'staged-border'`, not the single
coherent full-frame pass that probe exercised directly. The bilinear-decode
fix remains correct and valuable (`decodeLamaOutput` is shared by every
strategy and every caller), but that check's specific images do not
represent an unmitigated single-shot downscale in current production — the
existing tiling already reduces (does not eliminate) that problem for large
margins. This check corrects that by testing the real `'staged-border'` path
directly.

## What was checked

A faithful reimplementation of `expandFallback.ts`'s private staged-border
algorithm (band construction, `splitRegion` tiling at the same
`MAX_TILE_PIXELS` = 262,144 px, sequential composited-buffer updates so
later tiles see earlier tiles' generated pixels) against the pinned
production LaMa model, compared with two implementations of progressive
growth, on two real photographs with a large single-direction margin (60% of
source width — deliberately larger than the 18% used in the earlier check,
since seam and drift artifacts are most visible at this scale):
`real-life-architecture.jpg` (1920×1280, +1152 px right) and
`real-life-landscape.jpg` (1632×1224, +979 px right).

- **A. Staged (shipped).** As above.
- **B. Progressive, naive.** Grow the margin in 3 steps, each step
  re-expanding the *original* source to that step's cumulative margin in one
  full-frame pass (discarding the previous step's generated border, keeping
  only the original protected pixels). This is what a first attempt at "do
  it 2-3 times" produces if each pass still feeds the whole growing frame to
  the model.
- **C. Progressive, windowed.** The corrected version of what was actually
  asked for: each step extracts only a bounded window near the current right
  edge (320 px of existing content + a margin increment, full source
  height), runs LaMa on that near-native-sized window, and appends only the
  newly generated strip to a growing canvas — so each pass's *input* stays
  close to the model's native 512 px regardless of total margin, and each
  step explicitly conditions on the immediately preceding real/generated
  content rather than a multi-thousand-pixel downscaled frame.

## Result

**A (staged, shipped) was clearly the best of the three** on both photos:
plausible, coherent sky continuation in the architecture case; a
recognizable (if imperfect — see below) continuation in the landscape case.

**B (naive progressive) failed badly on both photos**: the architecture case
produced a large solid black/dark blob overtaking roughly a third of the
generated region; the landscape case produced a corrupted, static-like
color-fringed noise pattern. This matches the literature's documented risk
for naive iterative outpainting — "difficulty capturing global context" and
"a tendency to generate unnatural patterns" (see Sources) — LaMa is a
reconstruction model with no semantic conditioning to anchor it, so once a
pass has nothing but its own prior (imperfect, still-downscaled) generation
as context, errors compound rather than self-correct.

**C (windowed progressive) also failed, differently**: both photos produced
a large solid black region across most of the generated area, not noise.
Root cause: the window was full source height (1280 px / 1224 px) by a
narrow width (704 px / 647 px) — an extreme, very tall aspect ratio. Letterboxing
that into a 512×512 square compresses the dominant (height) axis by roughly
2.5×, which appears to destroy enough vertical structure that the model
collapses toward one dominant tone (the darker portion of the window)
instead of preserving the sky-to-structure transition. This is a probe
design flaw, not necessarily proof that no windowed variant could work — a
version that also tiles the height dimension (much closer to what
`splitRegion` already does for staged) might avoid this specific failure —
but that is no longer "2-3 progressive passes," it is closer to
re-deriving the shipped tiling strategy from a different starting point.

**Staged is not artifact-free**: the landscape case showed visible
horizontal banding in the sky region, consistent with a seam between two of
the five vertically-stacked tiles `splitRegion` produced for that band. This
is a real, distinct, smaller finding — noted here for a future pass, not
fixed in this session.

## Conclusion

Do not implement progressive/iterative margin growth for the local LaMa
Expand path. Two different faithful attempts — one matching a naive "just
repeat the full-frame pass" reading of the idea, one matching the "resize
the near-boundary region, generate, repeat" reading actually requested —
both produced clearly worse, sometimes badly broken results than the
already-shipped spatial tiling on the same real photographs. The shipped
`'staged-border'` strategy already does the core thing this idea was
reaching for — keep each model pass close to native resolution instead of
one huge downscale — without LaMa's context-free iteration risk, because its
tiles derive their context from the original real frame (each independently,
with shared overlap padding) rather than from each other's generated output.

The one real, evidenced opportunity from this comparison is narrower than
originally proposed: **tile-seam banding in staged-border for very large,
many-tile margins**, observed once here (the landscape case). That is worth
a future look — likely feathered blending across tile boundaries, or wider
shared context between adjacent tiles — but is a distinct, smaller task from
progressive growth and was not implemented in this session.

## What this is not

- Not a claim that progressive outpainting never works — it is a documented,
  real technique (see Sources) for diffusion-based, prompt-conditioned
  models that can use semantic guidance to stay coherent across steps. LaMa
  has no such conditioning; this result is specific to LaMa's reconstruction
  approach, not a general verdict on the technique.
- Not an exhaustive parameter sweep — window size (320 px), step count (3),
  and margin fraction (60%) were fixed choices, not tuned. A differently
  windowed/tiled progressive design might avoid the specific failure found
  here, but building and qualifying that is a materially larger effort than
  this comparison and is not warranted by the evidence so far.
- Not a change to any production code — `expandFallback.ts` is unmodified by
  this check.

## Sources

- [Outpainting: expanding image boundaries — Runware Docs](https://runware.ai/docs/learn/image-outpainting)
- [High-Resolution Artwork Outpainting with Global Blueprint Guidance and Layout Control (arXiv 2607.06162)](https://arxiv.org/html/2607.06162)
- [ProOut: Progressive Artwork Outpainting via Latent Diffusion Models (ICCV 2025)](https://github.com/EadCat/ProOut)
