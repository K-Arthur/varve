# DTCG 2025.10 — Interoperability Evidence Ledger and Coverage Matrix

- **Date:** 2026-09-25
- **Status:** Accepted (research + audit record for the DTCG completion pass)
- **Scope:** Primary-source verification of the standards baseline, third-party
  interoperability evidence, and a module-by-module coverage matrix of Varve's
  implementation. Written before the repair pass so defects are recorded against
  a fixed baseline.

## 0. Standards baseline (verified, not assumed)

| Source | Accessed | Version / status | Requirement or behavior |
| --- | --- | --- | --- |
| `https://www.designtokens.org/technical-reports/` | 2026-09-25 | **2025.10 — Stable, published 2025-10-28**; "Preview" is separately listed as *Experimental* | 2025.10 is the stable target; `/TR/drafts/` is explicitly experimental and must never be implemented as stable |
| `https://www.designtokens.org/TR/2025.10/format/` | 2026-09-25 | **Final Community Group Report, 28 October 2025**, "considered stable"; *"not a W3C Standard nor … on the W3C Standards Track"* | Format module normative text (names, `$type` inheritance, `$root`, `$extends`, references, types) |
| `https://www.designtokens.org/TR/2025.10/color/` | 2026-09-25 | Final Community Group Report, 28 October 2025, stable | 14 color spaces; `components` elements MUST be number or `none`; `alpha` optional, defaults to 1; `hex` optional 6-digit **fallback** |
| `https://www.designtokens.org/TR/2025.10/resolver/` | 2026-09-25 | Final Community Group Report, 28 October 2025, stable | Resolver documents: `version`, `sets`, `sources`, `modifiers`, `resolutionOrder` |
| `https://www.designtokens.org/schemas/2025.10/format.json` | 2026-09-25 | Official-domain schema (DTCG repo, PR #412, 2026-06-10); **draft-07**; self-describes `$schema` as *"not part of the official DTCG specification"*; the frozen 2025.10 report still carries the editor's note *"exploring the addition of a JSON Schema"* | Useful as an **independent consumer check**, never as the normative definition |
| DTCG repo history (`git log -S '$version'`, 2021-02-03 → 2026-09-08) | 2026-09-25 | all versions | **`$version` has never existed in DTCG**; official schema rejects it at token and document level |

Normative vs non-normative: only `MUST` / `MUST NOT` / `MAY` (BCP 14) are
normative. Component **range tables** in the Color module sit without a `MUST`
to reject, and §5 "Gamut mapping" opens *"This section is non-normative."*
There is **no normative requirement to reject out-of-range components**;
behavior on `hex`/`components` mismatch is **not specified**.

### Correction applied in this pass

Earlier project text called the Format module a *"Draft Community Group Report
(published 2026-07-30 snapshot)"* (`docs/tokens/dtcgsync-architecture.md`,
`packages/tokens/src/spec.ts`). Both the report type and the date were wrong.
Corrected to Final Community Group Report, 2025-10-28.

## 1. Third-party evidence ledger

Access date for all rows: 2026-09-25. "Version it refers to" is the format the
source actually describes, not the label it uses.

