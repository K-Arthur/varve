# Varve email workspace Short — v6 brief

Build v6 of a 1080x1920 30fps YouTube Short (~35s) for Varve's email workspace, reusing the existing voiceover and captions timing (audio/voice.m4a, audio/align.json, audio/caps5.json, audio/capfix.json; v5 code in v5-reference/).

## Owner feedback on v5
- Zoom sections and highlights are sometimes super fast and hard to follow.
- The highlight glows look unprofessional compared to the reference Short (see ref/ and ref/REF-NOTES.md).
- But don't make it too slow either.

## Requirements
- Replace glows with a professional pointing style matching the reference: dim/spotlight the rest, crisp rounded outline or callout (label chip), smooth eased zoom into the item, optional cursor.
- Pacing: keep the reference Short's energetic pace (a cut/new focus about every 2-3s). Each focus settles and holds ~0.8-1.2s, with smooth eased (ease-in-out) moves of ~0.4-0.6s. No whip zooms, but no lingering. Total length stays ~35s, matched to the voiceover.
- Highlights land exactly on items using shots/bboxes.json + shots/boxes-extra.json, transformed through the same crop/scale as the displayed image.
- Layout centred horizontally.
- Text only between y 290-1440 and clear of the right 150px.
- Audio at -14 LUFS integrated (music audio/electro-softie-cc0.mp3 quiet under voice).
- Never show the mobile preview or the person's real name.
- Centred captions with blue keywords as in v5.

## Deliverables (on this branch, under marketing/email-short-v6/out/)
- The mp4 (if >90MB, re-encode at lower bitrate to fit) plus 6 stills.
- REPORT.md describing checks: per-highlight frame check, centring, safe zone, loudness, full decode.

Do not modify any app/site code. Do not touch master or other branches.
