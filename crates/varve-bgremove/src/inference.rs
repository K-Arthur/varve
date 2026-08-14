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

    /// List the model's input names (for multi-input model validation).
    fn input_names(&self) -> Vec<String> {
        Vec::new()
    }

    /// Run inference with multiple named inputs, each with explicit dimensions.
    /// Used by multi-input models (LaMa, etc.).
    fn run_multi(&mut self, _inputs: &[(&str, &[f32], &[usize])]) -> Result<TensorOutput, String> {
        Err("run_multi not implemented by this runtime".to_string())
    }
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

    fn input_names(&self) -> Vec<String> {
        self.inner
            .inputs()
            .iter()
            .map(|i| i.name().to_owned())
            .collect()
    }

    fn run_multi(&mut self, inputs: &[(&str, &[f32], &[usize])]) -> Result<TensorOutput, String> {
        use ort::session::SessionInputValue;
        use std::borrow::Cow;

        let mut ort_inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> =
            Vec::with_capacity(inputs.len());
        for (name, data, dims) in inputs {
            let tensor = ort::value::Tensor::from_array((dims.to_vec(), data.to_vec()))
                .map_err(|e| format!("Failed to create input tensor '{name}': {e}"))?;
            ort_inputs.push((Cow::from(name.to_string()), SessionInputValue::from(tensor)));
        }

        let outputs = self
            .inner
            .run(ort_inputs)
            .map_err(|e| format!("ONNX multi-input inference failed: {e}"))?;

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
// SCUNet is fully convolutional: dynamic H×W, identity normalization
// (pixel / 255), no letterboxing. Input/output both [1,3,H,W].
// Padding must be a multiple of 64: the Heliosoph ONNX conversion bakes a
// window-8 channel-attention reshape with floor-grid semantics, so any
// padded dimension not divisible by 64 crashes the graph (verified on a
// dimension sweep 2026-08-13; the manifest previously claimed 8).

const DENOISE_INPUT_DIVISIBLE: u32 = 64;

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
    /// Channel order of the RGBA source when packed into the tensor.
    /// `rgb` feeds (R, G, B) — SCUNet. `bgr` feeds (B, G, R) — NAFNet,
    /// which was trained on OpenCV BGR tensors; the output planes are
    /// then mapped back so the returned PNG is RGBA again.
    pub channel_order: ChannelOrder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChannelOrder {
    Rgb,
    Bgr,
}

impl ChannelOrder {
    /// Index of the source channel for tensor plane `c` (0..3).
    fn source_channel(self, c: usize) -> usize {
        match self {
            ChannelOrder::Rgb => c,
            ChannelOrder::Bgr => [2, 1, 0][c],
        }
    }

    /// Index of the tensor plane for output RGBA channel `c` (0..3).
    fn output_plane(self, c: usize) -> usize {
        match self {
            ChannelOrder::Rgb => c,
            ChannelOrder::Bgr => [2, 1, 0][c],
        }
    }
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
            channel_order: ChannelOrder::Rgb,
        }),
        // NAFNet checkpoints (task-validated, see tools/nafnet-export):
        // GoPro deblur width64 (int8 OpenCV export) and the SIDD denoise
        // checkpoint both expect BGR tensors divisible by 16 (the width64
        // encoder's padder_size).
        "nafnet-deblur-gopro" | "nafnet-denoise-sidd" => Some(ImageModelSpec {
            mean: [0.0, 0.0, 0.0],
            std: [1.0, 1.0, 1.0],
            input_divisible: 16,
            channel_order: ChannelOrder::Bgr,
        }),
        "paddleocr-det-v4" => Some(ImageModelSpec {
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            input_divisible: 32,
            channel_order: ChannelOrder::Rgb,
        }),
        "paddleocr-rec-v4" => Some(ImageModelSpec {
            mean: [0.5, 0.5, 0.5],
            std: [0.5, 0.5, 0.5],
            input_divisible: 0,
            channel_order: ChannelOrder::Rgb,
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
            let normalized = pixels[p * 4 + spec.channel_order.source_channel(c)] as f32 / 255.0;
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
            let plane = spec.channel_order.output_plane(c);
            let model_val = out_data[plane * out_pixel_count + p].clamp(0.0, 1.0);
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

// ── LaMa Inpainting ───────────────────────────────────────────────────
// LaMa (Large Mask Inpainting) is a mask-guided inpainting model from
// Samsung AI / saic-mdal. ONNX export: Carve/LaMa-ONNX (lama_fp32.onnx).
//
// Inputs:
//   "image" — [1,3,512,512] float32, pixel values in [0,1] (no mean/std)
//   "mask"  — [1,1,512,512] float32, 1.0 = inpaint, 0.0 = keep
// Output: [1,3,512,512] float32, values already scaled to [0,255]
//   (the ONNX export bakes post-processing into the graph)

/// Request to run LaMa inpainting natively.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LamaInpaintRequest {
    /// RGBA pixel data of the source image.
    pub image_rgba: Vec<u8>,
    pub image_w: u32,
    pub image_h: u32,
    /// Mask: 0 = keep, 255 = fill (inpaint).
    pub mask: Vec<u8>,
    pub mask_w: u32,
    pub mask_h: u32,
    /// Downscale the larger dimension before running inference; the output
    /// is always returned at the original resolution.
    pub preview_max_dimension: Option<u32>,
}

/// Result of a LaMa inpainting operation.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LamaInpaintResult {
    /// Base64-encoded PNG of the inpainted image.
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub model_id: String,
    pub execution_backend: String,
    pub processing_time_ms: u64,
    pub warnings: Vec<String>,
}

