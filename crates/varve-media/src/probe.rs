//! Minimal container probing for animated media.
//!
//! This is the Rust-side counterpart of the TypeScript probe
//! (`@varve/engine` `media/probe.ts`). The TS probe is authoritative for the
//! application (it is synchronous and always available); this probe exists
//! for native-side validation, parity tests, and as a reference
//! implementation for new container features.

use std::io::Cursor;

use serde::Serialize;

use crate::limits::DecodeLimits;

/// Container-level animation facts (no pixel data).
#[derive(Debug, Clone, Serialize)]
pub struct MediaProbe {
    /// Container kind, or `None` when the bytes are not a recognized
    /// animated container.
    pub kind: Option<&'static str>,
    /// Canvas width (full animation canvas, not per-frame rects).
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// Number of frames in the container (1 for static files).
    pub frame_count: u32,
    /// Loop count: `None` = no loop extension / not animated, `0` =
    /// infinite, `n > 0` = finite.
    pub loop_count: Option<u32>,
}

/// Probe bytes without decoding any pixel data.
pub fn probe(bytes: &[u8], limits: &DecodeLimits) -> Result<MediaProbe, String> {
    if bytes.len() < 4 {
        return Err("media input too short to probe".to_string());
    }
    match (bytes[0], bytes[1], bytes[2]) {
        (b'G', b'I', b'F') => probe_gif(bytes),
        (0x89, 0x50, 0x4e) => probe_png(bytes, limits),
        (b'R', b'I', b'F') => probe_webp(bytes),
        _ => Err("unrecognized media container".to_string()),
    }
}

fn probe_gif(bytes: &[u8]) -> Result<MediaProbe, String> {
    let mut reader = gif::DecodeOptions::new()
        .read_info(Cursor::new(bytes))
        .map_err(|e| format!("invalid GIF: {e}"))?;
    let width = u32::from(reader.width());
    let height = u32::from(reader.height());
    let mut frame_count = 0u32;
    loop {
        let info = reader.next_frame_info();
        match info {
            Ok(Some(_)) => frame_count += 1,
            Ok(None) => break,
            Err(e) => return Err(format!("invalid GIF: {e}")),
        }
    }
    let loop_count = match reader.repeat() {
        gif::Repeat::Finite(n) => Some(u32::from(n)),
        gif::Repeat::Infinite => Some(0),
    };
    Ok(MediaProbe {
        kind: Some("gif"),
        width,
        height,
        frame_count,
        loop_count,
    })
}

fn probe_png(bytes: &[u8], limits: &DecodeLimits) -> Result<MediaProbe, String> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let reader = decoder
        .read_info()
        .map_err(|e| format!("invalid PNG: {e}"))?;
    let info = reader.info();
    let width = info.width;
    let height = info.height;
    limits.check_rect(width, height)?;
    match info.animation_control() {
        Some(ac) => Ok(MediaProbe {
            kind: Some("apng"),
            width,
            height,
            frame_count: ac.num_frames,
            loop_count: Some(ac.num_plays),
        }),
        None => Ok(MediaProbe {
            kind: Some("png"),
            width,
            height,
            frame_count: 1,
            loop_count: None,
        }),
    }
}

fn probe_webp(bytes: &[u8]) -> Result<MediaProbe, String> {
    let decoder = image_webp::WebPDecoder::new(Cursor::new(bytes))
        .map_err(|e| format!("invalid WebP: {e}"))?;
    let (width, height) = decoder.dimensions();
    // Static files report zero frames through num_frames().
    let frame_count = decoder.num_frames().max(1);
    let loop_count = match decoder.loop_count() {
        image_webp::LoopCount::Forever => Some(0),
        image_webp::LoopCount::Times(n) => Some(u32::from(n.get())),
    };
    Ok(MediaProbe {
        kind: Some("webp"),
        width,
        height,
        frame_count,
        loop_count,
    })
}
