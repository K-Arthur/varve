//! ONNX model inference for AI-powered background removal.
//!
//! Uses the `ort` crate (ONNX Runtime Rust bindings) to run
//! segmentation models on-device. Opt-in via the `ai` Cargo feature.
//!
//! Architecture: The `InferenceRuntime` trait abstracts ONNX Runtime
//! behind a swappable interface so that future alternatives (tract,
//! burn, ort C API) can be substituted without rewriting the inference
//! pipeline. `OrtInferenceRuntime` is the current implementation.

use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba};
use ort::session::Session;

use crate::session_pool::{
    InferenceCancellationToken, SessionLease, SessionPool, SessionPoolLimits, SessionPoolMetrics,
};
use crate::{heuristic, mask_to_base64, model, RemovalOptions, RemovalResult};

// ── InferenceRuntime trait ────────────────────────────────────────────

/// Swappable ONNX inference backend.
///
/// The sole concrete implementation is [`OrtInferenceRuntime`].
/// Future backends (tract, burn, ort C API) implement this trait
/// and are selected at the call site via a builder or config.
pub trait InferenceRuntime: Send + Sync {
    /// Create an inference session for the given model path.
    fn create_session(
        &self,
        model_path: &std::path::Path,
    ) -> Result<Box<dyn InferenceSession>, String>;
}

/// Shape of an ONNX tensor.
#[derive(Clone, Debug)]
pub struct TensorShape(pub Vec<usize>);

/// A tensor value: data + shape.
#[derive(Clone, Debug)]
pub struct TensorOutput {
    pub data: Vec<f32>,
    pub shape: TensorShape,
}

/// A single loaded ONNX inference session.
pub trait InferenceSession: Send {
    /// Run inference on preprocessed float32 input in CHW layout.
    /// Returns the raw output tensor data.
    ///
    /// Legacy `input_size`-based entry point for square fixed-size models
    /// (segmentation). Prefer [`InferenceSession::run_nd`] for dynamic and
    /// non-square models (denoise, OCR).
    fn run(&mut self, input: &[f32], input_size: u32) -> Result<Vec<f32>, String>;

    /// Run inference with explicit input dimensions and return the output
    /// tensor with its real shape. Required for fully-convolutional models
    /// (SCUNet, PaddleOCR detection/recognition) whose input and output
    /// shapes are not fixed squares.
    ///
    /// Default implementation delegates to [`InferenceSession::run`] for
    /// square single-output models; OrtSession overrides this.
    fn run_nd(&mut self, input: &[f32], input_dims: &[usize]) -> Result<TensorOutput, String> {
        if input_dims.len() != 4 {
            return Err(format!(
                "run_nd expected 4D input [N,C,H,W], got {}D",
                input_dims.len()
            ));
        }
        let h = input_dims[2] as u32;
        let w = input_dims[3] as u32;
        if h != w {
            return Err(format!(
                "run_nd fallback only supports square inputs (got {h}×{w}); override run_nd"
            ));
        }
        let data = self.run(input, h)?;
        Ok(TensorOutput {
            data,
            shape: TensorShape(vec![input_dims[0], input_dims[1], h as usize, w as usize]),
        })
    }

    /// List the model's output names (for commands that need to pick one).
    fn output_names(&self) -> Vec<String>;
}

// ── OrtInferenceRuntime ───────────────────────────────────────────────

/// ONNX Runtime implementation of [`InferenceRuntime`].
///
/// Wraps `ort::session::Session` behind the trait interface.
/// This is the only runtime used in production builds; the trait
/// exists to reduce bus-factor risk (the `ort` crate is single-maintainer)
/// and to enable testing without a real ONNX Runtime installation.
pub struct OrtInferenceRuntime;

/// A session created by [`OrtInferenceRuntime`].
struct OrtSession {
    inner: Session,
    output_name: String,
    output_names: Vec<String>,
}

impl InferenceRuntime for OrtInferenceRuntime {
    fn create_session(
        &self,
        model_path: &std::path::Path,
    ) -> Result<Box<dyn InferenceSession>, String> {
        let session = Session::builder()
            .map_err(|e| format!("Failed to create ONNX session: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load model from '{}': {e}", model_path.display()))?;

        let output_names: Vec<String> = session
            .outputs()
            .iter()
            .map(|o| o.name().to_owned())
            .collect();
        let output_name = output_names
            .first()
            .ok_or("No output found in model")?
            .clone();

        Ok(Box::new(OrtSession {
            inner: session,
            output_name,
            output_names,
        }))
    }
}

