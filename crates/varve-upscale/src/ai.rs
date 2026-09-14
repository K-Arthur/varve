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

#[derive(Default)]
pub struct UpscaleOptions {
    pub progress: Option<ProgressCallback>,
    pub cancel: Option<Arc<AtomicBool>>,
}

pub type ProgressCallback = Box<dyn Fn(usize, usize) + Send + Sync>;

/// Result metadata for one native AI upscale invocation.
///
/// `execution_provider` is the provider selected for the session that produced
/// the returned pixels. ONNX Runtime may still partition a graph internally;
/// callers must describe that limitation rather than turn this into a blanket
/// per-node placement claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUpscaleResult {
    pub pixels: Vec<u8>,
    pub execution_provider: &'static str,
}

/// Allocation-free tile progress counter shared between the upscale loop and a
/// TypeScript callback (delivered through Tauri event emission). The callback
/// is borrowed so an automatic provider retry can report progress again
/// without moving or duplicating the callback closure.
#[derive(Clone)]
pub struct SharedProgress<'a> {
    inner: Arc<ProgressInner<'a>>,
}

struct ProgressInner<'a> {
    current: AtomicUsize,
    total: AtomicUsize,
    callback: Option<&'a ProgressCallback>,
}

impl<'a> SharedProgress<'a> {
    fn new(total: usize, callback: Option<&'a ProgressCallback>) -> Self {
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
    Ok(ai_upscale_with_metadata(pixels, width, height, model_id, options)?.pixels)
}

/// Run Real-ESRGAN and return the provider selected for this invocation.
///
/// Automatic WebGPU execution failures restart the complete request on a
/// fresh CPU session. The failed session is not reused and no partial GPU
/// output is returned, which keeps recovery deterministic for the caller.
pub fn ai_upscale_with_metadata(
    pixels: &[u8],
    width: u32,
    height: u32,
    model_id: &str,
    options: UpscaleOptions,
) -> Result<AiUpscaleResult, String> {
    let UpscaleOptions { progress, cancel } = options;

    let input_bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Image dimensions overflow the native input limit".to_string())?;
    if pixels.len() as u64 != input_bytes {
        return Err("Pixel buffer size does not match dimensions".into());
    }
    if width == 0 || height == 0 {
        return Err("Image dimensions must be positive".into());
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err("Image dimension exceeds 16384px safety limit for AI upscaling".into());
    }
    let out_pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(u64::from(SCALE_U32).pow(2)))
        .ok_or_else(|| "AI upscale output dimensions overflow the native limit".to_string())?;
    if out_pixels > 64 * 1024 * 1024 {
        return Err(format!(
            "AI upscale output contains {out_pixels} pixels; the native limit is {}",
            64 * 1024 * 1024
        ));
    }

    let is_native = model_id == NATIVE_MODEL_ID;
    if !is_native && !model_path(model_id).exists() {
        return Err(format!(
            "Upscale model '{model_id}' not found. Install it in Settings > Models."
        ));
    }
    // An already-cancelled job must not load a model or create a session.
    if matches!(&cancel, Some(c) if c.load(Ordering::Relaxed)) {
        return Err("cancelled".into());
    }

    // `mut` binding is required because ONNX Runtime borrows the session
    // mutably during `run`, even though the model graph is unchanged.
    let (mut session, mut provider) = if is_native {
        build_session_from_bytes(NATIVE_MODEL_BYTES)?
    } else {
        build_session_from_file(model_id)?
    };

    let out_w = width * SCALE_U32;
    let out_h = height * SCALE_U32;
    let run = run_session(
        &mut session,
        pixels,
        width,
        height,
        out_w,
        out_h,
        progress.as_ref(),
        &cancel,
    );
    let rgba = match run {
        Ok(rgba) => rgba,
        Err(gpu_error)
            if provider == "native-webgpu"
                && matches!(
                    varve_bgremove::webgpu_ep::inference_provider_policy(),
                    varve_bgremove::webgpu_ep::InferenceProviderPolicy::Auto
                ) =>
        {
            if matches!(&cancel, Some(c) if c.load(Ordering::Relaxed)) {
                return Err("cancelled".into());
            }
            let reason = format!(
                "AI upscale execution failed on native WebGPU: {gpu_error}; retrying on CPU"
            );
            varve_bgremove::webgpu_ep::note_attach_failure(&reason);
            drop(session);
            let (mut cpu_session, cpu_provider) = if is_native {
                build_cpu_session_from_bytes(NATIVE_MODEL_BYTES)?
            } else {
                build_cpu_session_from_file(model_id)?
            };
            provider = cpu_provider;
            run_session(
                &mut cpu_session,
                pixels,
                width,
                height,
                out_w,
                out_h,
                progress.as_ref(),
                &cancel,
            )?
        }
        Err(error) => return Err(error),
    };

