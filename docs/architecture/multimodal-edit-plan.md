# Multimodal design edit plans

Status: current-state contract, 2026-08-13

Varve's multimodal assistance is an inspectable layer over the deterministic
editor. A provider may analyze text, screenshots, sketches, assets, or a
selection, but it never receives a document mutator and never writes directly
to `Document` state.

## Contract

`packages/ai/src/designEditPlan.ts` defines the provider-independent boundary:

```text
input → normalized provider result → DesignEditPlan → validate → preview →
freshness check → normal editor command transaction → verify
```

`DesignEditPlan` carries:

- a stable plan and request id;
- the target document id and editor-owned base revision;
- an explicit scope (`selection`, `frame`, `page`, or `document`);
- source provenance and a confidence value;
- human-readable warnings;
- a bounded list of typed operations.

Supported operations cover the current extension points: create or modify a
node, move, resize, reparent, apply layout, create a component, bind a token,
import an asset reference, and connect a prototype interaction. Operation data
is JSON-safe and property paths reject prototype-pollution keys.

## Validation and stale-result policy

`validateDesignEditPlan` rejects malformed or hostile provider output before it
can reach editor code. It enforces safe identifiers, finite geometry, bounded
operation count, supported operation kinds, non-negative dimensions, valid
property paths, unique planned node ids, and references to existing or earlier
created nodes.

`checkDesignPlanFreshness` rejects a plan when the document id or revision no
longer matches, or when a referenced target has disappeared. The editor must
run this check again immediately before applying an approved preview because a
user may have edited the document while analysis was running.

Validation is intentionally not application. The editor owns preview UI,
approval, command/history integration, cancellation, and final document
verification. A provider failure, cancellation, or stale response therefore
leaves the document unchanged.

## Current limitation

The contract and deterministic validator are implemented and tested. The
editor preview/apply adapter and provider UI remain a follow-up vertical slice;
until that exists, the ordinary editor remains fully usable without any AI
service.