impl InferenceSession for OrtSession {
    fn run(&mut self, input: &[f32], input_size: u32) -> Result<Vec<f32>, String> {
        let input_name = self
            .inner
            .inputs()
            .first()
            .ok_or("No input found in model")?
            .name()
            .to_owned();

        let tensor = ort::value::Tensor::from_array((
            [1usize, 3, input_size as usize, input_size as usize],
            input.to_vec(),
        ))
        .map_err(|e| format!("Failed to create input tensor: {e}"))?;

        let outputs = self
            .inner
            .run(ort::inputs! { input_name.as_str() => tensor })
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        let output = outputs
            .get(&self.output_name)
            .ok_or("Output not found in results")?;

        let (_, output_data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

        Ok(output_data.to_vec())
    }

    fn run_nd(&mut self, input: &[f32], input_dims: &[usize]) -> Result<TensorOutput, String> {
        if input_dims.len() < 2 {
            return Err(format!(
                "run_nd expected at least 2D input, got {}D",
                input_dims.len()
            ));
        }
        let input_name = self
            .inner
            .inputs()
            .first()
            .ok_or("No input found in model")?
            .name()
            .to_owned();

        let tensor = ort::value::Tensor::from_array((input_dims.to_vec(), input.to_vec()))
            .map_err(|e| format!("Failed to create input tensor: {e}"))?;

        let outputs = self
            .inner
            .run(ort::inputs! { input_name.as_str() => tensor })
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        let output = outputs
            .get(&self.output_name)
            .ok_or("Output not found in results")?;

        let (shape, output_data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

        let shape_usize: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        Ok(TensorOutput {
            data: output_data.to_vec(),
            shape: TensorShape(shape_usize),
        })
    }

    fn output_names(&self) -> Vec<String> {
        self.output_names.clone()
    }
}

// ── Default runtime instance ──────────────────────────────────────────

use std::sync::OnceLock;

static CURRENT_RUNTIME: OnceLock<Box<dyn InferenceRuntime>> = OnceLock::new();
static SESSION_POOL: OnceLock<SessionPool<Box<dyn InferenceSession>>> = OnceLock::new();

/// Set the inference runtime for the current process.
/// Must be called before any inference; panics if called twice.
pub fn set_runtime(runtime: Box<dyn InferenceRuntime>) {
    CURRENT_RUNTIME
        .set(runtime)
        .ok()
        .expect("InferenceRuntime already set");
}

fn get_runtime() -> &'static dyn InferenceRuntime {
    CURRENT_RUNTIME
        .get()
        .map(|b| b.as_ref())
        .unwrap_or(&OrtInferenceRuntime)
}

fn get_session_pool() -> &'static SessionPool<Box<dyn InferenceSession>> {
    SESSION_POOL.get_or_init(|| SessionPool::new(SessionPoolLimits::default()))
}

fn checkout_session(
    model_path: &std::path::Path,
    cancellation: &InferenceCancellationToken,
) -> Result<SessionLease<Box<dyn InferenceSession>>, String> {
    let key = model_path.to_string_lossy();
    let estimated_bytes = std::fs::metadata(model_path)
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    get_session_pool().checkout(&key, estimated_bytes, cancellation, || {
        get_runtime().create_session(model_path)
    })
}

/// Snapshot native model-session reuse and admission metrics.
pub fn session_pool_metrics() -> SessionPoolMetrics {
    get_session_pool().metrics()
}

/// Explicitly unload idle sessions for one model. Active inference is not
/// interrupted and can be unloaded after it returns.
pub fn unload_model_session(model_id: &str) -> usize {
    let path = model::model_path(model_id);
    get_session_pool().unload(&path.to_string_lossy())
}

/// Explicitly unload every idle native model session.
pub fn unload_all_model_sessions() -> usize {
    get_session_pool().unload_all()
}

// ── Model spec ────────────────────────────────────────────────────────

type ModelSpec = (u32, [f32; 3], [f32; 3], [u8; 3], bool);

#[derive(Clone, Copy)]
struct LetterboxTransform {
    offset_x: f32,
    offset_y: f32,
    scale: f32,
}

