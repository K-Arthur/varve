# Comic lettering short v1

32-second silent feature-demo edit, 1080 x 1920, 30 fps. Branch: `marketing/comic-lettering-short-v1`.

## Inventory and choice

Remote inventory: `git ls-remote --heads origin 'marketing/*'` returned only `marketing/email-short-v6` at `86abf125689d56a1970b0ee80ea9ecda4286d01a`. Its tree contains email UI captures, six-frame review sets, v6/v7/v8 MP4s, renderers, and audio. Email is excluded from this task; no email-short-v9 work was created or used. Local refs initially had no marketing branches. The new comic branch was created from the supplied clean checkout at `cdff09419`.

| Feature | Existing usable assets |
| --- | --- |
| Comic lettering | 14 PNGs in `docs/screenshots/comic-lettering/`; product screenshot `docs/screenshots/product/comic-lettering-light.png`; three comic workflow PNGs in `docs/screenshots/comic-workflow/`; finished/unlettered PNGs, editable document and raster PDF in `marketing/sample-comic/`. |
| Vector tools | `docs/screenshots/workflows/bezier-node-edit` and `raster-to-vector`: PNG posters, MP4/WebM clips and capture metadata; illustration PNGs under `docs/screenshots/product/`. |
| Print / CMYK | `docs/screenshots/workflows/rgb-to-cmyk` and `poster-to-print`: PNG posters, MP4/WebM clips and capture metadata; print workspace PNGs under `docs/screenshots/workspace-dock-layout/`. |
| Photo editing | Six PNGs and a README under `docs/screenshots/photo-image-editing-2026-09-14/`; background-removal PNG/MP4/WebM workflow assets; product background-removal and depth-blur PNGs. |

Comic lettering wins the requested priority order and has both readable UI details and a finished original comic. All selected images were visually inspected. Assets are existing editor captures; the video is a screenshot-based edit, not a recording of live interactions. It makes no native export or PDF/X claims.

## Deliverables and shot timing

- `out/comic-lettering-short-v1.mp4`: H.264, yuv420p, 960 frames, 32.000 seconds, no audio stream.
- `out/frame-01.png` through `out/frame-06.png`: actual encoded-frame grabs at 1.5, 6, 12, 18.5, 25.5 and 30.5 seconds.
- `VOICEOVER.txt`: 73-word script, timed to each scene, with female AI voice direction.
- `render.py`: reproducible edit using Pillow, DejaVu Sans and FFmpeg. Run from any directory with `python3 marketing/comic-lettering-short-v1/render.py`. Regeneration creates pre-encode stills; use FFmpeg to extract encoded grabs after rendering.

| Time | Shot | Background |
| --- | --- | --- |
| 0-3 | Bold hook directly over the waking-cookie comic panels; gentle artwork movement, no fade-in | Light |
| 3-9 | Editable speech-balloon detail | Dark |
| 9-15 | Longer dialogue fitted inside its balloon | Light |
| 15-22 | Dark canvas balloon and enlarged position/size Inspector detail | Dark |
| 22-29 | Complete finished comic, unobscured | Light |
| 29-32 | “What would your comic say?” / “Follow for Varve drops” | Dark |

Caption geometry is asserted during every rendered frame: x >= 70, right edge <= 930, y >= 290, bottom <= 1440. Added captions use DejaVu Sans Bold. Blue UI selection outlines are solid 3px, drawn after screenshot scaling. Existing native selection handles are part of the source captures. Caption and highlight regions are separate; the right-side social overlay area contains no added captions. Important visuals remain clear of the caption areas.

Audio is intentionally absent per the delivery instruction. Integrated LUFS cannot be measured for a video-only file. The owner's later voice-over/music mix should target -14 LUFS integrated; no placeholder sound or reused email audio is included.

## Review and validation

Self-review: inspected all six encoded frame grabs together and checked UI highlights, text edges and scene boundaries. First pass found a partly cropped native size label and a small Inspector inset. Removed the label from the crop, enlarged the inset, and made all added captions bold before the final render. Final grabs show no caption/highlight overlaps, cropped captions or visible layout glitches.

Changed scope: this marketing directory only. No application code changed.

Validation plan: Tier 0 touched format/lint and emoji audit; no affected package or crate, no full-suite escalation.

Commands:

- `pnpm_config_verify_deps_before_run=false pnpm verify:plan`
- `pnpm_config_verify_deps_before_run=false pnpm verify:affected`
- `python3 marketing/comic-lettering-short-v1/render.py` (960-frame caption-bounds assertions)
- FFprobe: H.264, 1080 x 1920, 30/1 fps, 960 frames, 32.000 seconds, no audio.
- `ffmpeg -v error -i marketing/comic-lettering-short-v1/out/comic-lettering-short-v1.mp4 -f null -` (complete decode)
- Six FFmpeg PNG extracts and visual self-review.

Initial package-manager attempts encountered automatic dependency verification and a scratch JSON formatting failure. Retried with the established `pnpm_config_verify_deps_before_run=false` setting and moved scratch files outside the repository before final checks. No dependency files were modified.

Skipped as unrelated: Rust workspace tests, website E2E, full visual suite and full repository suite, because this edit changes only marketing media and its renderer. No publication or merge performed.
