# ADR-0221: Local asset search ranking and model gate

- Status: Accepted for Phase 1; semantic model selection pending benchmark and
  legal review
- Date: 2026-08-13

## Context

Varve needs a natural-language asset search experience that improves discovery
without weakening exact filename, OCR, or metadata queries. The repository has
an Asset Browser and platform facade, but asset records are currently mostly
metadata and the existing SigLIP integration exposes only image-to-image
similarity. The assistant package is not the right owner for ordinary asset
retrieval.

## Decision

1. Keep search in the platform/asset-browser boundary, separate from
   `@varve/ai` chat orchestration.
2. Normalize the query and retrieve independent filename/path, OCR, metadata,
   and optional semantic lanes.
3. Fuse ranks with Reciprocal Rank Fusion. Do not sum raw cosine, fuzzy, OCR,
   or BM25-like scores. Exact filename/stem matches receive an explicit stable
   ordering guarantee.
4. Store future vectors as binary records keyed by content hash, model
   identity, preprocessing version, and embedding schema version.
5. Benchmark exact vector scans before adding an ANN index.
6. Do not ship or automatically download a checkpoint until source license,
   checkpoint terms, redistribution rights, conversion provenance, tokenizer,
   preprocessing, parity, and Varve-corpus quality are all recorded.

## Consequences

The Home browser works today with deterministic local metadata lanes and can
accept OCR/semantic signals later without changing its result contract. A
semantic model is not falsely implied by the search box. The short-term cost is
that descriptive visual queries do not yet retrieve images without semantic
embeddings; this is preferable to shipping an unvalidated model or routing
search through an LLM.

## Rejected alternatives

- Raw score summation: scales are incomparable and exact matches regress.
- Chat/LLM-owned search: adds latency, privacy risk, and an unnecessary network
  or assistant dependency to a local retrieval path.
- Path-only embedding keys: renames and duplicates waste indexing work, while
  edits can reuse stale vectors.
- OpenAI CLIP selected from repository MIT alone: the model card contains
  deployment limitations, and code/model terms are not interchangeable.
- Immediate ANN adoption: the normal designer library size and exact-scan
  breakpoint have not been measured.