fn model_spec(model_id: &str) -> ModelSpec {
    if model_id == "isnet-general-use" {
        (1024, [0.5; 3], [1.0; 3], [128; 3], false)
    } else {
        (
            if model_id == "u2netp" { 320 } else { 1024 },
            [0.485, 0.456, 0.406],
            [0.229, 0.224, 0.225],
            [124, 116, 104],
            model_id != "u2netp",
        )
    }
}

// ── Denoise (SCUNet) ─────────────────────────────────────────────────
// SCUNet is fully convolutional: dynamic H×W (divisible by 8), identity
// normalization (pixel / 255), no letterboxing. Input/output both [1,3,H,W].

const DENOISE_INPUT_DIVISIBLE: u32 = 8;

fn align_to(n: u32, to: u32) -> u32 {
    if n.is_multiple_of(to) {
        n
    } else {
        n + (to - n % to)
    }
}

/// Normalization spec for a dynamic-shape image model.
struct ImageModelSpec {
    pub mean: [f32; 3],
    pub std: [f32; 3],
    /// Input height must be a multiple of this (0 = no constraint).
    pub input_divisible: u32,
}

/// Per-model preprocessing/normalization for fully-convolutional models
/// (SCUNet, PaddleOCR detection). Segmentation uses the fixed-size
/// [`model_spec`] instead.
fn image_model_spec(model_id: &str) -> Option<ImageModelSpec> {
    match model_id {
        "scunet" => Some(ImageModelSpec {
            mean: [0.0, 0.0, 0.0],
            std: [1.0, 1.0, 1.0],
            input_divisible: DENOISE_INPUT_DIVISIBLE,
        }),
        "paddleocr-det-v4" => Some(ImageModelSpec {
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            input_divisible: 32,
        }),
        "paddleocr-rec-v4" => Some(ImageModelSpec {
            mean: [0.5, 0.5, 0.5],
            std: [0.5, 0.5, 0.5],
            input_divisible: 0,
        }),
        _ => None,
    }
}

/// Output of a denoise operation: base64 PNG of the denoised image.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DenoiseResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub processing_time_ms: u64,
}

/// Run SCUNet denoising on an image natively via ONNX Runtime.
///
/// The model expects [1,3,H,W] float32 in [0,1] range (pixel / 255, no
/// mean subtraction) and H/W divisible by 8. Output is [1,3,H,W] in [0,1].
/// `strength` blends between original and denoised (0 = original, 1 = full).
pub fn denoise_image(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
) -> Result<DenoiseResult, String> {
    denoise_image_cancellable(
        img,
        strength,
        model_id,
        &InferenceCancellationToken::default(),
    )
}

