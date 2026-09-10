# ADR-0038: Review artifact format

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0031

## Context

Design changes in pull requests need review artifacts that don't require
opening the app or GitHub APIs: semantic summaries, before/after renders,
overlays, and risk flags, safe to open locally.

## Alternatives

1. GitHub-only: requires API consent and network; rejected as the core path.
2. Self-contained offline bundle (chosen), with optional Markdown/JSON
   extras.

## Decision

`varve review <base> <target> --output <dir>` generates:

```text
review/
  index.html      (self-contained, accessible, keyboard-navigable)
  manifest.json   (schema, tool versions, base/target ids + hashes,
                   generation timestamp, reproducible build info)
  summary.md      (PR-description-ready Markdown)
  semantic-diff.json
  previews/before/ after/ overlays/
  assets/
```

Requirements: no remote scripts by default; Content Security Policy header
where served; user content escaped; semantic change list with added/removed/
modified/moved/reordered/renamed distinctions; changed-region thumbnails;
font/asset warnings; unresolved-conflict warnings; before/after + overlay
previews; changed node and property counts; base and target hashes;
reproducible generation (same inputs → same bundle bytes except the
documented generation timestamp). Optional extras: CI artifact, JSON for
other tools, static image contact sheet. SARIF only for genuine rule
violations, never for ordinary design changes. Any future automated PR
commenting is separately consented and scoped.

## Consequences

- **Migration impact:** none.
- **Backward compatibility:** n/a.
- **Cross-platform/Performance:** generation is offline, deterministic,
  bounded; rendered crops are region-limited.
- **Security:** escaped content, CSP, no remote deps, bounded bundle size.
- **Accessibility:** semantic HTML, keyboard nav, text alternatives for
  previews.
- **Rejected shortcuts:** screenshots-only bundles without semantic data;
  requiring network/GitHub; embedding scripts that phone home.