const LAMA_INPUT_SIZE: u32 = 512;

/// Run LaMa inpainting with default (non-cancellable) token.
pub fn lama_inpaint(request: LamaInpaintRequest) -> Result<LamaInpaintResult, String> {
    lama_inpaint_cancellable(request, &InferenceCancellationToken::default())
}

/// Cancellable LaMa inpainting.
pub fn lama_inpaint_cancellable(
    request: LamaInpaintRequest,
    cancellation: &InferenceCancellationToken,
) -> Result<LamaInpaintResult, String> {
    let start = std::time::Instant::now();
    let model_id = "lama-inpainting";
    let mut warnings = Vec::new();

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Model path ─────────────────────────────────────────────────────
    let model_path = model::model_path(model_id);
    if !model_path.exists() {
        return Err(format!(
            "LaMa model not found at {}. Download in Settings and try again.",
            model_path.display()
        ));
    }

    // ── Session ────────────────────────────────────────────────────────
    let mut session = checkout_session(&model_path, cancellation)?;

    // ── Input validation ───────────────────────────────────────────────
    let input_names = session.input_names();
    let has_image = input_names.iter().any(|n| n == "image");
    let has_mask = input_names.iter().any(|n| n == "mask");
    if !has_image || !has_mask || input_names.len() != 2 {
        return Err(format!(
            "LaMa model: expected inputs ['image', 'mask'], got {input_names:?}"
        ));
    }

    // ── Determine working dimensions ───────────────────────────────────
    let orig_w = request.image_w;
    let orig_h = request.image_h;
    if orig_w == 0 || orig_h == 0 {
        return Err("LaMa: source image has zero dimensions".to_owned());
    }

    let max_dim = request
        .preview_max_dimension
        .unwrap_or(DEFAULT_PREVIEW_MAX_DIMENSION);

    // Downscale if over preview limit
    let mut work_w = orig_w;
    let mut work_h = orig_h;
    if orig_w > max_dim || orig_h > max_dim {
        let scale = max_dim as f32 / orig_w.max(orig_h) as f32;
        work_w = (orig_w as f32 * scale).round() as u32;
        work_h = (orig_h as f32 * scale).round() as u32;
    }
    work_w = work_w.max(1);
    work_h = work_h.max(1);

    if work_w != orig_w || work_h != orig_h {
        warnings.push(format!(
            "Source downscaled from {}×{} to {}×{} for inference",
            orig_w, orig_h, work_w, work_h
        ));
    }

    // ── Build letterboxed image (RGBA → RGB, resize, pad to 512²) ──────
    let source_rgba =
        ImageBuffer::<Rgba<u8>, _>::from_raw(orig_w, orig_h, request.image_rgba.clone())
            .ok_or("LaMa: failed to create source image buffer")?;

    // Resize to work dimensions
    let work_img = if work_w != orig_w || work_h != orig_h {
        image::imageops::resize(
            &source_rgba,
            work_w,
            work_h,
            image::imageops::FilterType::Triangle,
        )
    } else {
        source_rgba
    };

    // Letterbox to 512×512 (pad with zeros since mean=[0,0,0])
    let scale =
        (LAMA_INPUT_SIZE as f32 / work_w as f32).min(LAMA_INPUT_SIZE as f32 / work_h as f32);
    let content_w = ((work_w as f32 * scale).round() as u32).max(1);
    let content_h = ((work_h as f32 * scale).round() as u32).max(1);
    let offset_x = (LAMA_INPUT_SIZE - content_w) / 2;
    let offset_y = (LAMA_INPUT_SIZE - content_h) / 2;

    let content = image::imageops::resize(
        &work_img,
        content_w,
        content_h,
        image::imageops::FilterType::Triangle,
    )
    .into_raw();

    let mut letterboxed_pixels = vec![0u8; (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE * 4) as usize];
    for y in 0..content_h {
        for x in 0..content_w {
            let dst_idx = ((offset_y + y) * LAMA_INPUT_SIZE + (offset_x + x)) as usize * 4;
            let src_idx = (y * content_w + x) as usize * 4;
            letterboxed_pixels[dst_idx..dst_idx + 4]
                .copy_from_slice(&content[src_idx..src_idx + 4]);
        }
    }

    // ── Pack image as CHW float32 [1,3,512,512], pixel/255, no mean/std ──
    let n = (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize;
    let mut image_tensor = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for pixel in letterboxed_pixels.chunks_exact(4) {
            image_tensor.push(pixel[c as usize] as f32 / 255.0);
        }
    }

    // ── Build letterboxed mask (single channel) ────────────────────────
    // Resize mask to work dimensions if needed
    let mask_work = if request.mask_w != work_w || request.mask_h != work_h {
        let mask_img = image::GrayImage::from_raw(request.mask_w, request.mask_h, request.mask)
            .ok_or("LaMa: invalid mask dimensions")?;
        image::imageops::resize(
            &mask_img,
            work_w,
            work_h,
            image::imageops::FilterType::Nearest,
        )
        .into_raw()
    } else {
        request.mask
    };

    // Letterbox mask
    let mask_content = image::GrayImage::from_raw(work_w, work_h, mask_work)
        .ok_or("LaMa: failed to rebuild mask")?;
    let mask_resized = image::imageops::resize(
        &mask_content,
        content_w,
        content_h,
        image::imageops::FilterType::Nearest,
    )
    .into_raw();

    let mut letterboxed_mask = vec![0u8; (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize];
    for y in 0..content_h {
        for x in 0..content_w {
            let dst_idx = ((offset_y + y) * LAMA_INPUT_SIZE + (offset_x + x)) as usize;
            let src_idx = (y * content_w + x) as usize;
            letterboxed_mask[dst_idx] = mask_resized[src_idx];
        }
    }

    // Pack mask as CHW float32 [1,1,512,512], 0.0=keep / 1.0=fill
    let mut mask_tensor = Vec::with_capacity((LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize);
    for &m in &letterboxed_mask {
        mask_tensor.push(m as f32 / 255.0);
    }

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Run inference ─────────────────────────────────────────────────
    let dims = [
        1usize,
        3,
        LAMA_INPUT_SIZE as usize,
        LAMA_INPUT_SIZE as usize,
    ];
    let output = session.run_multi(&[
        ("image", &image_tensor, &dims[..]),
        (
            "mask",
            &mask_tensor,
            &[
                1usize,
                1,
                LAMA_INPUT_SIZE as usize,
                LAMA_INPUT_SIZE as usize,
            ],
        ),
    ])?;

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Validate output ────────────────────────────────────────────────
    let out_shape = &output.shape.0;
    if out_shape.len() != 4 || out_shape[0] != 1 || out_shape[1] != 3 {
        return Err(format!(
            "LaMa: unexpected output shape {out_shape:?}, expected [1,3,512,512]"
        ));
    }
    let out_h = out_shape[2] as u32;
    let out_w = out_shape[3] as u32;
    let out_data = output.data;
    let out_pixel_count = (out_w * out_h) as usize;
    if out_h != LAMA_INPUT_SIZE || out_w != LAMA_INPUT_SIZE {
        return Err(format!(
            "LaMa: output dimensions {out_w}×{out_h}, expected {LAMA_INPUT_SIZE}×{LAMA_INPUT_SIZE}"
        ));
    }
    if out_data.len() != out_pixel_count * 3 {
        return Err(format!(
            "LaMa: output data length {} != expected {}",
            out_data.len(),
            out_pixel_count * 3
        ));
    }

    // ── Crop letterbox to content region ───────────────────────────────
    // The model outputs values already scaled to [0,255].
    let mut crop_rgba = Vec::with_capacity((content_w * content_h * 4) as usize);
    for y in 0..content_h {
        for x in 0..content_w {
            let sx = (offset_x + x).min(LAMA_INPUT_SIZE - 1);
            let sy = (offset_y + y).min(LAMA_INPUT_SIZE - 1);
            let src_idx = (sy * LAMA_INPUT_SIZE + sx) as usize;
            for c in 0..3 {
                let v = out_data[c * out_pixel_count + src_idx].clamp(0.0, 255.0);
                crop_rgba.push(v.round() as u8);
            }
            crop_rgba.push(255u8); // opaque alpha
        }
    }

    // ── Scale back to original dimensions ──────────────────────────────
    let crop_img = ImageBuffer::<Rgba<u8>, _>::from_raw(content_w, content_h, crop_rgba)
        .ok_or("LaMa: failed to build crop buffer")?;
    let final_rgba = if content_w != orig_w || content_h != orig_h {
        image::imageops::resize(
            &crop_img,
            orig_w,
            orig_h,
            image::imageops::FilterType::Triangle,
        )
        .into_raw()
    } else {
        crop_img.into_raw()
    };

    // ── Encode as PNG base64 ───────────────────────────────────────────
    let png_base64 = {
        use base64::Engine;
        use image::codecs::png::PngEncoder;
        use image::ExtendedColorType;
        use image::ImageEncoder;
        let mut png_bytes: Vec<u8> = Vec::new();
        let encoder = PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(&final_rgba, orig_w, orig_h, ExtendedColorType::Rgba8)
            .map_err(|e| format!("LaMa PNG encode error: {e}"))?;
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    };

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let elapsed = start.elapsed();
    Ok(LamaInpaintResult {
        png_base64,
        width: orig_w,
        height: orig_h,
        model_id: model_id.to_owned(),
        execution_backend: "ort-native".to_owned(),
        processing_time_ms: elapsed.as_millis() as u64,
        warnings,
    })
}

// ── SHA-256 stream verification ────────────────────────────────────────

/// Compute SHA-256 digest of a file by streaming it in 64 KB chunks.
/// Never loads the entire file into memory.
pub fn stream_sha256(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {} for hashing: {e}", path.display()))?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("Read error during SHA-256: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = hasher.finalize();
    Ok(hash.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// Verify that a model file matches its expected SHA-256 digest.
///
/// Returns `Ok(())` if the digest matches or if `expected` is `None` (skip).
/// Returns `Err` on mismatch or IO error.
pub fn verify_model_sha256(path: &std::path::Path, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let expected = expected.trim().to_lowercase();
    if expected.is_empty() {
        return Ok(());
    }
    let actual = stream_sha256(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ))
    }
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

/// Convert raw model output to a soft mask byte per pixel, following the
/// rembg reference semantics for the pinned checkpoints:
///
/// 1. apply sigmoid where the graph does not bake it (BiRefNet exports);
/// 2. clamp the result to [0, 1] — the rembg `post_process` does
///    `np.clip(mat, 0, 1)`, it does not min-max stretch the map.
///
/// A min-max stretch is input-dependent: it inflates semi-transparent edge
/// values and amplifies noise in near-flat regions, diverging from the
/// reference soft alpha (measured up to ~0.065 MAE on the benchmark corpus).
/// It is monotone, so thresholded binary metrics are unaffected by the
/// change, but soft edge alpha now matches the reference.
fn normalize_segmentation_output(data: &[f32], apply_sigmoid: bool) -> Vec<u8> {
    data.iter()
        .map(|value| {
            let probability = if apply_sigmoid {
                1.0 / (1.0 + (-value).exp())
            } else {
                *value
            };
            ((probability.clamp(0.0, 1.0)) * 255.0).round() as u8
        })
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

    fn decode_gray_png(png: &[u8]) -> Vec<u8> {
        let image = image::load_from_memory(png).expect("png should decode");
        let gray = image.to_luma8();
        gray.into_raw()
    }

    #[test]
    fn normalizes_u2net_probabilities_to_reference_scale() {
        // rembg-faithful: probability * 255 with clamp — no min-max stretch.
        assert_eq!(
            normalize_segmentation_output(&[0.2, 0.4, 0.6], false),
            vec![51, 102, 153]
        );
    }

    #[test]
    fn applies_birefnet_sigmoid() {
        assert_eq!(
            normalize_segmentation_output(&[-2.0, 0.0, 2.0], true),
            vec![30, 128, 225]
        );
    }

    #[test]
    fn clamps_out_of_range_logits_to_valid_soft_mask() {
        // Sigmoid output is bounded, but a malformed graph output must not
        // escape the 0-255 range; negative probabilities clamp to 0.
        assert_eq!(
            normalize_segmentation_output(&[-100.0, 0.0, 100.0], false),
            vec![0, 0, 255]
        );
        let sigmoided = normalize_segmentation_output(&[-50.0, 0.0, 50.0], true);
        assert_eq!(sigmoided[0], 0);
        assert_eq!(sigmoided[2], 255);
        assert_eq!(sigmoided[1], 128);
    }

    #[test]
    fn flat_output_stays_at_its_true_probability_not_stretched() {
        // The old min-max path stretched a near-flat map to full contrast,
        // turning soft probability bands into hard edges.
        assert_eq!(
            normalize_segmentation_output(&[0.5, 0.51, 0.52], false),
            vec![128, 130, 133]
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

    /// Native-parity golden test against the checked-in rembg reference mask
    /// for the bundled u2netp model and one deterministic synthetic fixture.
    ///
    /// Gated on `ORT_DYLIB_PATH`: running it requires the bundled onnxruntime
    /// dylib, which ordinary CI does not have. The threshold is deliberately
    /// loose (IoU ≥ 0.98): the reference was generated with a different ORT
    /// patch version and resize kernel, and the test exists to catch pipeline
    /// regressions (wrong normalization, broken letterbox, double sigmoid),
    /// not to pin pixel-exact output.
    #[test]
    #[ignore = "requires ORT_DYLIB_PATH pointing at a bundled onnxruntime dylib"]
    fn native_u2netp_matches_reference_mask_within_tolerance() {
        let Ok(dylib) = std::env::var("ORT_DYLIB_PATH") else {
            return;
        };
        let root = env!("CARGO_MANIFEST_DIR");
        let fixture = format!(
            "{root}/../../tests/fixtures/bg-removal-corpus/synthetic/synth-hair.png"
        );
        let reference = format!(
            "{root}/../../tests/fixtures/bg-removal-corpus/reference/synth-hair-u2netp-rembg.png"
        );
        if !std::path::Path::new(&reference).is_file() {
            return; // reference artifact not checked out; nothing to compare
        }
        crate::runtime::init_native_runtime(std::path::Path::new(&dylib))
            .expect("onnxruntime dylib should load");
        let model = crate::model::model_path("u2netp");
        std::fs::create_dir_all(model.parent().expect("model parent"))
            .expect("model dir");
        std::fs::copy(
            format!("{root}/../../apps/desktop/public/models/u2netp.onnx"),
            &model,
        )
        .expect("stage bundled model");
        let image = image::open(&fixture).expect("fixture should decode");
        let result = crate::inference::remove_ai(
            &image,
            &crate::RemovalOptions {
                method: crate::RemovalMethod::AiBalanced,
                tolerance: None,
                feather_radius: Some(0.0),
                decontaminate: Some(false),
                click_x: None,
                click_y: None,
                preview_max_dimension: Some(4096),
            },
            "u2netp",
        )
        .expect("inference should succeed");
        let png = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &result.mask_base64,
        )
        .expect("mask base64");
        let predicted = decode_gray_png(&png);
        let expected = decode_gray_png(&std::fs::read(&reference).expect("reference"));

        let metrics = crate::metrics::compute_mask_metrics(
            &predicted,
            &expected,
            result.width,
            result.height,
            crate::metrics::MaskMetricsOptions::default(),
        );
        assert!(
            metrics.iou >= 0.98,
            "native u2netp diverged from the rembg reference on synth-hair: {metrics:?}"
        );
        assert!(metrics.mae <= 0.02, "mask MAE too high: {metrics:?}");
    }
}
