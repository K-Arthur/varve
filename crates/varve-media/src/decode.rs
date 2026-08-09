//! Frame decoding for GIF / APNG / animated WebP.
//!
//! `decode_frames` decodes the raw source frames in `[start, end]`
//! (inclusive) from the container's beginning (all three decoders are
//! sequential). Allocation bounds from `DecodeLimits` are checked before any
//! per-frame buffer is created; the cumulative decoded byte budget is also
//! enforced across the returned range.

use std::io::Cursor;

use base64::Engine;
use serde::Serialize;

use crate::limits::DecodeLimits;

/// One decoded source frame.
///
/// `rgba` covers the frame rectangle `(x, y, width, height)` only — full
/// canvas composition is performed by the shared TS compositor.
#[derive(Debug, Clone, Serialize)]
pub struct DecodedFrame {
    pub index: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    /// Source-timing duration in ms (0 for containers whose per-frame
    /// timing is not exposed by the decoder — WebP; the TS probe is the
    /// authoritative timing source).
    pub duration_ms: u32,
    pub blend: &'static str,
    pub disposal: &'static str,
    /// `true` when `rgba` is already the full composited canvas (WebP
    /// decodes this way) and must be pasted verbatim.
    pub pre_composited: bool,
    pub rgba: Vec<u8>,
}

/// IPC-friendly variant: pixel payload base64-encoded for JSON transport.
#[derive(Debug, Clone, Serialize)]
pub struct DecodedFrameJson {
    pub index: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u32,
    pub blend: &'static str,
    pub disposal: &'static str,
    pub pre_composited: bool,
    pub rgba_base64: String,
}

fn to_json(frame: &DecodedFrame) -> DecodedFrameJson {
    DecodedFrameJson {
        index: frame.index,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        duration_ms: frame.duration_ms,
        blend: frame.blend,
        disposal: frame.disposal,
        pre_composited: frame.pre_composited,
        rgba_base64: base64::engine::general_purpose::STANDARD.encode(&frame.rgba),
    }
}

/// Decode raw source frames `[start, end]` (inclusive).
pub fn decode_frames(
    bytes: &[u8],
    start: u32,
    end: u32,
    limits: &DecodeLimits,
) -> Result<Vec<DecodedFrame>, String> {
    if bytes.len() < 4 {
        return Err("media input too short to decode".to_string());
    }
    if start > end {
        return Err("decode range start exceeds end".to_string());
    }
    if end.saturating_add(1) > limits.max_frames {
        return Err(format!(
            "requested frame {end} exceeds the {}-frame limit",
            limits.max_frames
        ));
    }
    match (bytes[0], bytes[1], bytes[2]) {
        (b'G', b'I', b'F') => decode_gif(bytes, start, end, limits),
        (0x89, 0x50, 0x4e) => decode_apng(bytes, start, end, limits),
        (b'R', b'I', b'F') => decode_webp(bytes, start, end, limits),
        _ => Err("unrecognized media container".to_string()),
    }
}

/// Decode frames and serialize for JSON IPC (base64 payloads).
pub fn decode_frames_base64(
    bytes: &[u8],
    start: u32,
    end: u32,
    limits: &DecodeLimits,
) -> Result<Vec<DecodedFrameJson>, String> {
    Ok(decode_frames(bytes, start, end, limits)?
        .iter()
        .map(to_json)
        .collect())
}

// ── GIF ────────────────────────────────────────────────────────────────────

fn decode_gif(
    bytes: &[u8],
    start: u32,
    end: u32,
    limits: &DecodeLimits,
) -> Result<Vec<DecodedFrame>, String> {
    let mut options = gif::DecodeOptions::new();
    // gif 0.14 defaults to indexed output; we need palette-expanded RGBA
    // with the transparency index applied.
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut reader = options
        .read_info(Cursor::new(bytes))
        .map_err(|e| format!("invalid GIF: {e}"))?;
    let canvas_w = u32::from(reader.width());
    let canvas_h = u32::from(reader.height());
    limits.check_rect(canvas_w, canvas_h)?;

    let mut frames = Vec::new();
    let mut budget: u64 = 0;
    let mut index = 0u32;
    while index <= end {
        let frame = match reader.read_next_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => break, // container has fewer frames than requested
            Err(e) => return Err(format!("invalid GIF frame {index}: {e}")),
        };
        if index >= start {
            let w = u32::from(frame.width);
            let h = u32::from(frame.height);
            limits.check_rect(w, h)?;
            let bytes = w * h * 4;
            budget += u64::from(bytes);
            if budget > limits.max_decoded_bytes {
                return Err(format!(
                    "decoded byte budget exceeded ({budget} > {} bytes)",
                    limits.max_decoded_bytes
                ));
            }
            let disposal = match frame.dispose {
                gif::DisposalMethod::Background => "background",
                gif::DisposalMethod::Previous => "previous",
                _ => "none",
            };
            frames.push(DecodedFrame {
                index,
                x: u32::from(frame.left),
                y: u32::from(frame.top),
                width: w,
                height: h,
                duration_ms: u32::from(frame.delay) * 10,
                blend: "source",
                disposal,
                pre_composited: false,
                rgba: frame.buffer.to_vec(),
            });
        }
        index += 1;
    }
    Ok(frames)
}