    Ok(AiUpscaleResult {
        pixels: rgba,
        execution_provider: provider,
    })
}

fn run_session(
    session: &mut Session,
    pixels: &[u8],
    width: u32,
    height: u32,
    out_w: u32,
    out_h: u32,
    progress: Option<&ProgressCallback>,
    cancel: &Option<Arc<AtomicBool>>,
) -> Result<Vec<u8>, String> {
    let input_name = session
        .inputs()
        .first()
        .ok_or_else(|| "Upscale model has no input".to_string())?
        .name()
        .to_owned();
    let output_name = session
        .outputs()
        .first()
        .ok_or_else(|| "Upscale model has no output".to_string())?
        .name()
        .to_owned();

    let mut rgb_out = vec![0u8; (u64::from(out_w) * u64::from(out_h) * 3) as usize];
    let step = TILE.saturating_sub(OVERLAP).max(1);
    let total_tiles = u32::max(1, width.div_ceil(step)) * u32::max(1, height.div_ceil(step));
    let shared_progress = progress.map(|cb| SharedProgress::new(total_tiles as usize, Some(cb)));

    let out_tile = TILE * SCALE_U32;
    let overlap_out = OVERLAP * SCALE_U32;
    let core_out = out_tile.saturating_sub(overlap_out * 2).max(1);

    for sy in (0..height).step_by(step as usize) {
        for sx in (0..width).step_by(step as usize) {
            if matches!(cancel, Some(c) if c.load(Ordering::Relaxed)) {
                return Err("cancelled".into());
            }

            let tile_w = TILE.min(width - sx);
            let tile_h = TILE.min(height - sy);

            let mut tile = Vec::with_capacity((tile_w * tile_h * 4) as usize);
            for y in sy..(sy + tile_h) {
                let start = (y * width + sx) as usize * 4;
                tile.extend_from_slice(&pixels[start..start + tile_w as usize * 4]);
            }

            let up = infer_tile(session, &input_name, &output_name, &tile, tile_w, tile_h)?;

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

fn infer_tile(
    session: &mut Session,
    input_name: &str,
    output_name: &str,
    rgba: &[u8],
    w: u32,
    h: u32,
) -> Result<Vec<u8>, String> {
    let n = (w * h) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for i in 0..n {
            tensor_data.push(rgba[i * 4 + c] as f32 / 255.0);
        }
    }

    let input_tensor = Tensor::from_array(([1usize, 3, h as usize, w as usize], tensor_data))
        .map_err(|error| format!("Failed to create upscale input tensor: {error}"))?;

    let outputs = session
        .run(ort::inputs! { input_name => input_tensor })
        .map_err(|error| format!("Upscale inference failed: {error}"))?;

    let output = outputs
        .get(&output_name)
        .ok_or_else(|| "Upscale model output is missing".to_string())?;
    let (_, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("Upscale output is not f32: {error}"))?;

    let out_h = h * SCALE_U32;
    let out_w = w * SCALE_U32;
    let plane = (out_h * out_w) as usize;
    if data.len() < plane * 3 {
        return Err(format!(
            "Upscale model output has {} values; expected at least {}",
            data.len(),
            plane * 3
        ));
    }

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
    Ok(rgb)
}

fn base_builder_settings() -> Result<ort::session::builder::SessionBuilder, String> {
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

/// Session builder with the native provider policy applied (`auto`/`cpu`/`gpu`
/// share the process-wide policy with background removal). `auto` attaches the
/// WebGPU plugin EP when it is registered and falls back to a fresh CPU
/// builder on any attachment failure; `gpu` fails closed.
fn base_session_builder() -> Result<(ort::session::builder::SessionBuilder, &'static str), String> {
    use varve_bgremove::webgpu_ep::{self, InferenceProviderPolicy};
    let policy = webgpu_ep::inference_provider_policy();
    let builder = base_builder_settings()?;
    if !webgpu_ep::device_usable() || matches!(policy, InferenceProviderPolicy::Cpu) {
        if matches!(policy, InferenceProviderPolicy::Gpu) && !webgpu_ep::device_usable() {
            return Err(
                "WebGPU execution provider is unavailable; select Automatic or CPU".to_string(),
            );
        }
        return Ok((builder, "native-cpu"));
    }
    match webgpu_ep::attach_webgpu(builder) {
        Ok(attached) => Ok((attached, "native-webgpu")),
        Err(err) => {
            if matches!(policy, InferenceProviderPolicy::Gpu) {
                return Err(err);
            }
            webgpu_ep::note_attach_failure(&err);
            Ok((base_builder_settings()?, "native-cpu"))
        }
    }
}

fn build_session_from_bytes(bytes: &[u8]) -> Result<(Session, &'static str), String> {
    let (mut builder, provider) = base_session_builder()?;
    let committed = builder.commit_from_memory(bytes);
    match committed {
        Ok(session) => Ok((session, provider)),
        Err(error)
            if provider == "native-webgpu"
                && matches!(
                    varve_bgremove::webgpu_ep::inference_provider_policy(),
                    varve_bgremove::webgpu_ep::InferenceProviderPolicy::Auto
                ) =>
        {
            let gpu_error =
                format!("Failed to load bundled Real-ESRGAN with native WebGPU: {error}");
            varve_bgremove::webgpu_ep::note_attach_failure(&gpu_error);
            let session =
                base_builder_settings()?
                    .commit_from_memory(bytes)
                    .map_err(|cpu_error| {
                        format!("{gpu_error}; CPU session fallback also failed: {cpu_error}")
                    })?;
            Ok((session, "native-cpu"))
        }
        Err(error) => Err(format!("Failed to load bundled Real-ESRGAN model: {error}")),
    }
}

fn build_session_from_file(model_id: &str) -> Result<(Session, &'static str), String> {
    let path = model_path(model_id);
    if !path.exists() {
        return Err(format!(
            "Upscale model '{model_id}' not found at {}.",
            path.display()
        ));
    }
    let (mut builder, provider) = base_session_builder()?;
    let committed = builder.commit_from_file(&path);
    match committed {
        Ok(session) => Ok((session, provider)),
        Err(error)
            if provider == "native-webgpu"
                && matches!(
                    varve_bgremove::webgpu_ep::inference_provider_policy(),
                    varve_bgremove::webgpu_ep::InferenceProviderPolicy::Auto
                ) =>
        {
            let gpu_error =
                format!("Failed to load upscale model '{model_id}' with native WebGPU: {error}");
            varve_bgremove::webgpu_ep::note_attach_failure(&gpu_error);
            let session =
                base_builder_settings()?
                    .commit_from_file(&path)
                    .map_err(|cpu_error| {
                        format!("{gpu_error}; CPU session fallback also failed: {cpu_error}")
                    })?;
            Ok((session, "native-cpu"))
        }
        Err(error) => Err(format!(
            "Failed to load upscale model '{model_id}': {error}"
        )),
    }
}

fn build_cpu_session_from_bytes(bytes: &[u8]) -> Result<(Session, &'static str), String> {
    let session = base_builder_settings()?
        .commit_from_memory(bytes)
        .map_err(|error| format!("Failed to create CPU Real-ESRGAN session: {error}"))?;
    Ok((session, "native-cpu"))
}

fn build_cpu_session_from_file(model_id: &str) -> Result<(Session, &'static str), String> {
    let path = model_path(model_id);
    let session = base_builder_settings()?
        .commit_from_file(&path)
        .map_err(|error| format!("Failed to create CPU upscale session '{model_id}': {error}"))?;
    Ok((session, "native-cpu"))
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
