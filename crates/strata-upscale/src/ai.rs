//! Real-ESRGAN ONNX inference (feature = `ai`).
//!
//! RGB channels run through the model; alpha is Catmull-Rom resized and
//! reattached (Real-ESRGAN only models RGB). Tiled with overlap; only the
//! *core* of each upscaled tile (outside the overlap band) is written, so
//! neighbouring tiles never fight over the same pixels and seams are avoided.
//! Progress is reported per tile and a shared cancellation flag can stop
//! inference between tiles so the UI stays responsive.

#![forbid(unsafe_code)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use ort::{session::Session, value::Tensor};

use crate::{cpu_upscale, model_path, UpscaleFilter};

const TILE: u32 = 64;
const OVERLAP: u32 = 16;
const SCALE: f64 = 4.0;
const SCALE_U32: u32 = 4;
const MAX_DIMENSION: u32 = 16384;

const NATIVE_MODEL_ID: &str = "upscale-realesr-general";

/// Real-ESRGAN v0.3.0 general x4v3 checkpoint (ONNX export). Bundled with the
/// desktop app so the native inference path works on first install with no
/// network access. SHA-256
/// `856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7`.
const NATIVE_MODEL_BYTES: &[u8] =
    include_bytes!("../../../apps/desktop/public/models/realesr-general-x4v3.onnx");

pub struct UpscaleOptions {
    pub progress: Option<ProgressCallback>,
    pub cancel: Option<Arc<AtomicBool>>,
}

impl Default for UpscaleOptions {
    fn default() -> Self {
        Self {
            progress: None,
            cancel: None,
        }
    }
}

pub type ProgressCallback = Box<dyn Fn(usize, usize) + Send>;

/// Allocation-free tile progress counter shared between the upscale loop and a
/// TypeScript callback (delivered through Tauri event emission).
#[derive(Clone)]
pub struct SharedProgress {
    inner: Arc<ProgressInner>,
}

#[derive(Default)]
struct ProgressInner {
    current: AtomicUsize,
    total: AtomicUsize,
    callback: Option<ProgressCallback>,
}

impl SharedProgress {
    fn new(total: usize, callback: Option<ProgressCallback>) -> Self {
        Self {
            inner: Arc::new(ProgressInner {
                current: AtomicUsize::new(0),
                total: AtomicUsize::new(total),
                callback,
            }),
        }
    }

