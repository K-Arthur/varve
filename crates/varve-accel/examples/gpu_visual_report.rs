//! Writes inspectable CPU/GPU comparison PNGs plus an amplified difference
//! image so a human can review parity instead of trusting a metric alone.
//!
//! Usage: `cargo run --release -p varve-accel --example gpu_visual_report`
//! Output: `reports/native-gpu/` (override with `VARVE_GPU_REPORT_DIR`).

use image::{ImageBuffer, Rgba};
use varve_accel::effects::{GpuEffectEngine, GpuResampleFilter};
use varve_effects::{apply_effect, EffectKind, EffectQuality, EffectRequest};
use varve_upscale::{cpu_upscale, UpscaleFilter};

fn synthetic(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    let cx = width as f64 * 0.42;
    let cy = height as f64 * 0.55;
    let radius = width.min(height) as f64 * 0.32;
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            let fx = x as f64 / (width.max(2) - 1) as f64;
            let fy = y as f64 / (height.max(2) - 1) as f64;
            let checker = if ((x / 24) + (y / 24)) % 2 == 0 {
                26.0
            } else {
                0.0
            };
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let inside = dx * dx + dy * dy < radius * radius;
            rgba[i] = (fx * 200.0 + checker).clamp(0.0, 255.0) as u8;
            rgba[i + 1] = (fy * 190.0 + checker).clamp(0.0, 255.0) as u8;
            rgba[i + 2] = (((fx * 6.0).sin() * (fy * 5.0).cos() * 90.0 + 128.0 + checker)
                .clamp(0.0, 255.0)) as u8;
            rgba[i + 3] = if inside { 255 } else { 8 };
        }
    }
    rgba
}

fn save(path: &std::path::Path, width: u32, height: u32, rgba: &[u8]) {
    let buffer =
        ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba.to_vec()).expect("image buffer");
    buffer.save(path).expect("write png");
}

fn amplified_diff(cpu: &[u8], gpu: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(cpu.len());
    for (a, b) in cpu.iter().zip(gpu.iter()) {
        out.push(((*a as i32 - *b as i32).unsigned_abs() as u32 * 24).min(255) as u8);
    }
    // Force opaque alpha so equal pixels read as black, not transparent.
    for pixel in out.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    out
}

fn main() {
    let dir = std::env::var("VARVE_GPU_REPORT_DIR").unwrap_or_else(|_| "reports/native-gpu".into());
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).expect("report dir");

    let engine = GpuEffectEngine::create().expect("native GPU");
    println!("device: {}", engine.info().name);

    let (width, height) = (640u32, 480u32);
    let input = synthetic(width, height);
    let request = EffectRequest {
        effect: EffectKind::RgbSplit,
        width,
        height,
        quality: EffectQuality::Export,
        coord_space: None,
        params: serde_json::json!({
            "mode": "radial",
            "amount": 9.0,
            "falloff": 1.2,
            "fringeAngle": 25.0,
            "centerX": 0.42,
            "centerY": 0.55,
            "borderMode": "clamp",
        }),
    };
    let cpu = apply_effect(&request, &input).expect("cpu rgb split");
    let (gpu, _) = engine.apply(&request, &input).expect("gpu rgb split");
    save(&dir.join("rgb-split-cpu.png"), width, height, &cpu);
    save(&dir.join("rgb-split-gpu.png"), width, height, &gpu);
    save(
        &dir.join("rgb-split-diff-x24.png"),
        width,
        height,
        &amplified_diff(&cpu, &gpu),
    );

    let (src_w, src_h) = (320u32, 240u32);
    let (dst_w, dst_h) = (800u32, 600u32);
    let small = synthetic(src_w, src_h);
    let scale = f64::from(dst_w) / f64::from(src_w);
    let cpu =
        cpu_upscale(&small, src_w, src_h, scale, UpscaleFilter::CatmullRom).expect("cpu resample");
    let (gpu, _) = engine
        .resample(
            &small,
            src_w,
            src_h,
            dst_w,
            dst_h,
            GpuResampleFilter::Bicubic,
        )
        .expect("gpu resample");
    save(&dir.join("resample-cpu.png"), dst_w, dst_h, &cpu);
    save(&dir.join("resample-gpu.png"), dst_w, dst_h, &gpu);
    save(
        &dir.join("resample-diff-x24.png"),
        dst_w,
        dst_h,
        &amplified_diff(&cpu, &gpu),
    );

    println!("wrote comparison images to {}", dir.display());
}
