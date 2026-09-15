# Candidate-ranking evaluation

Status: **instrumentation and policy mechanics shipped** (2026-09-15); the
real-model frozen corpus run is **pending** (see "Evidence status").

Canonical modules:

| Module | Role |
| --- | --- |
| `packages/engine/src/segmentation/candidateRanking.ts` | Bounded per-candidate features, declared ordering policies, top-1/oracle/regret/top-k metrics |
| `packages/editor/src/context/promptedMaskValidation.ts` | The real ranker; validation filter plus ordering (`reviewed-score` default, engine policies for evaluation) |
| `packages/editor/src/context/promptedRankingEvaluation.ts` | Frozen-set evaluation through the real ranker, including human-annotated real-photo sets |
| `packages/engine/src/segmentation/quality/providerAb.test.ts` | Gated real-model harness that emits frozen candidate sets (RLE masks, scores, oracle IoU, features) |

## Generation and ranking are separate failures

A promptable provider can fail in two independent ways:

1. **Generation** — the acceptable mask is never produced. Ranking cannot fix
   this; the prompt/backend/refinement path or the provider itself is the
   repair site.
2. **Ranking** — an acceptable mask exists but is not selected. This is what
   the ranker can fix, and the archived A/B run measured it: the providers'
   own top candidate matched the oracle-best only 20–40% of the time, with a
   mean IoU regret of 0.043–0.067. Those are *provider* choices; the editor
   ranker adds prompt-agreement filtering on top.

## Declared metrics

| Metric | Definition | Role |
| --- | --- | --- |
| automatic top-1 IoU | IoU of the candidate the runtime chooses by itself | automatic |
| best-available IoU | max over the candidate set (oracle over candidates) | reference |
| regret | best-available − top-1 | automatic |
| acceptable | regret ≤ 0.10 or human annotation | declared band |
| top-k recall | cases whose first acceptable candidate is within k of the policy order | evaluation |
| clicks/cycles | cycles to reach the first acceptable candidate | interaction |
| per-category tails | the same metrics per corpus category with sample counts | evaluation |

No cross-metric composites are used. Human-annotated sets replace the IoU
band with explicit acceptable/best indices; the evaluator never infers intent
from a score.

## Policies

| Policy | Ordering rule |
| --- | --- |
| `reviewed-score` (default) | validation filter, then complete candidates before refinement-needed ones, then provider score descending, stable |
| `score` | provider score descending (baseline) |
| `guarded-band-box` | prompt-agreement grouping, then score within a 0.02 band broken by box-overlap fraction |
| `guarded-band-area` | same, broken by mask area fraction (evaluated only; not a default) |

Area is deliberately never a universal preference. Both band policies only
reorder candidates whose scores are already equivalent, and only after prompt
agreement. Coverage is never reduced: no policy drops a candidate from review
or keyboard cycling.

## Methodology

- Frozen candidate sets isolate the ranker from generation; the same sets are
  then replayed through the real ranker function so no replica can drift. An
  agreement test asserts the evaluator's order matches the ranker's selection
  for every policy.
- Tuning data and evaluation data must not share source images; the synthetic
  corpus is the development set, and the real-photo annotations are the
  held-out check for any default change.
- The harness computes features and oracle IoU once and writes them to the
  evidence JSON; re-evaluation never re-runs an encoder.

## Evidence status

- **Real-model frozen sets measured (2026-09-15).** Both pinned providers were
  re-run through the gated harness (MobileSAM 25 s, SAM2 41 s; one provider at
  a time to stay inside the machine's memory budget). The archived
  provider-selection baseline is weak exactly as reported: the provider's own
  selected candidate matched the oracle-best 20% (MobileSAM) / 40% (SAM2) of
  the time with mean IoU regret 0.036 / 0.067; selecting the highest predicted
  IoU already lifts acceptance to 80%.
- **Policy comparison on a deterministic dev/held-out category split**
  (`docs/quality/ranking-evidence-2026-09-15.json`):
  - MobileSAM dev: `guarded-band-box` raises top-1 IoU 0.8254 → 0.8482,
    regret 0.0268 → 0.0040, acceptance 80% → 100%.
  - MobileSAM held-out: `guarded-band-box` equals `score` (top-1 0.6253,
    regret 0.1031, acceptance 60%).
  - SAM2 dev and held-out: `guarded-band-box` equals `score`; the default
    `reviewed-score` slightly exceeds both on the held-out half (top-1 0.6809
    vs 0.6747) because it prefers complete candidates over refinement-needed
    ones.
  - Coverage and rejection counts are identical across policies in every run.
- **Decision:** the default stays `reviewed-score`. The guarded policy never
  regresses and clearly helps the MobileSAM development half, but it does not
  demonstrate a held-out gain, so per the promotion criteria below it is not
  enabled. Residual failures are generation-side: worst-case regret is 0.267
  (MobileSAM, held out) and 0.395 (SAM2, held out), concentrated in
  glass/translucency and edge-touching subjects where the best available
  candidate is itself poor.
- **Verified mechanics:** `candidateRanking.test.ts` (14 tests) and
  `promptedRankingEvaluation.test.ts` (4 tests) on synthetic frozen sets,
  including a part-vs-whole case where the default picks a 0.6-IoU mask and
  the band policy picks the 0.9-IoU one without dropping coverage. The gated
  `promptedRankingRealEvidence.test.ts` replays real fixtures and fails if a
  guarded policy regresses against `score` on the held-out half.
- **Still pending:** human-annotated real-photograph sets (explicit
  acceptable/best indices) to validate the direction on photographic
  ambiguity rather than synthetic categories. Until they exist, no ranking
  claim is published to users.

Regenerate the evidence:

```bash
# One provider at a time keeps the harness peak near 1.5-2 GB.
VARVE_MOBILE_SAM_MODEL_DIR=/tmp/opencode/acly \
VARVE_RANKING_FIXTURE_PATH=/tmp/opencode/ab-mobile-ranking.json \
  pnpm exec vitest run packages/engine/src/segmentation/quality/providerAb.test.ts

VARVE_RANKING_FIXTURE=/tmp/opencode/ab-mobile-ranking.json \
VARVE_RANKING_REPORT=reports/ranking/ranking-evidence.json \
  pnpm exec vitest run packages/editor/src/context/promptedRankingRealEvidence.test.ts
```

## What would justify changing the default

1. Held-out mean top-1 IoU improves or mean regret drops; and
2. worst-category regret does not regress; and
3. coverage (acceptance reachable within the set) does not drop; and
4. the change survives the real interaction path (candidate ordering in the
   UI, cycling, apply commits the visible mask).

If the evidence shows the best-available masks themselves are poor in a
category, the finding is recorded as a generation limitation and the ranker is
left alone.