    fn tick(&self) -> usize {
        self.inner.current.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn report(&self) {
        if let Some(cb) = &self.inner.callback {
            (cb)(
                self.inner.current.load(Ordering::Relaxed),
                self.inner.total.load(Ordering::Relaxed),
            );
        }
    }

    fn publish_final(&self) {
        let total = self.inner.total.load(Ordering::Relaxed);
        if let Some(cb) = &self.inner.callback {
            (cb)(total, total);
        }
    }
}

/// Run Real-ESRGAN (or compatible x4 RGB ONNX) on RGBA pixels.
///
/// The bundled Real-ESRGAN model is embedded in the binary and loaded from
/// memory. User-supplied models are loaded from their file path. The shared
/// cancellation flag is polled between tiles; if set, inference halts and
/// `"cancelled"` is returned so the caller can treat it as a user cancel.
pub fn ai_upscale(
    pixels: &[u8],
    width: u32,
    height: u32,
    model_id: &str,
    options: UpscaleOptions,
) -> Result<Vec<u8>, String> {
    let UpscaleOptions { progress, cancel } = options;

    if pixels.len() as u32 != width * height * 4 {
        return Err("Pixel buffer size does not match dimensions".into());
    }
    if width == 0 || height == 0 {
        return Err("Image dimensions must be positive".into());
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err("Image dimension exceeds 16384px safety limit for AI upscaling".into());
    }

    let is_native = model_id == NATIVE_MODEL_ID;
    if !is_native && !model_path(model_id).exists() {
        return Err(format!(
            "Upscale model '{model_id}' not found. Install it in Settings > Models."
        ));
    }

    // `mut` binding is required because ONNX Runtime borrows the session
    // mutably during `run`, even though the model graph is unchanged.
    let mut session = if is_native {
        build_session_from_bytes(NATIVE_MODEL_BYTES)?
    } else {
        build_session_from_file(model_id)?
    };

    let out_w = width * SCALE_U32;
    let out_h = height * SCALE_U32;
    let mut rgb_out = vec![0u8; (out_w * out_h * 3) as usize];

    let step = TILE.saturating_sub(OVERLAP).max(1);
    let total_tiles =
        u32::max(1, (width + step - 1) / step) * u32::max(1, (height + step - 1) / step);
    let shared_progress = progress.map(|cb| SharedProgress::new(total_tiles as usize, Some(cb)));

    let out_tile = TILE * SCALE_U32;
    let overlap_out = OVERLAP * SCALE_U32;
    let core_out = out_tile.saturating_sub(overlap_out * 2).max(1);

    for sy in (0..height).step_by(step as usize) {
        for sx in (0..width).step_by(step as usize) {
            if matches!(&cancel, Some(c) if c.load(Ordering::Relaxed)) {
                return Err("cancelled".into());
            }

            let tile_w = TILE.min(width - sx);
            let tile_h = TILE.min(height - sy);

            let mut tile = Vec::with_capacity((tile_w * tile_h * 4) as usize);
            for y in sy..(sy + tile_h) {
                let start = (y * width + sx) as usize * 4;
                tile.extend_from_slice(&pixels[start..start + tile_w as usize * 4]);
            }

            let up = infer_tile(&mut session, &tile, tile_w, tile_h);

            // Write only the core of the upscaled tile — never the overlap
            // margin that a neighbour will also cover — so tiles never write
            // the same output pixels and seams cannot form.
            let tw = tile_w * SCALE_U32;
            let th = tile_h * SCALE_U32;
            let is_first_col = sx == 0;
            let is_first_row = sy == 0;
            let src_x0 = if is_first_col { 0 } else { overlap_out };
            let src_y0 = if is_first_row { 0 } else { overlap_out };
            let dst_x0 = if is_first_col {
                sx * SCALE_U32
            } else {
                sx * SCALE_U32 + overlap_out
            };
            let dst_y0 = if is_first_row {
                sy * SCALE_U32
            } else {
                sy * SCALE_U32 + overlap_out
            };
            let copy_w = (tw - src_x0).min(core_out).min(out_w - dst_x0);
            let copy_h = (th - src_y0).min(core_out).min(out_h - dst_y0);

            for ty in 0..copy_h {
                for tx in 0..copy_w {
                    let src = ((src_y0 + ty) * tw + (src_x0 + tx)) as usize * 3;
                    let dst = ((dst_y0 + ty) * out_w + (dst_x0 + tx)) as usize * 3;
                    rgb_out[dst..dst + 3].copy_from_slice(&up[src..src + 3]);
                }
            }

            if let Some(p) = &shared_progress {
                p.tick();
                p.report();
            }
        }
    }

    if let Some(p) = &shared_progress {
        p.publish_final();
    }

    let alpha_src: Vec<u8> = pixels.chunks(4).map(|p| p[3]).collect();
    let mut alpha_rgba = Vec::with_capacity((width * height * 4) as usize);
    for a in alpha_src {
        alpha_rgba.extend_from_slice(&[0, 0, 0, a]);
    }
    let alpha_up = cpu_upscale(&alpha_rgba, width, height, SCALE, UpscaleFilter::CatmullRom)?;

    let mut rgba = Vec::with_capacity((out_w * out_h * 4) as usize);
    for i in 0..(out_w * out_h) as usize {
        rgba.push(rgb_out[i * 3]);
        rgba.push(rgb_out[i * 3 + 1]);
        rgba.push(rgb_out[i * 3 + 2]);
        rgba.push(alpha_up[i * 4 + 3]);
    }
    Ok(rgba)
}

fn infer_tile(session: &mut Session, rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let n = (w * h) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for i in 0..n {
            tensor_data.push(rgba[i * 4 + c] as f32 / 255.0);
        }
    }

    let input_tensor = Tensor::from_array(([1usize, 3, h as usize, w as usize], tensor_data))
        .expect("tensor shape matches pixel count");

    let input_name = session
        .inputs()
        .first()
        .expect("session preflight validates an input exists")
        .name()
        .to_owned();
    let output_name = session
        .outputs()
        .first()
        .expect("session preflight validates an output exists")
        .name()
        .to_owned();

    let outputs = session
        .run(ort::inputs! { input_name.as_str() => input_tensor })
        .expect("session preflight validates inference succeeds");

    let output = outputs
        .get(&output_name)
        .expect("output exists if run succeeded");
    let (_, data) = output
        .try_extract_tensor::<f32>()
        .expect("session preflight validates f32 output");

