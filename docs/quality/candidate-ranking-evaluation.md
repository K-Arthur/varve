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

- **Verified now:** policy mechanics, metric definitions, order/selection
  agreement, rejection accounting, per-category tails — `candidateRanking.test.ts`
  (14 tests) and `promptedRankingEvaluation.test.ts` (4 tests) on synthetic
  frozen sets, including a part-vs-whole case where the default policy picks a
  0.6-IoU mask and the band policy picks the 0.9-IoU one without dropping
  coverage.
- **Pending:** the real-model harness run that freezes SAM2/MobileSAM/
  EfficientSAM candidate sets from the corpus, plus human-annotated real-photo
  sets. Until those exist, the **default remains `reviewed-score`** and no
  ranking-quality improvement is claimed. Run:

  ```bash
  VARVE_SAM2_REAL_MODEL_DIR=/path/to/sam2 \
  VARVE_MOBILE_SAM_MODEL_DIR=/path/to/mobile \
  VARVE_EFFICIENT_SAM_MODEL_DIR=/path/to/efficient \
    pnpm exec vitest run packages/engine/src/segmentation/quality/providerAb.test.ts
  ```

  Then evaluate the frozen fixture with
  `pnpm exec vitest run packages/editor/src/context/promptedRankingEvaluation.test.ts`
  once a fixture-backed case file is added, or point `VARVE_RANKING_FIXTURE`
  at the generated JSON.

## What would justify changing the default

1. Held-out mean top-1 IoU improves or mean regret drops; and
2. worst-category regret does not regress; and
3. coverage (acceptance reachable within the set) does not drop; and
4. the change survives the real interaction path (candidate ordering in the
   UI, cycling, apply commits the visible mask).

If the evidence shows the best-available masks themselves are poor in a
category, the finding is recorded as a generation limitation and the ranker is
left alone.
