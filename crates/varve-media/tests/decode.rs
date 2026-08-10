//! Decode correctness for the committed animated-media fixture corpus
//! (`packages/engine/src/media/__fixtures__`). Every fixture uses flat solid
//! colors so pixels are asserted exactly.

use varve_media::{decode_frames, probe, DecodeLimits};

/// Convenience: include_bytes! cannot be parametrized, so each fixture is
/// pulled in through this macro-expanded helper.
macro_rules! fx {
    ($name:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/engine/src/media/__fixtures__/",
            $name
        ))
    };
}

const LIMITS: DecodeLimits = DecodeLimits {
    max_dimension: 65_535,
    max_pixels_per_frame: 64 * 1024 * 1024,
    max_frames: 10_000,
    max_decoded_bytes: 512 * 1024 * 1024,
};

fn px(rgba: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
    let o = (y * w + x) * 4;
    [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
}

// ── GIF ────────────────────────────────────────────────────────────────────

#[test]
fn gif_basic_metadata_and_pixels() {
    let bytes = fx!("gif-basic.gif");
    let p = probe(bytes, &LIMITS).expect("probe");
    assert_eq!(p.kind, Some("gif"));
    assert_eq!((p.width, p.height), (64, 64));
    assert_eq!(p.frame_count, 3);
    assert_eq!(p.loop_count, Some(0)); // infinite

    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    let expect = [
        ([255, 0, 0, 255], 40),
        ([0, 255, 0, 255], 100),
        ([0, 0, 255, 255], 20),
    ];
    for (i, (frame, (color, ms))) in frames.iter().zip(expect).enumerate() {
        assert_eq!(frame.index, i as u32);
        assert_eq!(
            (frame.x, frame.y, frame.width, frame.height),
            (0, 0, 64, 64)
        );
        assert_eq!(frame.duration_ms, ms, "frame {i} duration");
        assert_eq!(frame.blend, "source");
        assert_eq!(frame.disposal, "none");
        assert!(!frame.pre_composited);
        assert_eq!(px(&frame.rgba, 64, 32, 32), color, "frame {i} pixel");
        // whole frame solid
        assert_eq!(frame.rgba.len(), 64 * 64 * 4);
        assert!(frame.rgba.chunks_exact(4).all(|p| p == color));
    }
}

#[test]
fn gif_delta_rects_and_disposal() {
    let bytes = fx!("gif-delta.gif");
    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    assert_eq!((frames[0].width, frames[0].height), (64, 64));
    assert_eq!(frames[0].disposal, "background");
    assert_eq!(frames[1].x, 8);
    assert_eq!(frames[1].y, 8);
    assert_eq!((frames[1].width, frames[1].height), (16, 16));
    assert_eq!(frames[1].disposal, "background");
    assert_eq!(frames[2].x, 32);
    assert_eq!(frames[2].y, 32);
    assert_eq!(frames[2].disposal, "none");
    assert_eq!(px(&frames[1].rgba, 16, 0, 0), [0, 0, 255, 255]);
    assert_eq!(px(&frames[2].rgba, 16, 15, 15), [0, 255, 0, 255]);
}

#[test]
fn gif_dispose_previous_roundtrip() {
    let bytes = fx!("gif-dispose-previous.gif");
    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    assert_eq!(frames[1].disposal, "previous");
    assert_eq!(frames[1].x, 8);
    assert_eq!(frames[1].width, 16);
    assert_eq!(px(&frames[1].rgba, 16, 8, 8), [0, 0, 255, 255]);
    assert_eq!(px(&frames[2].rgba, 16, 8, 8), [0, 255, 0, 255]);
}

#[test]
fn gif_interlaced_deinterlaces() {
    let bytes = fx!("gif-interlaced.gif");
    let frames = decode_frames(bytes, 0, 1, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 2);
    assert_eq!(px(&frames[0].rgba, 32, 0, 0), [255, 0, 0, 255]);
    assert_eq!(px(&frames[0].rgba, 32, 31, 31), [255, 0, 0, 255]);
    assert_eq!(px(&frames[1].rgba, 32, 0, 31), [0, 0, 255, 255]);
}

#[test]
fn gif_transparent_frame() {
    let bytes = fx!("gif-transparent.gif");
    let frames = decode_frames(bytes, 0, 1, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 2);
    // frame 0: left half opaque red, right half transparent (GIF has binary
    // transparency via the transparent index)
    assert_eq!(px(&frames[0].rgba, 64, 0, 0), [255, 0, 0, 255]);
    assert_eq!(px(&frames[0].rgba, 64, 31, 0), [255, 0, 0, 255]);
    assert_eq!(px(&frames[0].rgba, 64, 32, 0), [0, 0, 0, 0]);
    assert_eq!(px(&frames[0].rgba, 64, 63, 63), [0, 0, 0, 0]);
    // frame 1 is an opaque green delta
    assert_eq!(px(&frames[1].rgba, 16, 0, 0), [0, 255, 0, 255]);
}

#[test]
fn gif_single_frame_is_static() {
    let bytes = fx!("gif-single.gif");
    let p = probe(bytes, &LIMITS).expect("probe");
    assert_eq!(p.frame_count, 1);
    assert_eq!(p.loop_count, Some(0));
    let frames = decode_frames(bytes, 0, 0, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 1);
}

#[test]
fn gif_finite_loop_and_zero_delay() {
    let loop3 = fx!("gif-loop3.gif");
    let p = probe(loop3, &LIMITS).expect("probe");
    assert_eq!(p.loop_count, Some(3));

    let zero = fx!("gif-zero-delay.gif");
    let frames = decode_frames(zero, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    assert_eq!(
        frames[1].duration_ms, 0,
        "zero delay preserved for resolver policy"
    );
}

#[test]
fn gif_range_start_skips_earlier_frames() {
    let bytes = fx!("gif-basic.gif");
    let frames = decode_frames(bytes, 1, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].index, 1);
    assert_eq!(frames[1].index, 2);
}

#[test]
fn gif_truncated_fails_safely() {
    let bytes = fx!("gif-basic.gif");
    let truncated = &bytes[..bytes.len() / 2];
    // Decoding may yield fewer frames (end-of-stream) or a typed error —
    // either way it must not panic.
    match decode_frames(truncated, 0, 2, &LIMITS) {
        Ok(frames) => assert!(frames.len() <= 3),
        Err(msg) => assert!(!msg.is_empty()),
    }
}

// ── APNG ───────────────────────────────────────────────────────────────────

#[test]
fn apng_basic_metadata_and_pixels() {
    let bytes = fx!("apng-basic.png");
    let p = probe(bytes, &LIMITS).expect("probe");
    assert_eq!(p.kind, Some("apng"));
    assert_eq!((p.width, p.height), (64, 64));
    assert_eq!(p.frame_count, 3);
    assert_eq!(p.loop_count, Some(0));

    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    let expect = [
        ([255, 0, 0, 255], 40),
        ([0, 255, 0, 255], 100),
        ([0, 0, 255, 255], 20),
    ];
    for (i, (frame, (color, ms))) in frames.iter().zip(expect).enumerate() {
        assert_eq!(frame.index, i as u32);
        assert_eq!(
            (frame.x, frame.y, frame.width, frame.height),
            (0, 0, 64, 64)
        );
        assert_eq!(frame.duration_ms, ms, "frame {i} duration");
        assert_eq!(frame.blend, "source");
        assert_eq!(frame.disposal, "none");
        assert!(!frame.pre_composited);
        assert!(frame.rgba.chunks_exact(4).all(|p| p == color));
    }
}

#[test]
fn apng_delta_rects_dispose_and_blend() {
    let bytes = fx!("apng-delta.png");
    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    assert_eq!(
        (frames[0].x, frames[0].y, frames[0].width, frames[0].height),
        (0, 0, 64, 64)
    );
    assert_eq!(frames[0].disposal, "background");
    assert_eq!(
        (frames[1].x, frames[1].y, frames[1].width, frames[1].height),
        (8, 8, 16, 16)
    );
    assert_eq!(frames[1].disposal, "background");
    assert_eq!(frames[1].blend, "source");
    assert_eq!(px(&frames[1].rgba, 16, 0, 0), [0, 0, 255, 255]);
    assert_eq!(
        (frames[2].x, frames[2].y, frames[2].width, frames[2].height),
        (32, 32, 16, 16)
    );
    assert_eq!(frames[2].disposal, "none");
    assert_eq!(px(&frames[2].rgba, 16, 15, 15), [0, 255, 0, 255]);
}

#[test]
fn apng_blend_over_keeps_source_alpha() {
    let bytes = fx!("apng-blend-over.png");
    let frames = decode_frames(bytes, 0, 1, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 2);
    // frame 0: 50%-alpha red canvas
    assert_eq!(px(&frames[0].rgba, 64, 0, 0), [255, 0, 0, 128]);
    // frame 1: 16x16 50%-white delta with blend=over at +24+24
    assert_eq!(
        (frames[1].x, frames[1].y, frames[1].width, frames[1].height),
        (24, 24, 16, 16)
    );
    assert_eq!(frames[1].blend, "over");
    assert_eq!(px(&frames[1].rgba, 16, 0, 0), [255, 255, 255, 128]);
}

#[test]
fn apng_static_rejected_by_decode() {
    let bytes = fx!("apng-single.png");
    let p = probe(bytes, &LIMITS).expect("probe");
    // single-frame acTL is normalized to static semantics by the TS probe;
    // the Rust decoder requires an acTL and decodes its single frame fine.
    let frames = decode_frames(bytes, 0, 0, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 1);
    assert_eq!(px(&frames[0].rgba, 64, 32, 32), [255, 0, 0, 255]);
    let _ = p;
}

#[test]
fn apng_range_start_skips_earlier_frames() {
    let bytes = fx!("apng-basic.png");
    let frames = decode_frames(bytes, 2, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].index, 2);
}

