# Design-tool failure modes and Varve responses

Date: 2026-09-21

This is a failure-informed product and marketing note, not a market-share
survey. Public forum and complaint pages are anecdotal evidence of pain, so
they are useful for identifying failure modes and acceptance tests, not for
claiming prevalence.

## What users complain about

| Failure mode | Public evidence | Varve response that is realistic now |
| --- | --- | --- |
| Offline state is unclear and work can appear unsynced | Figma users describe the editor reporting offline or leaving changes unsynced despite a working connection in the [Figma community offline thread](https://forum.figma.com/ask-the-community-7/figma-keeps-saying-im-offline-21390/index1.html). | Keep core editing and document ownership local. Make save/recovery state visible, keep model downloads and update checks explicit, and never imply that an unconfirmed remote sync exists. |
| A cloud document can disappear or become inaccessible | A [Figma critical-bug report](https://forum.figma.com/report-a-problem-6/critical-bug-entire-design-disappeared-54506) describes a user losing access to an entire design. | Preserve a local `.varve` file, make backup/export paths obvious, and keep migrations deterministic. Do not market local-first as a guarantee that user backups are unnecessary. |
| Export can look blurry or differ from the canvas | Users report [blurry Canva downloads](https://community.make.com/t/image-quality-issues-using-canva-export-a-design/72047) and [blurry Adobe Express PNG/JPEG downloads](https://community.adobe.com/bug-reports-328/adobe-express-downloads-to-png-jpeg-blurry-not-pdf-1465307/index3.html). | Keep output dimensions, scale, colour space, and format visible; add export proof fixtures and tell users which semantics are unsupported. Never silently call a preview-quality raster export print-ready. |
| Subscription cancellation can be deliberately difficult | The US Department of Justice complaint against Adobe describes a convoluted online cancellation process in its [complaint PDF](https://www.justice.gov/usao-ndca/media/1356226/dl?inline=). | Varve is free with no subscription or feature lockouts. Keep pricing and licence language plain, and do not reproduce dark-pattern conversion or cancellation flows if paid services are introduced later. |
| Creative tools fragment workflows and create portability anxiety | Varve's existing [comic workflow failure research](comic-workflow-failure-research-2026-09-20.md) records complaints about tool fragmentation, destructive lettering, export ambiguity, and inaccessible project state across comic workflows. | Keep one document model and workspace modes rather than making a separate comic silo. Store provenance, expose bounded export limitations, and make handoff formats explicit. |

## Product rules derived from the failures

1. Local-first is an interaction contract, not a privacy slogan. The app must
   show whether the current file is saved locally and must not suggest that
   cloud collaboration or recovery exists when it does not.
2. Every high-risk export needs a proof path: dimensions, format, colour
   handling, unsupported content, and a final file the user can inspect.
3. Portability beats lock-in. `.varve` remains the authoritative editable
   file; SVG, PDF, raster, and other exports are handoff formats with declared
   fidelity boundaries rather than promises of perfect round-tripping.
4. AI model acquisition must be opt-in, checksum-verified, cancellable, and
   recoverable. A failed download must not leave a cached corrupt blob that
   hides the download action.
5. Marketing copy must distinguish shipped, beta, experimental, and deferred
   features. Collaboration, complex-script typography, and format fidelity
   remain boundaries to state plainly.

## What Varve should not claim

- “Never loses work”: local files still need backups and a safe filesystem.
- “Perfect export fidelity”: format semantics and unsupported effects can differ.
- “Private by default” without describing optional downloads, update checks,
  and consent boundaries.
- “A replacement for Figma, Canva, Adobe, or a comic platform”: Varve has a
  different ownership model and an explicitly incomplete collaboration layer.

The public-facing summary is now reflected in the [press and brand-assets
page](https://varve.studio/press), while the detailed limitations remain in the
[file-format guide](https://varve.studio/docs/file-formats) and [known
issues](https://varve.studio/support/known-issues).
