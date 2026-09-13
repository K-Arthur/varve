//! CPU cost probe for the resampling (non-AI) upscale path.
//!
//! Usage: `cargo run --release -p varve-upscale --example resample_cost`

use std::time::Instant;

use varve_upscale::{cpu_upscale, tiled_upscale, UpscaleFilter};

fn synthetic_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            out[i] = (x % 256) as u8;
            out[i + 1] = (y % 256) as u8;
            out[i + 2] = ((x ^ y) % 256) as u8;
            out[i + 3] = 255;
        }
    }
    out
}

fn main() {
    let cases: &[(u32, u32, f64, bool)] = &[(1920, 1080, 2.0, false), (3000, 2000, 2.0, true)];
    for &(width, height, scale, tiled) in cases {
        let input = synthetic_rgba(width, height);
        let out_w = (width as f64 * scale) as u32;
        let out_h = (height as f64 * scale) as u32;
        for (name, filter) in [
            ("bicubic", UpscaleFilter::CatmullRom),
            ("lanczos3", UpscaleFilter::Lanczos3),
        ] {
            let start = Instant::now();
            let result = if tiled {
                tiled_upscale(&input, width, height, scale, 256, 16, filter)
            } else {
                cpu_upscale(&input, width, height, scale, filter)
            };
            match result {
                Ok(pixels) => {
                    let ms = start.elapsed().as_secs_f64() * 1000.0;
                    println!(
                        "{width}x{height} -> {out_w}x{out_h} {name}{}: {ms:.1} ms ({} bytes)",
                        if tiled { " [tiled]" } else { "" },
                        pixels.len()
                    );
                }
                Err(err) => println!("{name}: error: {err}"),
            }
        }
    }
}
