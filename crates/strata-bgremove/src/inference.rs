//! ONNX model inference for AI-powered background removal.
//!
//! Uses the `ort` crate (ONNX Runtime Rust bindings) to run
//! segmentation models on-device with optional GPU acceleration.

use image::DynamicImage;
use ort::{Session, SessionBuilder, Value};

use crate::{mask_to_base64, model, RemovalOptions, RemovalResult};

/// Run AI background removal on an image using the specified model.
pub fn remove_ai(
    img: &DynamicImage,
    opts: &RemovalOptions,
    model_id: &str,
) -> Result<RemovalResult, String> {
    let start = std::time::Instant::now();

    let model_path = model::model_path(model_id);
    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not found at {}. Please download it first.",
            model_id,
            model_path.display()
        ));
    }

    let session = SessionBuilder::new()
        .map_err(|e| format!("Failed to create ONNX session: {e}"))?
        .with_model_from_file(&model_path)
        .map_err(|e| format!("Failed to load model '{model_id}': {e}"))?;

    let (orig_w, orig_h) = img.dimensions();

    // Resize to model input size (1024x1024 for BiRefNet, 320x320 for u2netp)
    let input_size = if model_id == "u2netp" {
        320u32
    } else {
        1024u32
    };
    let resized = img.resize_exact(
        input_size,
        input_size,
        image::imageops::FilterType::Lanczos3,
    );
    let rgba = resized.to_rgba8();
    let pixels = rgba.into_raw();

    // Convert RGBA to float32 tensor (NCHW format)
    let n = (input_size * input_size) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for y in 0..input_size {
            for x in 0..input_size {
                let i = ((y * input_size + x) * 4 + c) as usize;
                tensor_data.push(pixels[i] as f32 / 255.0);
            }
        }
    }

    let tensor = Value::from_array(
        session.allocator(),
        &[1i64, 3, input_size as i64, input_size as i64],
        &tensor_data,
    )
    .map_err(|e| format!("Failed to create input tensor: {e}"))?;

    let outputs = session
        .run(ort::inputs! { "input" => tensor }.map_err(|e| format!("Input binding error: {e}"))?)
        .map_err(|e| format!("ONNX inference failed: {e}"))?;

    // Get the output tensor (the mask)
    let output_name = session
        .outputs
        .first()
        .ok_or("No output found in model")?
        .name
        .clone();

    let output = outputs
        .get(&output_name)
        .ok_or("Output not found in results")?;

    let output_data = output
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

    // Convert sigmoid output to binary mask
    let mask_size = output_data.len();
    let mask_dim = (mask_size as f64).sqrt() as u32;
    let mut mask = vec![0u8; mask_size];

    for (i, &val) in output_data.iter().enumerate() {
        mask[i] = if val > 0.5 { 255 } else { 0 };
    }

    // Upscale mask to original image dimensions
    let resized_mask = resize_mask(&mask, mask_dim, mask_dim, orig_w, orig_h);

    // Apply feather if requested
    let final_mask = if opts.feather_radius.unwrap_or(0.0) > 0.0 {
        crate::heuristic::apply_feather(
            &resized_mask,
            orig_w,
            orig_h,
            opts.feather_radius.unwrap_or(0.0),
        )
    } else {
        resized_mask
    };

    let confidence = 0.85; // AI models generally have high confidence
    let mask_base64 = mask_to_base64(&final_mask, orig_w, orig_h)?;
    let elapsed = start.elapsed();

    Ok(RemovalResult {
        mask_base64,
        confidence,
        method: model_id.to_string(),
        processing_time_ms: elapsed.as_millis() as u64,
        width: orig_w,
        height: orig_h,
    })
}

/// Nearest-neighbor resize of a binary mask.
fn resize_mask(mask: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    if src_w == dst_w && src_h == dst_h {
        return mask.to_vec();
    }

    let mut result = vec![0u8; (dst_w * dst_h) as usize];
    for dy in 0..dst_h {
        for dx in 0..dst_w {
            let sx = (dx * src_w) / dst_w;
            let sy = (dy * src_h) / dst_h;
            let src_idx = (sy * src_w + sx).min(mask.len() as u32 - 1) as usize;
            result[(dy * dst_w + dx) as usize] = mask[src_idx];
        }
    }
    result
}