| Source | Date | Version it actually refers to | Observed behavior / requirement | Relevance to Varve | Proposed acceptance test |
| --- | --- | --- | --- | --- | --- |
| styledictionary.com/info/dtcg | 2026-09-25 | v4 = pre-2025.10 draft; 2025.10 = WIP in v5 | "First-class DTCG since v4"; *"the latest format 2025.10 does not have full support yet"* | Do not equate "Style Dictionary supports DTCG" with 2025.10 | N/A (external) |
| Style Dictionary #1590 | opened 2025-11-04, live 2026-09-18 | 2025.10 | color/border/shadow/dimension shipped; **gradient, duration, `$extends`, JSON Pointer `$ref`, resolvers unsupported** | Confirms `$extends`/`$ref` are the discriminating 2025.10 features; Varve must keep them | Fixture with `$extends` + `$ref` parses, resolves, and round-trips in Varve |
| Style Dictionary probe (SD 5.5.5) | 2026-09-25 | 2025.10 | `$root` OK; **`$ref` token silently dropped**; `$extends` not applied; `$version` silently ignored | A "successful" round trip through a weak consumer proves nothing | Independent-consumer check must be paired with a strict parser (Varve's own + official schema) |
| docs.tokens.studio/manage-settings/token-format | 2026-09-25 | unversioned (links living draft) | "W3C DTCG" = `$`-prefix + name rules; default is legacy format; *"additional token types … future releases"* | Tokens Studio's "DTCG" toggle ≠ 2025.10; Varve must not claim Tokens Studio = 2025.10 | Adapter capability report marks Tokens Studio profile as partial |
| Tokens Studio #3615 / PR #3640 | 2025-10-03 / 2025-10-13 (PR closed unmerged) | group `$description` | Group-level `$description` unsupported | Lost descriptions are a live ecosystem failure | Fixture: group `$description` survives Varve import → edit → export |
| Tokens Studio #3465 | 2025-07-22, open | `number` type | Numbers saved as JSON strings | Type fidelity check | `number.$value` must be a JSON number in export |
| Tokens Studio #3778 | 2026-02-16, open | aliases | Export flattens alias references | Flattening is the top interop complaint class | Alias fixture exports with `{…}` references intact (default profile) |
| Figma help "Modes for variables" | edited 2026-06-24, updated 2026-09-24 | **2025.10** (links `TR/2025.10/format`) | Native DTCG **import**; limited type set (sRGB/HSL colors, px-only dimension, single-string fontFamily, s-only duration); slash-normalizes names and **drops duplicates silently**; export format unspecified | Vendor dialect limits must be reported per type, not as one boolean | Capability matrix records Figma profile: partial types, duplicate-drop warning |
| Figma forum 48474 | 2025-12-10, unresolved | "DTCG based Variables Export" | `description` missing from variables export | Complaint (not verified product behavior); motivates description-preservation tests | Description round-trip test (scenario D) |
| Penpot forum 10544 | 2026-05-04 (+staff 2026-05-05) | 2025.10 vs Tokens Studio | Export is **Tokens Studio multi-set**, not 2025.10; 9 transforms needed | Penpot's "DTCG" claim and its output shape diverge | N/A (external); informs adapter profile naming |
| Penpot forum 9946 | 2025-10-06; Penpot reply 2025-10-07 | `$extensions` | Extensions **preserved but never applied** | Preserve-without-interpretation is the correct default | Unknown `$extensions` survive import → edit → export |
| Penpot blog / help | 2026-04-14 / 2026-09-25 | claims 2025.10 | Documents `$metadata`/`$themes` (Tokens Studio envelope) | Claim ≠ shape; same failure mode Varve must avoid in its own labels | Varve export must not carry a version field it does not understand |
| terrazzo.app/docs + releases | 2026-09-25; 2.0 shipped 2026-03-17 | 2025.10 | Strongest vendor claim; `$extends` merged 2025-12-15; font-weight 1–1000 fix open (#842, 2026-09-18) | Best candidate for an independent consumer check | Optional: validate Varve export with `tz check` when runnable |
| DTCG official schema probe (ajv) | 2026-09-25 | 2025.10 schema | **`$version` INVALID at token and top level**; valid inside `$extensions` | Directly falsifies Varve's previous UI export | `dtcgExport()` must validate clean against the official schema |

### Sources not accessible

- Authenticated Figma / Penpot / Tokens Studio runs were not performed; those
  rows are docs/forum/issue evidence only.
- Figma's exported file contents (format, presence of `description`) remain
  **unverified** — the help article names no export format.
- Terrazzo was not executed against a 2025.10 corpus in this session.

## 2. Varve coverage matrix (baseline, 2026-09-25)

Cells: **V** verified · **P** partial · **X** unsupported · **B** broken ·
**U** unverified. "Retained without interpretation" is not rendering support.

| Module / workflow | parse | validate | retain | resolve | edit | bind | render | serialize | external interop |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Format: tokens, `$type` inheritance, names, `$root` | V | V | V | V | X | P | U | V | U |
| Format: `$extends` groups | V | V | P | V | X | X | U | P | U |
| Format: curly `{path}` aliases | V | V | V | V | P | P | U | V | U |
| Format: JSON Pointer `$ref` | V | V | V | V | X | X | U | V | U |
| Color module (14 spaces, `none`, `hex` fallback) | V | P (range errors over-strict; hex-string form silent) | V | V | X | P | P | V | U |
| Composites (border/shadow/gradient/transition/typography/strokeStyle) | V | V | V | P | X | P | P | V | U |
| `$description` / `$deprecated` / `$extensions` retention | V | V | V | – | X | – | U | P (canonical path) | U |
| Resolver module (sets/modifiers/`resolutionOrder`) | V (engine) | V | U | V (engine) | X | X | U | U | **B — never routed from the UI** |
| Document ↔ token store (`tokenSync`) | – | – | V | – | P | P | U | V (doc round-trip) | – |
| Import workflow (first use) | P | P | P | – | – | – | – | – | **B — no source/store initialization path** |
| Import workflow (existing source) | P | P | P | – | – | – | – | – | P (first-source selection only) |
| Preview identity / freshness / cancel | – | – | – | – | – | – | – | – | **B — session-global cache keyed by file name** |
| Export document tokens to DTCG | – | – | – | – | – | – | – | **X — no app path** | **X** |
| Varve UI-token DTCG export (`@varve/ui`) | – | – | – | – | – | – | V (tokens.css) | **B — `$version`, timestamp, unnamespaced extensions** | B |
| Three-way merge / conflict review | V | V | V | V | U | – | – | U | U |
| File watching / atomic writes | U (engine + reducer implemented; **no platform wiring**) | | | | | | | | |

Rows marked **B** are the ranked defect list for this pass (see §3).

## 3. Ranked defects (baseline severity)

| Rank | Defect | Class | Evidence |
| --- | --- | --- | --- |
| 1 | First import into a fresh document is unreachable: nothing in application code ever creates `VariableStore.tokenSync` or a token source | workflow blockage | `addSource` / `createEmptyTokenSynchronization` have zero non-test callers; `buildImportPreview` returns `added: 0` + "No token source connected yet" |
| 2 | Apply announces success even when the transaction was a no-op | data-integrity / trust | `TokenSyncPanel.tsx` returns `doc` unchanged when `tokenSync` is missing, then `announce("Imported…")` |
| 3 | `.resolver.json` is accepted by the picker but parsed by `parseFormatDocument` | workflow blockage / standards | `parseResolverDocument` has no application caller |
| 4 | Apply silently uses the first source in the map | correctness | `Object.keys(sync.store.sources)[0]` |
| 5 | Preview cache is module-global and keyed by `file.name` | data-loss / identity | two same-named files, documents, or windows collide; cancel never releases bytes |
| 6 | `dtcgExport()` emits `$version` (out-of-spec), a `Date` timestamp (non-deterministic), and non-namespaced `$extensions` keys | standards correctness | official 2025.10 schema rejects `$version`; DTCG requires vendor-namespaced extension keys |
| 7 | No export path from document tokens to a DTCG file | workflow blockage | `renderCanonical` / `patchSerialize` have no application caller |
| 8 | Color codec reports out-of-range components as **errors** and normalizes bare-hex `$value` strings without a diagnostic | standards correctness / silent conversion | Color module has no `MUST` to reject ranges; hex-string form is not the 2025.10 structured form |
| 9 | No conflict-resolution UI; counters only | workflow (deferred) | `TokenSyncPanel` renders counts, no resolution surface |
| 10 | Watcher/atomic-write engine unwired to any platform | workflow (deferred) | `sources.ts` / `watcherEvents.ts` consumed only by their own tests |

## 4. Risk-based scenario selection

Full Cartesian coverage is deliberately avoided. Selected lanes:

- **A fresh-project onboarding** — automated (E2E): new document → import →
  bind → edit → undo/redo → reopen.
- **D metadata round trip** — automated (unit): descriptions, deprecation,
  nested groups, `$root`, aliases, `$ref`, unknown extensions survive
  import → edit → export.
- **F preview races** — automated (unit/component): two same-named files,
  cancel, stale preview rejection.
- **G resolver project** — automated (unit): internal sources resolve; missing
  inputs and cycles produce actionable diagnostics. External `$ref` loading is
  reported as unsupported rather than silently dropped.
- **I adversarial/recovery** — automated (unit, existing): malformed JSON,
  duplicate keys, size/depth bounds, watcher bursts.
- **B/C/E/H/J** — covered where the existing suites already pin them; new
  permutations deferred and reported as untested rather than claimed.
