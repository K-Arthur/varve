# Effect Studio responsive review

Captured 2026-09-29 from the live editor modal in Chromium after the layout and sticky section rail changes. The responsive matrix covers light and dark themes at 1440 × 900, 1024 × 768, 768 × 1024, 390 × 844, and 320 × 844. The narrow shortcut screenshot shows the sticky Preview / Treatments / Stack & settings rail.

`effect-studio-baseline-dialog.png` is the committed pre-change Playwright dialog snapshot, included for comparison with the three-zone reflow and the clarified Favorites / Looks / Advanced hierarchy.

Visual checks recorded: preview fit within the dialog, aligned before/after bounds, no horizontal overflow, preview-gallery-inspector reading order, and reachable section navigation at widths where the applied stack moves below the fold. The matrix uses a reticulation preview to make the comparison boundary visible; its live candidate displays the renderer's `byte-cap-exceeded` warning. That is a real bounded-preview status, so those matrix images document responsive behavior rather than serve as polished marketing artwork. The separate multi-treatment screenshots show a tuned Halftone Pattern stack without that warning: `effect-studio-stack-1440x900.png` captures all three zones, `effect-studio-stack-overview-390x844.png` shows the phone preview and sticky rail, and `effect-studio-stack-390x844.png` is scrolled to the applied stack and active settings. These are also the reviewed desktop and phone captures used by the feature page.

On narrow screens, the Stack & settings rail button moves the tuned recipe controls directly into view below the rail while keeping neighboring recipe rows immediately above them. The Playwright capture waits for that smooth jump to finish and checks the target's visible bounds against the rail before recording the image.

The Playwright source is `tests/e2e/workspace/effect-studio.spec.ts` tests `keeps the three zones aligned across the responsive viewport matrix`, `keeps a multi-treatment stack and its settings reachable as the modal narrows`, and `keeps preview, treatments, and active settings one tap away on narrow screens`.
