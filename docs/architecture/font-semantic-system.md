# Font Semantic System

Status: implemented foundation (2026-09-01)

This document defines Varve's provider-independent semantic layer for font
discovery. It sits above exact font identity and runtime loading. A provider
catalog can supply facts, but it does not define Varve's vocabulary or ranking
contract.

## Goals and boundaries

The system supports four related but separate workflows:

- local discovery by family name, natural-language intent, tags, coverage,
  features, source, availability, and numeric metrics;
- explainable similarity between families;
- alternatives that preserve useful metrics while allowing a different
  construction;
- pairing suggestions where the requested role and contrast are explicit.

Similarity, alternatives, and pairing are separate APIs in
`packages/engine/src/font/semantic/semanticRecommendations.ts`. A result from
one lane must not be presented as another lane merely because it scored well.

The semantic layer does not replace `FontIdentity`, the runtime
`FontRegistry`, or the exact Fontsource artifact resolver. It also does not
pretend that an unmeasured property is false.

## Canonical data model

`FontSemanticRecord` is the family-level discovery record. It carries the
family identity, aliases, source and availability, weights, styles, axes,
scripts, languages, OpenType features, licensing metadata, user state, and a
`FontSemanticProfile`. Profiles can be scoped to a family, face,
variable-instance, or artifact. This lets family discovery coexist with
face-specific facts such as an italic style or a color glyph table.

Every semantic assignment contains:

- a namespaced ontology id;
- its scope;
- source (`provider`, `font-table`, `measured`, `derived-rule`, `curated`, or
  `user`/`project`);
- evidence strength and optional confidence;
- evidence details suitable for an explanation;
- ontology and analyzer versions;
- whether a user override is allowed.

The profile also records unknown fields and unresolved conflicts. The values
`unknown`, `unavailable`, `not-analyzed`, `not-applicable`, and `conflicting`
remain distinct from a known negative result.

## Ontology

Ontology identifiers are stable and namespaced. The current v1 vocabulary
covers:

- classification: serif, sans, humanist, geometric, grotesk, monospace,
  display, handwriting, script, symbol;
- morphology: rounded, angular, high/low contrast, open aperture, condensed,
  wide, tall x-height, short/long ascenders and descenders;
- tone and use: formal, friendly, neutral, editorial, playful, technical,
  compact UI, body text, display, branding, code, signage, accessibility;
- era and feature: historical periods, variable axes, italics, small caps,
  tabular/oldstyle numerals, ligatures, optical sizing, and color glyphs;
- coverage: scripts, languages, and multilingual support;
- source and role: Fontsource, open-source, installed, downloadable, and
  semantic roles.

Aliases are mapped to one canonical id by `semanticOntology.ts`. A bare word
such as `script`, `modern`, or `display` can be ambiguous; the parser reports
that ambiguity instead of silently selecting one interpretation.

`FontCatalogEntry.tags` remains supported. Legacy face tags migrate through
`migrateLegacyFontCatalogTags`, grouped by normalized family name and merged
into the persistent user layer without mutating the old catalog.

## Enrichment and provenance

Enrichment is deterministic and provider-independent:

1. Fontsource facts populate category, coverage, weights, styles, axes,
   license, version, and download state from the shipped catalog.
2. OpenType parser output populates face-level scripts, features, variable
   axes, color tables, and measurable metrics when bytes are available.
3. Derived rules add bounded interpretations such as multilingual support.
4. A small curated annotation file records reviewed specimen observations. It
   is evidence-labeled curation, not an assertion that a family is universally
   suitable for accessibility or a particular brand.
5. User and project tags are stored separately from provider and derived facts.

The shipped Fontsource snapshot is read locally. Ordinary search does not
contact Google Fonts, Fontsource metadata APIs, or another provider. Desktop
installation is a separate, explicit action that resolves one exact,
version-pinned Fontsource artifact. The browser demo can inspect and rank the
catalog but cannot download font files.

## Query and ranking contract

`parseFontSemanticQuery` produces a bounded AST. It recognizes exact family
terms, ontology aliases, `with` hard constraints, `without` exclusions,
availability, coverage, feature and metric ranges, and references such as
`similar to Inter` or `same width as Georgia`.

Reference phrases are explicit relations in the AST. Similarity contributes a
local tag/measurement signal; same-width compares measured width when both
families have it; and “less formal than” excludes a known formal assignment.
An absent reference or absent measurement is surfaced as unknown according to
the selected strictness.

Hard constraints are never traded against a high score. A candidate is either
accepted, rejected, or marked unknown. In balanced mode an unknown hard fact
can remain as an explicitly unverified result with a penalty and reason. Strict
mode removes unknowns. Exclusions only remove a candidate when the excluded
property is known to be present; missing metadata is not treated as proof.

The deterministic ranker combines exact family match, metadata text, required
constraints, preferred semantic tags, availability, user tags, and measured
features. Ties are resolved by family name and family id. Diversity is a
bounded presentation adjustment, not a semantic override. Every result carries
reasons and provenance suitable for the browser's “Why this result” panel.

## Catalog, persistence, and reactivity

`FontSemanticCatalog` is the one reactive discovery index consumed by the full
Font Browser and compact `FontSelector`. It combines the shipped Fontsource
records with `FontRegistry` faces and deduplicates by normalized family name
for presentation while retaining stable family ids and face profiles.

User tags, project tags, hidden tag overrides, favorites, and recent-use state
are stored under the versioned `varve-font-semantic-user-v1` local key. Storage
is best-effort: malformed or unavailable storage produces an empty user layer
and never blocks search. Search and ranking are synchronous and side-effect
free; registry/catalog revisions notify mounted consumers through the standard
external-store subscription pattern.

## Performance and model gate

The first implementation is deliberately deterministic. It uses indexed local
metadata and bounded result sets; it does not ship an embedding model. An
optional local model may be considered only after a representative licensed
font specimen corpus, a fixed recall/precision and pairwise-preference suite,
latency/memory measurements, and an explicit user-visible value comparison
show that it improves discovery enough to justify its footprint. A model must
remain an additional signal with provenance, never the only explanation or a
replacement for hard constraints.

## Known limits

- Most Fontsource records have provider facts and curated coverage but no
  measured glyph-shape vector until the font is parsed locally.
- Visual words such as “warm” or “premium” are intentionally conservative and
  do not claim objective truth.
- License metadata is surfaced for inspection; it is not legal advice.
- Pairing is a deterministic role heuristic until a measured, reviewed corpus
  exists.
- The current UI exposes the core semantic query and explanation flow; richer
  editable facet controls and full face/variable-instance exploration remain
  follow-up work.
