//! Real-ESRGAN ONNX inference (feature = "ai").

use ort::{session::Session, value::Tensor};

use crate::{cpu_upscale, model_path, UpscaleFilter};

const TILE: u32 = 64;
const OVERLAP: u32 = 8;
const SCALE: f64 = 4.0;

/// Run Real-ESRGAN (or compatible x4 RGB ONNX) on RGBA pixels.
///
/// RGB is inferred by the model; alpha is Catmull-Rom resized and reattached.
pub fn ai_upscale(
    pixels: &[u8],
    width: u32,
    height: u32,
    model_id: &str,
) -> Result<Vec<u8>, String> {
    if pixels.len() as u32 != width * height * 4 {
        return Err("Pixel buffer size does not match dimensions".into());
    }

    let path = model_path(model_id);
    if !path.exists() {
        return Err(format!(
            "Upscale model '{model_id}' not found at {}. Download via Settings > Models.",
            path.display()
        ));
    }

    let mut session = Session::builder()
        .map_err(|e| format!("Failed to create ONNX session: {e}"))?
        .commit_from_file(&path)
        .map_err(|e| format!("Failed to load upscale model '{model_id}': {e}"))?;

    let out_w = (width as f64 * SCALE).round() as u32;
    let out_h = (height as f64 * SCALE).round() as u32;
    let mut rgb_out = vec![0u8; (out_w * out_h * 3) as usize];

    let step = TILE.saturating_sub(OVERLAP).max(1);
    for sy in (0..height).step_by(step as usize) {
        for sx in (0..width).step_by(step as usize) {
            let tile_w = TILE.min(width - sx);
            let tile_h = TILE.min(height - sy);
            let mut tile = Vec::with_capacity((tile_w * tile_h * 4) as usize);
            for y in sy..(sy + tile_h) {
                let start = (y * width + sx) as usize * 4;
                tile.extend_from_slice(&pixels[start..start + tile_w as usize * 4]);
            }

            let up = infer_tile(&mut session, &tile, tile_w, tile_h)?;
            let tw = (tile_w as f64 * SCALE).round() as u32;
            let th = (tile_h as f64 * SCALE).round() as u32;
            let ox = (sx as f64 * SCALE).round() as u32;
            let oy = (sy as f64 * SCALE).round() as u32;

            for ty in 0..th.min(out_h.saturating_sub(oy)) {
                for tx in 0..tw.min(out_w.saturating_sub(ox)) {
                    let src = (ty * tw + tx) as usize * 3;
                    let dst = ((oy + ty) * out_w + (ox + tx)) as usize * 3;
                    rgb_out[dst..dst + 3].copy_from_slice(&up[src..src + 3]);
                }
            }
        }
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

fn infer_tile(session: &mut Session, rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let n = (w * h) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for i in 0..n {
            tensor_data.push(rgba[i * 4 + c] as f32 / 255.0);
        }
    }

    let tensor = Tensor::from_array(([1usize, 3, h as usize, w as usize], tensor_data))
        .map_err(|e| format!("Failed to create input tensor: {e}"))?;

    let input_name = session
        .inputs()
        .first()
        .ok_or("No input found in upscale model")?
        .name()
        .to_owned();
    let output_name = session
        .outputs()
        .first()
        .ok_or("No output found in upscale model")?
        .name()
        .to_owned();

    let outputs = session
        .run(ort::inputs! { input_name.as_str() => tensor })
        .map_err(|e| format!("ONNX inference failed: {e}"))?;

    let output = outputs.get(&output_name).ok_or("Missing upscale output")?;
    let (_, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to extract upscale output: {e}"))?;

    let out_h = h * 4;
    let out_w = w * 4;
    let plane = (out_h * out_w) as usize;
    if data.len() < plane * 3 {
        return Err(format!(
            "Unexpected upscale output length {} (expected >= {})",
            data.len(),
            plane * 3
        ));
    }

    let mut rgb = vec![0u8; plane * 3];
    for y in 0..out_h {
        for x in 0..out_w {
            let i = (y * out_w + x) as usize;
            let r = data[i].clamp(0.0, 1.0);
            let g = data[plane + i].clamp(0.0, 1.0);
            let b = data[plane * 2 + i].clamp(0.0, 1.0);
            rgb[i * 3] = (r * 255.0).round() as u8;
            rgb[i * 3 + 1] = (g * 255.0).round() as u8;
            rgb[i * 3 + 2] = (b * 255.0).round() as u8;
        }
    }
    Ok(rgb)
}