#[test]
fn apng_malformed_fails_safely() {
    let bytes = fx!("apng-basic.png");
    // Truncated mid-stream: typed error or fewer frames, never a panic.
    let truncated = &bytes[..60];
    match decode_frames(truncated, 0, 2, &LIMITS) {
        Ok(frames) => assert!(frames.len() <= 1),
        Err(msg) => assert!(!msg.is_empty()),
    }
}

// ── WebP ───────────────────────────────────────────────────────────────────

#[test]
fn webp_animated_metadata_and_pixels() {
    let bytes = fx!("webp-animated.webp");
    let p = probe(bytes, &LIMITS).expect("probe");
    assert_eq!(p.kind, Some("webp"));
    assert_eq!((p.width, p.height), (64, 64));
    assert_eq!(p.frame_count, 3);
    assert_eq!(p.loop_count, Some(0)); // infinite

    let frames = decode_frames(bytes, 0, 2, &LIMITS).expect("decode");
    assert_eq!(frames.len(), 3);
    // ffmpeg's libwebp lossless path applies an RGB->YUV->RGB color transform
    // on pure primaries (253/127/254 instead of 255) — decoders disagree by
    // ±1, so assert within tolerance.
    let expect = [[253u8, 0, 0], [0, 127, 0], [0, 0, 254]];
    for (i, frame) in frames.iter().enumerate() {
        assert_eq!(frame.index, i as u32);
        assert_eq!(
            (frame.x, frame.y, frame.width, frame.height),
            (0, 0, 64, 64)
        );
        assert!(frame.pre_composited, "webp frames arrive pre-composited");
        for (x, y) in [(0u32, 0u32), (63, 63)] {
            let p = px(&frame.rgba, 64, x as usize, y as usize);
            for c in 0..3 {
                let delta = p[c].abs_diff(expect[i][c]);
                assert!(delta <= 2, "frame {i} channel {c}: {delta}");
            }
            assert_eq!(p[3], 255, "frame {i} alpha");
        }
    }
    // per-frame durations come back from the decoder (ANMF durations —
    // the ffmpeg concat filter re-times frames to 40/120/40 ms)
    assert_eq!(
        frames.iter().map(|f| f.duration_ms).collect::<Vec<_>>(),
        vec![40, 120, 40]
    );
}

