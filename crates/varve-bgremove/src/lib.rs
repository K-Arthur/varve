//! Background removal for Strata.
//!
//! Two-tier architecture:
//! 1. **Heuristic** (always available) — flood fill, chroma key, edge detection.
//! 2. **AI** (feature-gated `ai`) — ONNX model inference via `ort` crate.
//!
//! The AI feature requires a downloaded ONNX model and the `ort` runtime.
//! Without the `ai` feature, only heuristic methods are available.

pub mod heuristic;
pub mod metrics;

#[cfg(feature = "ai")]
pub mod inference;
#[cfg(feature = "ai")]
pub mod model;
#[cfg(feature = "ai")]
pub mod runtime;
#[cfg(feature = "ai")]
pub mod session_pool;

use image::DynamicImage;

/// Methods for background removal.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum RemovalMethod {
    /// Non-AI heuristic (flood fill, chroma key, k-means, edge detect).
    Quick,
    /// AI-powered removal using IS-Net General Use.
    #[cfg(feature = "ai")]
    AiBalanced,
    /// AI-powered removal using BiRefNet Lite (high quality).
    #[cfg(feature = "ai")]
    AiQuality,
}

/// Options for background removal processing.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RemovalOptions {
    pub method: RemovalMethod,
    /// Tolerance for flood fill / chroma key (0-255, default 30).
    pub tolerance: Option<u8>,
    /// Gaussian blur radius applied to mask edges (pixels, default 0).
    pub feather_radius: Option<f32>,
    /// Remove background color spill from foreground edges.
    pub decontaminate: Option<bool>,
    /// Click point for flood fill (x coordinate, 0-based).
    pub click_x: Option<u32>,
    /// Click point for flood fill (y coordinate, 0-based).
    pub click_y: Option<u32>,
    /// Downscale source before inference; mask upscaled to original dimensions.
    pub preview_max_dimension: Option<u32>,
}

/// Result of a background removal operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RemovalResult {
    /// Base64-encoded PNG of the alpha mask.
    pub mask_base64: String,
    /// Confidence score 0.0–1.0.
    pub confidence: f32,
    /// Which method was used.
    pub method: String,
    /// Processing time in milliseconds.
    pub processing_time_ms: u64,
    /// Width of the mask in pixels.
    pub width: u32,
    /// Height of the mask in pixels.
    pub height: u32,
}

/// Remove the background from an image using the specified method.
///
/// # Arguments
/// * `img` — The input image as a `DynamicImage`.
/// * `opts` — Processing options including method and parameters.
///
/// # Returns
/// A `RemovalResult` containing the base64-encoded alpha mask PNG.
pub fn remove_background(
    img: &DynamicImage,
    opts: &RemovalOptions,
) -> Result<RemovalResult, String> {
    match opts.method {
        RemovalMethod::Quick => heuristic::remove_quick(img, opts),
        #[cfg(feature = "ai")]
        RemovalMethod::AiBalanced => inference::remove_ai(img, opts, "isnet-general-use"),
        #[cfg(feature = "ai")]
        RemovalMethod::AiQuality => inference::remove_ai(img, opts, "birefnet-general-lite"),
    }
}

/// Check whether the AI feature was compiled in.
///
/// This is a compile-time check only — it says nothing about whether the
/// onnxruntime dylib actually loaded at runtime. Use
/// [`runtime::native_ai_ready`] (feature-gated) to check real availability
/// before routing inference to the native path.
pub fn has_ai() -> bool {
    cfg!(feature = "ai")
}

/// Denoise an image using a fully-convolutional model (SCUNet).
#[cfg(feature = "ai")]
pub fn denoise_image(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
) -> Result<DenoiseResult, String> {
    inference::denoise_image(img, strength, model_id)
}

/// Cancellable native denoise. Cancellation suppresses stale results without
/// discarding a healthy cached model session.
#[cfg(feature = "ai")]
pub fn denoise_image_cancellable(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
    cancellation: &session_pool::InferenceCancellationToken,
) -> Result<DenoiseResult, String> {
    inference::denoise_image_cancellable(img, strength, model_id, cancellation)
}

/// Run LaMa inpainting natively (non-cancellable).
#[cfg(feature = "ai")]
pub fn lama_inpaint(request: LamaInpaintRequest) -> Result<LamaInpaintResult, String> {
    inference::lama_inpaint(request)
}

/// Run LaMa inpainting natively (cancellable).
#[cfg(feature = "ai")]
pub fn lama_inpaint_cancellable(
    request: LamaInpaintRequest,
    cancellation: &session_pool::InferenceCancellationToken,
) -> Result<LamaInpaintResult, String> {
    inference::lama_inpaint_cancellable(request, cancellation)
}

#[cfg(feature = "ai")]
pub use inference::{
    session_pool_metrics, unload_all_model_sessions, unload_model_session, LamaInpaintRequest,
    LamaInpaintResult,
};

#[cfg(feature = "ai")]
pub use session_pool::{InferenceCancellationToken, SessionPoolMetrics};

/// Result of a denoise operation (re-exported for callers).
#[cfg(feature = "ai")]
pub use inference::DenoiseResult;

/// Check whether the model id is a known fully-convolutional (dynamic-shape)
/// model supported by [`denoise_image`] or the OCR pipeline.
#[cfg(feature = "ai")]
pub fn is_image_model(model_id: &str) -> bool {
    matches!(
        model_id,
        "scunet"
            | "nafnet-deblur-gopro"
            | "nafnet-denoise-sidd"
            | "paddleocr-det-v4"
            | "paddleocr-rec-v4"
    )
}

/// Encode a binary mask buffer (0 or 255 per pixel) as a base64 PNG.
pub fn mask_to_base64(mask: &[u8], width: u32, height: u32) -> Result<String, String> {
    use base64::Engine;
    use image::codecs::png::PngEncoder;
    use image::ExtendedColorType;
    use image::ImageEncoder;

    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for &v in mask {
        rgba.push(v);
        rgba.push(v);
        rgba.push(v);
        rgba.push(v);
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(&rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| format!("PNG encode error: {e}"))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
}
