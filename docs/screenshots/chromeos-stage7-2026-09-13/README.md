# Stage 7 website visual evidence

These captures were taken from the locally built website on 2026-09-13 with
the repository's Chromium screenshot command. They contain no account data,
document content, or private paths.

| File | Viewport | Route | Inspection result |
|---|---:|---|---|
| `chromebook-800x1280.png` | 800 × 1280 | `/docs/chromebook/` | Route cards, status callout, tables, guide links, and footer render without blank regions or clipped controls. |
| `chromebook-360x800.png` | 360 × 800 | `/docs/chromebook/` | Cards and tables stack into the narrow layout; no horizontal page drift or clipped support copy was observed. |
| `download-1440x1024.png` | 1440 × 1024 | `/download/` | Browser and Linux route notices, download cards, checksums, installation instructions, and footer render; no blank panels or clipped actions were observed. |

Capture commands used `pnpm exec playwright screenshot --browser chromium`
against the locally served `apps/website/dist` output. These are review
artifacts, not updated visual-regression baselines.
