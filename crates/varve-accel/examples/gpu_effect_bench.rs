//! End-to-end CPU vs native-GPU benchmark for the RGB split kernel.
//!
//! Usage: `cargo run --release -p varve-accel --example gpu_effect_bench`
//!
//! Reports wall-clock source-to-result time: the GPU number includes buffer
//! upload, dispatch, synchronization, and readback — not just kernel time.

use std::time::Instant;

use varve_accel::effects::GpuEffectEngine;
use varve_effects::{apply_effect, EffectKind, EffectQuality, EffectRequest};

fn synthetic(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            let fx = x as f32 / width as f32;
            let fy = y as f32 / height as f32;
            rgba[i] = (fx * 255.0) as u8;
            rgba[i + 1] = (fy * 255.0) as u8;
            rgba[i + 2] = (((fx * 7.0).sin() * (fy * 5.0).cos() * 0.5 + 0.5) * 255.0) as u8;
            rgba[i + 3] = if (x / 13 + y / 11) % 7 == 0 { 160 } else { 255 };
        }
    }
    rgba
}

fn main() {
    let engine = match GpuEffectEngine::create() {
        Ok(engine) => engine,
        Err(err) => {
            eprintln!("native GPU unavailable: {err}");
            return;
        }
    };
    let info = engine.info();
    println!(
        "native GPU: {} ({}, {})",
        info.name, info.backend, info.device_type
    );

    let request_for = |width: u32, height: u32| EffectRequest {
        effect: EffectKind::RgbSplit,
        width,
        height,
        quality: EffectQuality::Export,
        coord_space: None,
        params: serde_json::json!({
            "mode": "offset",
            "redX": 8.0,
            "redY": -4.0,
            "blueX": -6.0,
            "blueY": 3.0,
        }),
    };

    println!(
        "{:>10}  {:>12}  {:>12}  {:>9}",
        "size", "cpu (ms)", "gpu (ms)", "speedup"
    );
    for size in [512u32, 1024, 2048, 4096] {
        let input = synthetic(size, size);
        let request = request_for(size, size);

        // Warm the pipeline so the GPU number is steady-state, matching the
        // CPU number's steady-state.
        let _ = engine.apply(&request, &input).expect("gpu warmup");

        let cpu_started = Instant::now();
        let cpu = apply_effect(&request, &input).expect("cpu effect");
        let cpu_ms = cpu_started.elapsed().as_secs_f64() * 1000.0;

        let mut samples = Vec::new();
        for _ in 0..3 {
            let started = Instant::now();
            let (gpu, _) = engine.apply(&request, &input).expect("gpu effect");
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            if gpu.len() != cpu.len() {
                eprintln!("size mismatch at {size}");
            }
        }
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let gpu_ms = samples[samples.len() / 2];
        println!(
            "{:>10}  {:>12.2}  {:>12.2}  {:>8.1}x",
            format!("{size}x{size}"),
            cpu_ms,
            gpu_ms,
            cpu_ms / gpu_ms.max(0.001)
        );
    }
}
