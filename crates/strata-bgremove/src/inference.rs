//! ONNX model inference for AI-powered background removal.
//!
//! Uses the `ort` crate (ONNX Runtime Rust bindings) to run
//! segmentation models on-device. Opt-in via the `ai` Cargo feature.

use image::{DynamicImage, GenericImageView};
use ort::{session::Session, value::Tensor};

use crate::{heuristic, mask_to_base64, model, RemovalOptions, RemovalResult};

/// Default preview downscale cap (matches TS `DEFAULT_PREVIEW_MAX_DIMENSION`).
const DEFAULT_PREVIEW_MAX_DIMENSION: u32 = 2048;

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
            "Model '{}' not found at {}. Download via Settings or export from webview.",
            model_id,
            model_path.display()
        ));
    }

    let mut session = Session::builder()
        .map_err(|e| format!("Failed to create ONNX session: {e}"))?
        .commit_from_file(&model_path)
        .map_err(|e| format!("Failed to load model '{model_id}': {e}"))?;

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

    let input_size = if model_id == "u2netp" {
        320u32
    } else {
        1024u32
    };
    let resized = source.resize_exact(
        input_size,
        input_size,
        image::imageops::FilterType::Triangle,
    );
    let rgba = resized.to_rgba8();
    let pixels = rgba.into_raw();

    let n = (input_size * input_size) as usize;
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
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

    let tensor = Tensor::from_array((
        [1usize, 3, input_size as usize, input_size as usize],
        tensor_data,
    ))
    .map_err(|e| format!("Failed to create input tensor: {e}"))?;

    let input_name = session
        .inputs()
        .first()
        .ok_or("No input found in model")?
        .name()
        .to_owned();
    let output_name = session
        .outputs()
        .first()
        .ok_or("No output found in model")?
        .name()
        .to_owned();

    let outputs = session
        .run(ort::inputs! { input_name.as_str() => tensor })
        .map_err(|e| format!("ONNX inference failed: {e}"))?;

    let output = outputs
        .get(&output_name)
        .ok_or("Output not found in results")?;

    let (_, output_data) = output
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

    let mask_size = output_data.len();
    let mask_dim = (mask_size as f64).sqrt() as u32;
    let mask = normalize_segmentation_output(output_data, model_id != "u2netp");
    let mut confidence_sum = 0.0f32;
    for value in &mask {
        confidence_sum += (*value as f32 / 255.0 - 0.5).abs();
    }
    let confidence = if mask_size > 0 {
        ((confidence_sum / mask_size as f32) * 2.0).min(1.0)
    } else {
        0.0
    };

    let mut resized_mask = resize_mask(&mask, mask_dim, mask_dim, orig_w, orig_h);

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
    use super::{normalize_segmentation_output, resize_mask};

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
}
