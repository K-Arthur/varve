//! Native image upscaling — CPU filters + optional ONNX Real-ESRGAN.
//!
//! - `cpu_upscale()` — filter-based RGBA enlargement (always available)
//! - `tiled_upscale()` — overlapping tiles for large images
//! - `ai_upscale()` — Real-ESRGAN via ONNX Runtime (`ai` feature)
//!
//! Alpha strategy for AI: RGB channels run through the model; the alpha
//! channel is resized with Catmull-Rom and reattached (models are RGB-only).

#![forbid(unsafe_code)]

use image::{DynamicImage, ImageBuffer, Rgba};
use std::path::PathBuf;
use std::sync::OnceLock;

static CONFIGURED_MODEL_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

/// Inject the Tauri-resolved app model directory for desktop inference.
/// Standalone callers retain the platform-data fallback in `model_path`.
pub fn configure_model_directory(path: PathBuf) {
    let _ = CONFIGURED_MODEL_DIRECTORY.set(path);
}

#[cfg(feature = "ai")]
mod ai;
#[cfg(feature = "ai")]
pub use ai::{ai_upscale, ProgressCallback, UpscaleOptions};

/// CPU filter used for conventional enlargement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpscaleFilter {
    Nearest,
    Triangle,
    CatmullRom,
    Lanczos3,
}

impl UpscaleFilter {
    pub fn from_method(method: &str) -> Self {
        match method {
            "nearest" => Self::Nearest,
            "bilinear" => Self::Triangle,
            "lanczos3" => Self::Lanczos3,
            // bicubic / default / unknown → Catmull-Rom
            _ => Self::CatmullRom,
        }
    }

    fn to_image_filter(self) -> image::imageops::FilterType {
        match self {
            Self::Nearest => image::imageops::FilterType::Nearest,
            Self::Triangle => image::imageops::FilterType::Triangle,
            Self::CatmullRom => image::imageops::FilterType::CatmullRom,
            Self::Lanczos3 => image::imageops::FilterType::Lanczos3,
        }
    }
}

/// CPU-based upscale. Supports premultiplied-alpha-safe filters via `image` crate.
pub fn cpu_upscale(
    pixels: &[u8],
    width: u32,
    height: u32,
    scale: f64,
    filter: UpscaleFilter,
) -> Result<Vec<u8>, String> {
    if pixels.len() as u32 != width * height * 4 {
        return Err("Pixel buffer size does not match dimensions".into());
    }

    let img = DynamicImage::ImageRgba8(
        ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, pixels.to_vec())
            .ok_or("Failed to construct image buffer")?,
    );

    let out_w = (width as f64 * scale).max(1.0).round() as u32;
    let out_h = (height as f64 * scale).max(1.0).round() as u32;

    let resized = img.resize_exact(out_w, out_h, filter.to_image_filter());
    Ok(resized.to_rgba8().into_raw())
}