// ── APNG ───────────────────────────────────────────────────────────────────

fn decode_apng(
    bytes: &[u8],
    start: u32,
    end: u32,
    limits: &DecodeLimits,
) -> Result<Vec<DecodedFrame>, String> {
    let mut decoder = png::Decoder::new_with_limits(
        Cursor::new(bytes),
        png::Limits {
            bytes: limits.max_decoded_bytes.min(usize::MAX as u64) as usize,
        },
    );
    // Expand indexed → RGB(A) and strip 16-bit channels so per-frame output
    // is always 8-bit (Grayscale, GrayscaleAlpha, Rgb, Rgba).
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("invalid APNG: {e}"))?;

    let (canvas_w, canvas_h, interlaced, frame_control, num_frames) = {
        let info = reader.info();
        let ac = info
            .animation_control()
            .ok_or("not an animated PNG (no acTL chunk)")?;
        limits.check_rect(info.width, info.height)?;
        if num_frames_ok(ac.num_frames, limits) {
            return Err(format!(
                "animation exceeds the {}-frame limit",
                limits.max_frames
            ));
        }
        (
            info.width,
            info.height,
            info.interlaced,
            info.frame_control,
            ac.num_frames,
        )
    };
    if interlaced {
        return Err("interlaced APNG frames are not supported".to_string());
    }
    let default_image = frame_control.is_none();
    // An APNG without an fcTL before the IDAT carries an extra default image
    // frame that non-APNG decoders would show.
    let expected_total = num_frames + u32::from(default_image);

    let required_len = reader
        .output_buffer_size()
        .ok_or_else(|| "APNG output size exceeds address space".to_string())?;
    let mut buf = vec![0u8; required_len];
    let (out_ct, out_depth) = reader.output_color_type();

    let mut frames = Vec::new();
    let mut budget: u64 = 0;
    let mut index = 0u32;
    let mut control = frame_control;
    while index <= end && index < expected_total {
        let fc = control.unwrap_or(png::FrameControl {
            width: canvas_w,
            height: canvas_h,
            delay_num: 10,
            delay_den: 100,
            ..png::FrameControl::default()
        });
        if index >= start {
            let w = fc.width;
            let h = fc.height;
            limits.check_rect(w, h)?;
            let output = reader
                .next_frame(&mut buf)
                .map_err(|e| format!("invalid APNG frame {index}: {e}"))?;
            let written = output.buffer_size();
            let rgba = frame_to_rgba(&buf[..written.min(buf.len())], w, h, out_ct, out_depth)?;
            budget += rgba.len() as u64;
            if budget > limits.max_decoded_bytes {
                return Err(format!(
                    "decoded byte budget exceeded ({budget} > {} bytes)",
                    limits.max_decoded_bytes
                ));
            }
            let duration_ms = apng_delay_ms(fc.delay_num, fc.delay_den);
            let blend = match fc.blend_op {
                png::BlendOp::Over => "over",
                png::BlendOp::Source => "source",
            };
            let disposal = match fc.dispose_op {
                png::DisposeOp::Background => "background",
                png::DisposeOp::Previous => "previous",
                png::DisposeOp::None => "none",
            };
            frames.push(DecodedFrame {
                index,
                x: fc.x_offset,
                y: fc.y_offset,
                width: w,
                height: h,
                duration_ms,
                blend,
                disposal,
                pre_composited: false,
                rgba,
            });
        }
        index += 1;
        if index <= end && index < expected_total {
            // Advance to the next frame; this positions the reader at the
            // following image data and refreshes `frame_control`.
            reader
                .next_frame_info()
                .map_err(|e| format!("invalid APNG frame {index}: {e}"))?;
            control = reader.info().frame_control;
        }
    }
    Ok(frames)
}

fn num_frames_ok(num_frames: u32, limits: &DecodeLimits) -> bool {
    num_frames > limits.max_frames
}

