//! CPU vs native GPU evidence for the embedded Real-ESRGAN upscale model
//! (the production `varve_upscale::ai_upscale` tiled pipeline).
//!
//! Usage: `cargo run --release -p varve-upscale --features ai --example ai_upscale_probe -- <libonnxruntime.so> <plugin.so>`

use std::time::Instant;

use varve_upscale::{ai_upscale_with_metadata, UpscaleOptions};

fn synthetic(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            let fx = x as f64 / width as f64;
            let fy = y as f64 / height as f64;
            rgba[i] = (fx * 220.0
                + if ((x / 8) + (y / 8)) % 2 == 0 {
                    20.0
                } else {
                    0.0
                })
            .clamp(0.0, 255.0) as u8;
            rgba[i + 1] = (fy * 200.0).clamp(0.0, 255.0) as u8;
            rgba[i + 2] =
                (((fx * 6.0).sin() * (fy * 5.0).cos() * 110.0 + 128.0).clamp(0.0, 255.0)) as u8;
            rgba[i + 3] = 255;
        }
    }
    rgba
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: ai_upscale_probe <libonnxruntime> <plugin.so>");
        std::process::exit(64);
    }
    varve_bgremove::runtime::init_native_runtime(std::path::Path::new(&args[1]))?;
    varve_bgremove::webgpu_ep::register(std::path::Path::new(&args[2]))?;
    println!("PLUGIN {:?}", varve_bgremove::webgpu_ep::status());

    let (width, height) = (96u32, 72u32);
    let input = synthetic(width, height);

    use varve_bgremove::webgpu_ep::{self, InferenceProviderPolicy};
    let options = || UpscaleOptions {
        progress: None,
        cancel: None,
    };

    webgpu_ep::set_inference_provider_policy(InferenceProviderPolicy::Gpu);
    let started = Instant::now();
    let gpu =
        ai_upscale_with_metadata(&input, width, height, "upscale-realesr-general", options())?;
    let gpu_cold_ms = started.elapsed().as_secs_f64() * 1000.0;
    let gpu_provider = gpu.execution_provider;
    let started = Instant::now();
    let gpu_warm =
        ai_upscale_with_metadata(&input, width, height, "upscale-realesr-general", options())?;
    let gpu_warm_ms = started.elapsed().as_secs_f64() * 1000.0;
    debug_assert_eq!(gpu.pixels, gpu_warm.pixels);

    webgpu_ep::set_inference_provider_policy(InferenceProviderPolicy::Cpu);
    let started = Instant::now();
    let cpu =
        ai_upscale_with_metadata(&input, width, height, "upscale-realesr-general", options())?;
    let cpu_cold_ms = started.elapsed().as_secs_f64() * 1000.0;
    let cpu_provider = cpu.execution_provider;
    let started = Instant::now();
    let cpu_warm =
        ai_upscale_with_metadata(&input, width, height, "upscale-realesr-general", options())?;
    let cpu_warm_ms = started.elapsed().as_secs_f64() * 1000.0;
    debug_assert_eq!(cpu.pixels, cpu_warm.pixels);

    if cpu.pixels.len() != gpu.pixels.len() {
        eprintln!(
            "UPSCALE_LENGTH_MISMATCH cpu={} gpu={}",
            cpu.pixels.len(),
            gpu.pixels.len()
        );
        std::process::exit(4);
    }
    let mut max_diff = 0i32;
    let mut sum = 0f64;
    for (cpu_byte, gpu_byte) in cpu.pixels.iter().zip(gpu.pixels.iter()) {
        let diff = (*cpu_byte as i32 - *gpu_byte as i32).abs();
        max_diff = max_diff.max(diff);
        sum += f64::from(diff);
    }
    println!("UPSCALE_GPU_MS cold={gpu_cold_ms:.1} warm={gpu_warm_ms:.1}");
    println!("UPSCALE_CPU_MS cold={cpu_cold_ms:.1} warm={cpu_warm_ms:.1}");
    println!("UPSCALE_PROVIDERS gpu={gpu_provider} cpu={cpu_provider}");
    println!(
        "UPSCALE_PARITY max={max_diff} mean={:.6} bytes={}",
        sum / cpu.pixels.len().max(1) as f64,
        gpu.pixels.len()
    );
    if gpu_provider != "native-webgpu" || cpu_provider != "native-cpu" {
        eprintln!("UPSCALE_PROVIDER_MISMATCH");
        std::process::exit(5);
    }
    Ok(())
}