/// Tile-based upscale for large images. Delegates each tile to `cpu_upscale`.
pub fn tiled_upscale(
    pixels: &[u8],
    width: u32,
    height: u32,
    scale: f64,
    tile_size: u32,
    overlap: u32,
    filter: UpscaleFilter,
) -> Result<Vec<u8>, String> {
    if pixels.len() as u32 != width * height * 4 {
        return Err("Pixel buffer size does not match dimensions".into());
    }

    let out_w = (width as f64 * scale).max(1.0).round() as u32;
    let out_h = (height as f64 * scale).max(1.0).round() as u32;

    let mut output = vec![0u8; (out_w * out_h * 4) as usize];

    let step_x = tile_size.saturating_sub(overlap).max(1);
    let step_y = tile_size.saturating_sub(overlap).max(1);

    for sy in (0..height).step_by(step_y as usize) {
        for sx in (0..width).step_by(step_x as usize) {
            let tile_w = tile_size.min(width - sx);
            let tile_h = tile_size.min(height - sy);

            let mut tile_pixels = Vec::with_capacity((tile_w * tile_h * 4) as usize);
            for y in sy..(sy + tile_h) {
                let src_start = (y * width + sx) as usize * 4;
                let src_end = src_start + (tile_w as usize * 4);
                tile_pixels.extend_from_slice(&pixels[src_start..src_end]);
            }

            let upscaled = cpu_upscale(&tile_pixels, tile_w, tile_h, scale, filter)?;

            let ox = (sx as f64 * scale).round() as u32;
            let oy = (sy as f64 * scale).round() as u32;
            let tile_out_w = (tile_w as f64 * scale).round() as u32;
            let tile_out_h = (tile_h as f64 * scale).round() as u32;

            for ty in 0..tile_out_h.min(out_h.saturating_sub(oy)) {
                for tx in 0..tile_out_w.min(out_w.saturating_sub(ox)) {
                    let src_idx = (ty * tile_out_w + tx) as usize * 4;
                    let dst_idx = ((oy + ty) * out_w + (ox + tx)) as usize * 4;
                    let alpha = upscaled[src_idx + 3];
                    if alpha == 255 || (alpha > 0 && output[dst_idx + 3] == 0) {
                        output[dst_idx..dst_idx + 4]
                            .copy_from_slice(&upscaled[src_idx..src_idx + 4]);
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Resolve model file path under the shared Varve models directory.
pub fn model_path(model_id: &str) -> std::path::PathBuf {
    let base = CONFIGURED_MODEL_DIRECTORY.get().cloned().unwrap_or_else(|| {
        dirs_next::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("dev.varve.desktop")
            .join("models")
    });
    let by_id = base.join(format!("{model_id}.onnx"));
    if by_id.exists() {
        return by_id;
    }
    // Manifest filenames for Real-ESRGAN variants
    let alt = match model_id {
        "upscale-realesr-general" => "realesr-general-x4v3.onnx",
        "upscale-realesrgan-x4plus" => "realesrgan-x4plus.onnx",
        "upscale-realesrgan-anime" => "realesrgan-x4plus-anime.onnx",
        _ => return by_id,
    };
    let by_name = base.join(alt);
    if by_name.exists() {
        by_name
    } else {
        by_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checkerboard(w: u32, h: u32) -> Vec<u8> {
        let mut pixels = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                let v = if (x + y) % 2 == 0 { 255u8 } else { 0u8 };
                pixels.extend_from_slice(&[v, v, v, 255]);
            }
        }
        pixels
    }

    #[test]
    fn cpu_upscale_doubles_dimensions() {
        let src = checkerboard(4, 4);
        let out = cpu_upscale(&src, 4, 4, 2.0, UpscaleFilter::CatmullRom).unwrap();
        assert_eq!(out.len(), 8 * 8 * 4);
    }

    #[test]
    fn cpu_upscale_preserves_opaque_alpha() {
        let src = checkerboard(2, 2);
        let out = cpu_upscale(&src, 2, 2, 2.0, UpscaleFilter::Nearest).unwrap();
        for px in out.chunks(4) {
            assert_eq!(px[3], 255);
        }
    }

    #[test]
    fn rejects_mismatched_buffer() {
        let err = cpu_upscale(&[0u8; 3], 1, 1, 2.0, UpscaleFilter::Nearest).unwrap_err();
        assert!(err.contains("Pixel buffer"));
    }

    #[test]
    fn tiled_upscale_matches_size() {
        let src = checkerboard(8, 8);
        let out = tiled_upscale(&src, 8, 8, 2.0, 4, 1, UpscaleFilter::Triangle).unwrap();
        assert_eq!(out.len(), 16 * 16 * 4);
    }

    #[test]
    fn nearest_golden_matches_typescript() {
        // Shared with packages/engine/src/upscaleGoldenParity.test.ts
        let src = vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
        ];
        let out = cpu_upscale(&src, 2, 2, 2.0, UpscaleFilter::Nearest).unwrap();
        let expected: Vec<u8> = vec![
            255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0,
            0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0,
            255, 255, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0,
            255,
        ];
        assert_eq!(out, expected);
    }

    #[test]
    fn filter_from_method_maps_known_names() {
        assert_eq!(
            UpscaleFilter::from_method("nearest"),
            UpscaleFilter::Nearest
        );
        assert_eq!(
            UpscaleFilter::from_method("bilinear"),
            UpscaleFilter::Triangle
        );
        assert_eq!(
            UpscaleFilter::from_method("lanczos3"),
            UpscaleFilter::Lanczos3
        );
        assert_eq!(
            UpscaleFilter::from_method("bicubic"),
            UpscaleFilter::CatmullRom
        );
    }
}