/// Cancellable variant of [`denoise_image`]. Cancellation is checked before
/// session loading, before inference, and before publishing the result.
pub fn denoise_image_cancellable(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
    cancellation: &InferenceCancellationToken,
) -> Result<DenoiseResult, String> {
    let start = std::time::Instant::now();
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let spec = image_model_spec(model_id)
        .ok_or_else(|| format!("Denoise: no image model spec for '{model_id}'"))?;

    let model_path = model::model_path(model_id);
    if !model_path.exists() {
        return Err(format!(
            "Denoise model '{}' not found at {}.",
            model_id,
            model_path.display()
        ));
    }

    let (orig_w, orig_h) = img.dimensions();
    let proc_w = if spec.input_divisible > 0 {
        align_to(orig_w, spec.input_divisible)
    } else {
        orig_w
    };
    let proc_h = if spec.input_divisible > 0 {
        align_to(orig_h, spec.input_divisible)
    } else {
        orig_h
    };

    let source = if proc_w != orig_w || proc_h != orig_h {
        img.resize_exact(proc_w, proc_h, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    };
    let rgba = source.to_rgba8();
    let pixels = rgba.into_raw();
    let pixel_count = (proc_w * proc_h) as usize;

    let mut tensor_data = Vec::with_capacity(pixel_count * 3);
    for c in 0..3 {
        for p in 0..pixel_count {
            let normalized = pixels[p * 4 + c] as f32 / 255.0;
            tensor_data.push((normalized - spec.mean[c]) / spec.std[c]);
        }
    }

    let mut session = checkout_session(&model_path, cancellation)?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let output = session.run_nd(&tensor_data, &[1, 3, proc_h as usize, proc_w as usize])?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let shape = &output.shape.0;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 3 {
        return Err(format!(
            "Denoise: unexpected output shape {:?}, expected [1,3,H,W]",
            shape
        ));
    }
    let out_h = shape[2] as u32;
    let out_w = shape[3] as u32;
    let out_data = output.data;
    let out_pixel_count = (out_w * out_h) as usize;
    if out_data.len() != out_pixel_count * 3 {
        return Err(format!(
            "Denoise: output data length {} != expected {}",
            out_data.len(),
            out_pixel_count * 3
        ));
    }

    let mut out_rgba: Vec<u8> = Vec::with_capacity((out_w * out_h * 4) as usize);
    let s = strength.clamp(0.0, 1.0);
    for p in 0..out_pixel_count {
        for c in 0..3 {
            let model_val = out_data[c * out_pixel_count + p].clamp(0.0, 1.0);
            let orig_val = pixels[p * 4 + c] as f32 / 255.0;
            let blended = orig_val * (1.0 - s) + model_val * s;
            out_rgba.push((blended * 255.0).round().clamp(0.0, 255.0) as u8);
        }
        out_rgba.push(pixels[p * 4 + 3]); // preserve alpha
    }

    let final_rgba = if out_w != orig_w || out_h != orig_h {
        let tmp = ImageBuffer::<image::Rgba<u8>, _>::from_raw(out_w, out_h, out_rgba)
            .ok_or("Failed to build output image buffer")?;
        let resized =
            image::imageops::resize(&tmp, orig_w, orig_h, image::imageops::FilterType::Triangle);
        resized.into_raw()
    } else {
        out_rgba
    };

    let png_base64 = {
        use base64::Engine;
        use image::codecs::png::PngEncoder;
        use image::ExtendedColorType;
        use image::ImageEncoder;
        let mut png_bytes: Vec<u8> = Vec::new();
        let encoder = PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(&final_rgba, orig_w, orig_h, ExtendedColorType::Rgba8)
            .map_err(|e| format!("Denoise PNG encode error: {e}"))?;
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    };

    let elapsed = start.elapsed();
    Ok(DenoiseResult {
        png_base64,
        width: orig_w,
        height: orig_h,
        processing_time_ms: elapsed.as_millis() as u64,
    })
}

// ── Public API ────────────────────────────────────────────────────────

/// Run AI background removal on an image using the specified model.
pub fn remove_ai(
    img: &DynamicImage,
    opts: &RemovalOptions,
    model_id: &str,
) -> Result<RemovalResult, String> {
    remove_ai_cancellable(img, opts, model_id, &InferenceCancellationToken::default())
}

/// Cancellable variant of [`remove_ai`]. A cancellation that arrives during
/// ONNX execution suppresses the result; the checked-out session is still
/// returned safely to the pool.
pub fn remove_ai_cancellable(
    img: &DynamicImage,
    opts: &RemovalOptions,
    model_id: &str,
    cancellation: &InferenceCancellationToken,
) -> Result<RemovalResult, String> {
    let start = std::time::Instant::now();
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let model_path = model::model_path(model_id);
    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not found at {}. Download via Settings or export from webview.",
            model_id,
            model_path.display()
        ));
    }

    let mut session = checkout_session(&model_path, cancellation)?;

    let (orig_w, orig_h) = img.dimensions();
    let preview_max = opts
        .preview_max_dimension
        .unwrap_or(DEFAULT_PREVIEW_MAX_DIMENSION);

    let source = if orig_w > preview_max || orig_h > preview_max {
        let scale = preview_max as f32 / orig_w.max(orig_h) as f32;
        let tw = ((orig_w as f32 * scale).round() as u32).max(1);
        let th = ((orig_h as f32 * scale).round() as u32).max(1);
        img.resize_exact(tw, th, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    };

    let (input_size, mean, std, padding, apply_sigmoid) = model_spec(model_id);
    let (source_w, source_h) = source.dimensions();
    let scale = (input_size as f32 / source_w as f32).min(input_size as f32 / source_h as f32);
    let content_w = ((source_w as f32 * scale).round() as u32).max(1);
    let content_h = ((source_h as f32 * scale).round() as u32).max(1);
    let offset_x = (input_size - content_w) / 2;
    let offset_y = (input_size - content_h) / 2;
    let content = source.resize_exact(content_w, content_h, image::imageops::FilterType::Triangle);
    let mut letterboxed = ImageBuffer::from_pixel(
        input_size,
        input_size,
        Rgba([padding[0], padding[1], padding[2], 255]),
    );
    image::imageops::overlay(
        &mut letterboxed,
        &content.to_rgba8(),
        i64::from(offset_x),
        i64::from(offset_y),
    );
    let rgba = letterboxed;
    let pixels = rgba.into_raw();

    let n = (input_size * input_size) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for y in 0..input_size {
            for x in 0..input_size {
                let i = ((y * input_size + x) * 4 + c) as usize;
                let normalized = pixels[i] as f32 / 255.0;
                tensor_data.push((normalized - mean[c as usize]) / std[c as usize]);
            }
        }
    }

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let output_data = session.run(&tensor_data, input_size)?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let mask_size = output_data.len();
    let mask_dim = (mask_size as f64).sqrt() as u32;
    let mask = normalize_segmentation_output(&output_data, apply_sigmoid);
    let mut confidence_sum = 0.0f32;
    for value in &mask {
        confidence_sum += (*value as f32 / 255.0 - 0.5).abs();
    }
    let confidence = if mask_size > 0 {
        ((confidence_sum / mask_size as f32) * 2.0).min(1.0)
    } else {
        0.0
    };

    let source_mask = reconstruct_letterbox_mask(
        &mask,
        mask_dim,
        mask_dim,
        source_w,
        source_h,
        LetterboxTransform {
            offset_x: offset_x as f32 * mask_dim as f32 / input_size as f32,
            offset_y: offset_y as f32 * mask_dim as f32 / input_size as f32,
            scale: scale * mask_dim as f32 / input_size as f32,
        },
    );
    let mut resized_mask = resize_mask(&source_mask, source_w, source_h, orig_w, orig_h);

    if opts.decontaminate.unwrap_or(false) {
        resized_mask = heuristic::apply_decontaminate(&resized_mask, orig_w, orig_h);
    }

    let final_mask = if opts.feather_radius.unwrap_or(0.0) > 0.0 {
        heuristic::apply_feather(
            &resized_mask,
            orig_w,
            orig_h,
            opts.feather_radius.unwrap_or(0.0),
        )
    } else {
        resized_mask
    };

    let method = match model_id {
        "birefnet-general" => "ai-quality",
        "birefnet-general-lite" => "ai-quality",
        "u2netp" => "ai-balanced",
        "isnet-general-use" => "ai-balanced",
        _ => model_id,
    };

    let mask_base64 = mask_to_base64(&final_mask, orig_w, orig_h)?;
    let elapsed = start.elapsed();

    Ok(RemovalResult {
        mask_base64,
        confidence,
        method: method.to_string(),
        processing_time_ms: elapsed.as_millis() as u64,
        width: orig_w,
        height: orig_h,
    })
}

