//! End-to-end CPU vs native-GPU benchmark for resampling (non-AI upscale).
//!
//! Usage:
//! - Synthetic baseline: `cargo run --release -p varve-accel --example gpu_resample_bench`
//! - Real photograph: `cargo run --release -p varve-accel --example gpu_resample_bench -- <photo.png|photo.jpg> [output-dir]`
//!
//! The GPU number includes upload, dispatch, synchronization, and readback.
//! A photo run also checks CPU/GPU pixel parity and writes both outputs plus an
//! amplified difference image for visual review.

use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::Instant;

use varve_accel::effects::{GpuEffectEngine, GpuResampleFilter};
use varve_upscale::{cpu_upscale, tiled_upscale, UpscaleFilter};

fn synthetic(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            rgba[i] = ((x * 7 + y * 3) % 256) as u8;
            rgba[i + 1] = ((x * 2 + y * 5) % 256) as u8;
            rgba[i + 2] = (((x ^ y) * 3) % 256) as u8;
            rgba[i + 3] = 255;
        }
    }
    rgba
}

fn diff_metrics(cpu: &[u8], gpu: &[u8]) -> Result<(i32, f64, f64), Box<dyn Error>> {
    if cpu.len() != gpu.len() || cpu.is_empty() {
        return Err("CPU/GPU resample outputs have different or empty lengths".into());
    }
    let mut max_diff = 0i32;
    let mut sum = 0f64;
    let mut squared = 0f64;
    for (a, b) in cpu.iter().zip(gpu) {
        let diff = (*a as i32 - *b as i32).abs();
        max_diff = max_diff.max(diff);
        sum += f64::from(diff);
        squared += f64::from(diff) * f64::from(diff);
    }
    let len = cpu.len() as f64;
    let mse = squared / len;
    let psnr = if mse == 0.0 {
        999.0
    } else {
        10.0 * (255.0f64 * 255.0 / mse).log10()
    };
    Ok((max_diff, sum / len, psnr))
}

fn save_rgba(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), Box<dyn Error>> {
    let image = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or("resample output dimensions do not match its byte length")?;
    image.save(path)?;
    Ok(())
}

fn save_photo_evidence(
    output_dir: &Path,
    filter: &str,
    width: u32,
    height: u32,
    cpu: &[u8],
    gpu: &[u8],
) -> Result<(), Box<dyn Error>> {
    std::fs::create_dir_all(output_dir)?;
    let diff: Vec<u8> = cpu
        .iter()
        .zip(gpu)
        .map(|(a, b)| ((i32::from(*a) - i32::from(*b)).unsigned_abs() * 32).min(255) as u8)
        .collect();
    save_rgba(
        &output_dir.join(format!("{filter}-cpu.png")),
        width,
        height,
        cpu,
    )?;
    save_rgba(
        &output_dir.join(format!("{filter}-gpu.png")),
        width,
        height,
        gpu,
    )?;
    save_rgba(
        &output_dir.join(format!("{filter}-diff-32x.png")),
        width,
        height,
        &diff,
    )?;
    Ok(())
}

fn benchmark_case(
    engine: &GpuEffectEngine,
    case_name: &str,
    input: &[u8],
    width: u32,
    height: u32,
    factor: u32,
    photo_output: Option<&Path>,
) -> Result<(), Box<dyn Error>> {
    let out_w = width * factor;
    let out_h = height * factor;
    let scale = f64::from(factor);
    for (name, cpu_filter, gpu_filter) in [
        (
            "bicubic",
            UpscaleFilter::CatmullRom,
            GpuResampleFilter::Bicubic,
        ),
        (
            "lanczos3",
            UpscaleFilter::Lanczos3,
            GpuResampleFilter::Lanczos3,
        ),
    ] {
        // Warm the pipeline.
        let _ = engine.resample(input, width, height, out_w, out_h, gpu_filter)?;

        let cpu_started = Instant::now();
        let cpu = if u64::from(width) * u64::from(height) > 4_000_000 {
            tiled_upscale(input, width, height, scale, 256, 16, cpu_filter)?
        } else {
            cpu_upscale(input, width, height, scale, cpu_filter)?
        };
        let cpu_ms = cpu_started.elapsed().as_secs_f64() * 1000.0;

        let mut samples = Vec::new();
        let mut gpu_output = Vec::new();
        for _ in 0..3 {
            let started = Instant::now();
            let (gpu, _) = engine.resample(input, width, height, out_w, out_h, gpu_filter)?;
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            gpu_output = gpu;
        }
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let gpu_ms = samples[samples.len() / 2];
        let (max_diff, mean, psnr) = diff_metrics(&cpu, &gpu_output)?;
        println!(
            "{:>22}  {:>10}  {:>12.2}  {:>12.2}  {:>7.1}x  parity max={max_diff} mean={mean:.4} PSNR={psnr:.1}dB",
            format!("{case_name} {width}x{height} -> {out_w}x{out_h}"),
            name,
            cpu_ms,
            gpu_ms,
            cpu_ms / gpu_ms.max(0.001)
        );
        if max_diff > 1 || mean > 0.01 || psnr < 70.0 {
            return Err(format!(
                "{case_name} {name} parity failed: max={max_diff}, mean={mean:.4}, PSNR={psnr:.1}dB"
            )
            .into());
        }
        if let Some(output_dir) = photo_output {
            save_photo_evidence(output_dir, name, out_w, out_h, &cpu, &gpu_output)?;
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let photo_path = args.next().map(PathBuf::from);
    let output_dir = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("varve-gpu-resample-photo"));
    if args.next().is_some() {
        return Err("usage: gpu_resample_bench [photo.png|photo.jpg] [output-dir]".into());
    }

    let engine = match GpuEffectEngine::create() {
        Ok(engine) => engine,
        Err(err) => {
            eprintln!("native GPU unavailable: {err}");
            return Err(err.into());
        }
    };
    println!(
        "native GPU: {} ({}, {})",
        engine.info().name,
        engine.info().backend,
        engine.info().device_type
    );
    println!(
        "{:>22}  {:>10}  {:>12}  {:>12}  {:>8}  parity",
        "case", "filter", "cpu (ms)", "gpu (ms)", "speedup"
    );

    if let Some(photo_path) = photo_path {
        let image = image::ImageReader::open(&photo_path)?.decode()?.to_rgba8();
        let (width, height) = image.dimensions();
        println!(
            "real photo: {}x{} from {}",
            width,
            height,
            photo_path.display()
        );
        benchmark_case(
            &engine,
            "photo",
            image.as_raw(),
            width,
            height,
            2,
            Some(&output_dir),
        )?;
        println!("CPU/GPU/difference PNGs: {}", output_dir.display());
    } else {
        for (width, height, factor) in [(1920, 1080, 2), (3000, 2000, 2)] {
            let input = synthetic(width, height);
            benchmark_case(&engine, "synthetic", &input, width, height, factor, None)?;
        }
    }
    Ok(())
}