    let out_h = h * SCALE_U32;
    let out_w = w * SCALE_U32;
    let plane = (out_h * out_w) as usize;
    assert!(
        data.len() >= plane * 3,
        "session preflight validates output size"
    );

    let slice = &data[..plane * 3];
    let mut rgb = vec![0u8; plane * 3];
    for y in 0..out_h {
        for x in 0..out_w {
            let i = (y * out_w + x) as usize;
            let r = slice[i].clamp(0.0, 1.0);
            let g = slice[plane + i].clamp(0.0, 1.0);
            let b = slice[plane * 2 + i].clamp(0.0, 1.0);
            rgb[i * 3] = (r * 255.0).round() as u8;
            rgb[i * 3 + 1] = (g * 255.0).round() as u8;
            rgb[i * 3 + 2] = (b * 255.0).round() as u8;
        }
    }
    rgb
}

fn base_session_builder() -> Result<ort::session::builder::SessionBuilder, String> {
    let builder = Session::builder().map_err(|e| format!("Failed to create ONNX session: {e}"))?;
    let builder = builder
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::All)
        .map_err(|e| format!("Failed to configure session optimization: {e}"))?;
    let builder = builder
        .with_memory_pattern(true)
        .map_err(|e| format!("Failed to enable memory pattern: {e}"))?;
    let builder = builder
        .with_intra_threads(2)
        .map_err(|e| format!("Failed to configure intra threads: {e}"))?;
    let builder = builder
        .with_inter_threads(1)
        .map_err(|e| format!("Failed to configure inter threads: {e}"))?;
    builder
        .with_parallel_execution(false)
        .map_err(|e| format!("Failed to configure execution mode: {e}"))
}

fn build_session_from_bytes(bytes: &[u8]) -> Result<Session, String> {
    base_session_builder()?
        .commit_from_memory(bytes)
        .map_err(|e| format!("Failed to load bundled Real-ESRGAN model: {e}"))
}

fn build_session_from_file(model_id: &str) -> Result<Session, String> {
    let path = model_path(model_id);
    if !path.exists() {
        return Err(format!(
            "Upscale model '{model_id}' not found at {}.",
            path.display()
        ));
    }
    base_session_builder()?
        .commit_from_file(&path)
        .map_err(|e| format!("Failed to load upscale model '{model_id}': {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mismatched_buffer() {
        let err = ai_upscale(
            &[0u8; 15],
            2,
            2,
            super::NATIVE_MODEL_ID,
            UpscaleOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("Pixel buffer"), "got: {err}");
    }

    #[test]
    fn rejects_zero_dimension() {
        let err =
            ai_upscale(&[], 0, 1, super::NATIVE_MODEL_ID, UpscaleOptions::default()).unwrap_err();
        assert!(err.contains("positive"), "got: {err}");
    }

    #[test]
    fn rejects_oversized_dimension() {
        // 16385*1*4 bytes; the buffer matches so the dimension guard fires.
        let err = ai_upscale(
            &[0u8; 16385 * 4],
            16385,
            1,
            super::NATIVE_MODEL_ID,
            UpscaleOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("16384"), "got: {err}");
    }

    #[test]
    fn rejects_unknown_model_without_file() {
        let err =
            ai_upscale(&[0u8; 4], 1, 1, "no-such-model", UpscaleOptions::default()).unwrap_err();
        assert!(err.contains("no-such-model"), "got: {err}");
    }

    #[test]
    fn shared_progress_reports_ticks() {
        let calls: std::sync::Arc<std::sync::Mutex<Vec<(usize, usize)>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let cb_proxy = calls.clone();
        let cb: ProgressCallback = Box::new(move |done, total| {
            cb_proxy.lock().unwrap().push((done, total));
        });
        let progress = SharedProgress::new(4, Some(cb));
        for _ in 0..4 {
            progress.tick();
            progress.report();
        }
        progress.publish_final();
        let seen = calls.lock().unwrap();
        assert_eq!(seen[0], (1, 4));
        assert_eq!(seen[3], (4, 4));
        // publish_final fires a final (total, total)
        assert_eq!(seen[4], (4, 4));
    }

    #[test]
    fn cancellation_checked_between_tiles() {
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        // Validation passes; the very first tile loop iteration sees the flag.
        let err = ai_upscale(
            &[0u8; 4],
            1,
            1,
            super::NATIVE_MODEL_ID,
            UpscaleOptions {
                cancel: Some(cancel),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err, "cancelled");
    }
}