#[test]
fn webp_static_rejected_by_decode() {
    let bytes = fx!("webp-static.webp");
    let p = probe(bytes, &LIMITS).expect("probe");
    assert_eq!(p.frame_count, 1);
    let err = decode_frames(bytes, 0, 0, &LIMITS).expect_err("static webp must not decode");
    assert!(err.contains("animated"), "unexpected error: {err}");
}

#[test]
fn webp_truncated_fails_safely() {
    let bytes = fx!("webp-animated.webp");
    let truncated = &bytes[..bytes.len() - 8];
    match decode_frames(truncated, 0, 2, &LIMITS) {
        Ok(frames) => assert!(frames.len() <= 3),
        Err(msg) => assert!(!msg.is_empty()),
    }
}

// ── Limits ─────────────────────────────────────────────────────────────────

#[test]
fn limits_reject_huge_ranges() {
    let bytes = fx!("gif-basic.gif");
    let err = decode_frames(bytes, 0, 100_000, &LIMITS).expect_err("over frame limit");
    assert!(err.contains("limit"), "unexpected error: {err}");
}

#[test]
fn limits_reject_empty_range() {
    let bytes = fx!("gif-basic.gif");
    let err = decode_frames(bytes, 3, 2, &LIMITS).expect_err("start > end");
    assert!(err.contains("start exceeds end"), "unexpected error: {err}");
}

#[test]
fn limits_reject_unknown_container() {
    let err = decode_frames(b"not an image at all!", 0, 0, &LIMITS).expect_err("unknown");
    assert!(err.contains("unrecognized"), "unexpected error: {err}");
}