/// APNG frame delay per the spec: `den == 0` is treated as 100; a zero
/// numerator means the minimum representable positive delay.
fn apng_delay_ms(delay_num: u16, delay_den: u16) -> u32 {
    if delay_num == 0 && delay_den == 0 {
        return 10;
    }
    let den = if delay_den == 0 {
        100u32
    } else {
        u32::from(delay_den)
    };
    let ms = (u32::from(delay_num) * 1000) / den;
    if ms == 0 {
        1
    } else {
        ms
    }
}

/// Convert a transformed 8-bit frame buffer to RGBA. With
/// `EXPAND | STRIP_16` the output is one of Grayscale / GrayscaleAlpha /
/// Rgb / Rgba at 8 bits per channel.
fn frame_to_rgba(
    data: &[u8],
    w: u32,
    h: u32,
    ct: png::ColorType,
    depth: png::BitDepth,
) -> Result<Vec<u8>, String> {
    let w = w as usize;
    let h = h as usize;
    if depth != png::BitDepth::Eight {
        return Err(format!("unsupported APNG output bit depth {depth:?}"));
    }
    let channels = match ct {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => {
            return Err("unexpected indexed APNG output after EXPAND".to_string())
        }
    };
    let stride = w * channels;
    let expected = h * stride;
    if data.len() < expected {
        return Err(format!(
            "APNG frame truncated ({}/{})",
            data.len(),
            expected
        ));
    }
    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let off = y * stride + x * channels;
            let o = (y * w + x) * 4;
            match ct {
                png::ColorType::Rgba => {
                    rgba[o] = data[off];
                    rgba[o + 1] = data[off + 1];
                    rgba[o + 2] = data[off + 2];
                    rgba[o + 3] = data[off + 3];
                }
                png::ColorType::Rgb => {
                    rgba[o] = data[off];
                    rgba[o + 1] = data[off + 1];
                    rgba[o + 2] = data[off + 2];
                    rgba[o + 3] = 255;
                }
                png::ColorType::Grayscale => {
                    rgba[o] = data[off];
                    rgba[o + 1] = data[off];
                    rgba[o + 2] = data[off];
                    rgba[o + 3] = 255;
                }
                png::ColorType::GrayscaleAlpha => {
                    rgba[o] = data[off];
                    rgba[o + 1] = data[off];
                    rgba[o + 2] = data[off];
                    rgba[o + 3] = data[off + 1];
                }
                png::ColorType::Indexed => unreachable!(),
            }
        }
    }
    Ok(rgba)
}

// ── WebP ───────────────────────────────────────────────────────────────────

fn decode_webp(
    bytes: &[u8],
    start: u32,
    end: u32,
    limits: &DecodeLimits,
) -> Result<Vec<DecodedFrame>, String> {
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(bytes))
        .map_err(|e| format!("invalid WebP: {e}"))?;
    let (w, h) = decoder.dimensions();
    limits.check_rect(w, h)?;
    if !decoder.is_animated() {
        return Err("not an animated WebP (no ANIM chunk)".to_string());
    }
    if decoder.num_frames() > limits.max_frames {
        return Err(format!(
            "animation exceeds the {}-frame limit",
            limits.max_frames
        ));
    }
    // image-webp emits Rgb8 when the file has no alpha channel and Rgba8
    // otherwise; size the buffer exactly as the decoder expects.
    let rgba_mode = decoder.has_alpha();
    let channel_count = if rgba_mode { 4u32 } else { 3u32 };
    let canvas_bytes = u64::from(w) * u64::from(h) * u64::from(channel_count);
    if canvas_bytes > limits.max_decoded_bytes {
        return Err(format!(
            "single frame ({canvas_bytes} bytes) exceeds the decoded byte budget"
        ));
    }
    decoder.set_memory_limit(canvas_bytes as usize);

    let mut buf = vec![0u8; canvas_bytes as usize];
    let mut frames = Vec::new();
    let mut budget: u64 = 0;
    for index in 0..=end {
        let duration_ms = decoder
            .read_frame(&mut buf)
            .map_err(|e| format!("invalid WebP frame {index}: {e}"))?;
        if index >= start {
            let rgba = if rgba_mode {
                buf.clone()
            } else {
                let mut out = Vec::with_capacity(buf.len() / 3 * 4);
                for px in buf.chunks_exact(3) {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
                out
            };
            budget += rgba.len() as u64;
            if budget > limits.max_decoded_bytes {
                return Err(format!(
                    "decoded byte budget exceeded ({budget} > {} bytes)",
                    limits.max_decoded_bytes
                ));
            }
            frames.push(DecodedFrame {
                index,
                x: 0,
                y: 0,
                width: w,
                height: h,
                duration_ms,
                blend: "source",
                disposal: "none",
                pre_composited: true,
                rgba,
            });
        }
    }
    Ok(frames)
}