/// Default preview downscale cap (matches TS `DEFAULT_PREVIEW_MAX_DIMENSION`).
const DEFAULT_PREVIEW_MAX_DIMENSION: u32 = 2048;

fn reconstruct_letterbox_mask(
    mask: &[u8],
    model_w: u32,
    model_h: u32,
    source_w: u32,
    source_h: u32,
    transform: LetterboxTransform,
) -> Vec<u8> {
    let mut result = vec![0; (source_w * source_h) as usize];
    for y in 0..source_h {
        for x in 0..source_w {
            let mx = transform.offset_x + (x as f32 + 0.5) * transform.scale - 0.5;
            let my = transform.offset_y + (y as f32 + 0.5) * transform.scale - 0.5;
            let x0 = mx.floor().clamp(0.0, (model_w - 1) as f32) as u32;
            let y0 = my.floor().clamp(0.0, (model_h - 1) as f32) as u32;
            let x1 = (x0 + 1).min(model_w - 1);
            let y1 = (y0 + 1).min(model_h - 1);
            let wx = (mx - x0 as f32).clamp(0.0, 1.0);
            let wy = (my - y0 as f32).clamp(0.0, 1.0);
            let top = mask[(y0 * model_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y0 * model_w + x1) as usize] as f32 * wx;
            let bottom = mask[(y1 * model_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y1 * model_w + x1) as usize] as f32 * wx;
            result[(y * source_w + x) as usize] = (top * (1.0 - wy) + bottom * wy).round() as u8;
        }
    }
    result
}

/// Nearest-neighbor resize of a binary mask.
fn normalize_segmentation_output(data: &[f32], apply_sigmoid: bool) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let values: Vec<f32> = data
        .iter()
        .map(|value| {
            if apply_sigmoid {
                1.0 / (1.0 + (-value).exp())
            } else {
                *value
            }
        })
        .collect();
    let min = values.iter().copied().fold(f32::INFINITY, f32::min);
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let range = max - min;
    if !range.is_finite() || range <= f32::EPSILON {
        return vec![0; data.len()];
    }
    values
        .iter()
        .map(|value| (((value - min) / range) * 255.0) as u8)
        .collect()
}

fn resize_mask(mask: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    if src_w == dst_w && src_h == dst_h {
        return mask.to_vec();
    }

    let mut result = vec![0u8; (dst_w * dst_h) as usize];
    for dy in 0..dst_h {
        let sy = (((dy as f32 + 0.5) * src_h as f32 / dst_h as f32) - 0.5)
            .clamp(0.0, (src_h - 1) as f32);
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(src_h - 1);
        let wy = sy - y0 as f32;
        for dx in 0..dst_w {
            let sx = (((dx as f32 + 0.5) * src_w as f32 / dst_w as f32) - 0.5)
                .clamp(0.0, (src_w - 1) as f32);
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let wx = sx - x0 as f32;
            let top = mask[(y0 * src_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y0 * src_w + x1) as usize] as f32 * wx;
            let bottom = mask[(y1 * src_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y1 * src_w + x1) as usize] as f32 * wx;
            result[(dy * dst_w + dx) as usize] = (top * (1.0 - wy) + bottom * wy).round() as u8;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{
        model_spec, normalize_segmentation_output, reconstruct_letterbox_mask, resize_mask,
        InferenceRuntime, InferenceSession, LetterboxTransform, OrtInferenceRuntime,
    };

    #[test]
    fn normalizes_u2net_probabilities() {
        assert_eq!(
            normalize_segmentation_output(&[0.2, 0.4, 0.6], false),
            vec![0, 127, 255]
        );
    }

    #[test]
    fn applies_birefnet_sigmoid() {
        assert_eq!(
            normalize_segmentation_output(&[-2.0, 0.0, 2.0], true),
            vec![0, 127, 255]
        );
    }

    #[test]
    fn resizes_soft_mask_bilinearly() {
        assert_eq!(resize_mask(&[0, 255], 2, 1, 4, 1), vec![0, 64, 191, 255]);
    }

    #[test]
    fn isnet_uses_official_normalization_without_sigmoid() {
        let (size, mean, std, _, sigmoid) = model_spec("isnet-general-use");
        assert_eq!(size, 1024);
        assert_eq!(mean, [0.5; 3]);
        assert_eq!(std, [1.0; 3]);
        assert!(!sigmoid);
    }

    #[test]
    fn reconstructs_wide_letterbox_without_stretching() {
        let mut mask = vec![0; 16];
        mask[4..12].fill(255);
        assert_eq!(
            reconstruct_letterbox_mask(
                &mask,
                4,
                4,
                4,
                2,
                LetterboxTransform {
                    offset_x: 0.0,
                    offset_y: 1.0,
                    scale: 1.0,
                },
            ),
            vec![255; 8]
        );
    }

    #[test]
    fn ort_runtime_can_be_overridden() {
        // The default runtime is OrtInferenceRuntime
        let runtime = OrtInferenceRuntime;
        // This just tests the trait is object-safe and constructable
        let _: &dyn InferenceRuntime = &runtime;
    }

    #[test]
    fn ort_session_trait_is_object_safe() {
        // Test that Box<dyn InferenceSession> works (object safety)
        // We can't create a real session without a model file, but we
        // can verify the trait is properly object-safe for future impls.
        struct StubSession;
        impl InferenceSession for StubSession {
            fn run(&mut self, _input: &[f32], _input_size: u32) -> Result<Vec<f32>, String> {
                Ok(vec![])
            }
            fn output_names(&self) -> Vec<String> {
                vec!["output".to_string()]
            }
        }
        let mut session: Box<dyn InferenceSession> = Box::new(StubSession);
        let result = session.run(&[], 0).unwrap();
        assert!(result.is_empty());
    }
}
