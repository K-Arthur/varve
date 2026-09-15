#![cfg(feature = "ai")]
//! Real-model expansion qualification for the prompt-free LaMa path.
//!
//! This test is opt-in:
//!
//! ```bash
//! VARVE_LAMA_QUALIFICATION=1 cargo test -p varve-bgremove --features ai \
//!   --test lama_expand_qualification -- --nocapture
//! ```
//!
//! It exercises the production `lama_inpaint` helper with the pinned
//! `lama-inpainting` ONNX artifact, builds the same padded-frame + border-mask
//! preparation the editor uses for Expand, restores protected source pixels,
//! and writes before/after evidence into
//! `tests/e2e/fixtures/generative-evidence/expand-2026-09-13/`.
//!
//! The test asserts source protection and non-degenerate generation. It does
//! not claim semantic quality; the retained artifacts are for review.

use base64::Engine as _;
use image::{ImageFormat, RgbaImage};
use std::path::{Path, PathBuf};
use varve_bgremove::{lama_inpaint, LamaInpaintRequest};

const MODEL_ID: &str = "lama-inpainting";
const MAX_SOURCE_LONG_SIDE: u32 = 1024;

#[derive(Clone, Copy, Debug)]
struct Margins {
    top: u32,
    right: u32,
    bottom: u32,
    left: u32,
}

struct Case {
    id: &'static str,
    fixture: &'static str,
    margins: Margins,
}

const CASES: &[Case] = &[
    Case {
        id: "landscape-right-bottom",
        fixture: "real-life-landscape.jpg",
        margins: Margins {
            top: 0,
            right: 160,
            bottom: 120,
            left: 0,
        },
    },
    Case {
        id: "portrait-left-right",
        fixture: "real-life-braided-portrait.jpg",
        margins: Margins {
            top: 0,
            right: 160,
            bottom: 0,
            left: 160,
        },
    },
    Case {
        id: "architecture-top",
        fixture: "real-life-brookings-hall.jpg",
        margins: Margins {
            top: 140,
            right: 0,
            bottom: 0,
            left: 0,
        },
    },
    Case {
        id: "seascape-all-sides",
        fixture: "real-life-seascape-sunset.jpg",
        margins: Margins {
            top: 80,
            right: 80,
            bottom: 80,
            left: 80,
        },
    },
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn evidence_dir() -> PathBuf {
    repo_root().join("tests/e2e/fixtures/generative-evidence/expand-2026-09-13")
}

/// Retain an inspection copy at a bounded long side so the evidence set stays
/// reviewable without adding tens of megabytes to the repository. Metrics are
/// always computed on the full-resolution frames.
fn save_evidence(image: &RgbaImage, path: &Path) {
    const MAX_EVIDENCE_LONG_SIDE: u32 = 640;
    let long_side = image.width().max(image.height());
    let output = if long_side > MAX_EVIDENCE_LONG_SIDE {
        let scale = MAX_EVIDENCE_LONG_SIDE as f32 / long_side as f32;
        let width = ((image.width() as f32 * scale).round() as u32).max(1);
        let height = ((image.height() as f32 * scale).round() as u32).max(1);
        image::imageops::resize(image, width, height, image::imageops::FilterType::Lanczos3)
    } else {
        image.clone()
    };
    output
        .save_with_format(path, ImageFormat::Png)
        .expect("save evidence");
}

fn onnxruntime_dylib() -> PathBuf {
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let name = if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };
    repo_root()
        .join("apps/desktop/src-tauri/onnxruntime-libs")
        .join(platform)
        .join(name)
}

fn load_fixture(name: &str) -> RgbaImage {
    let path = repo_root().join("tests/e2e/fixtures").join(name);
    let decoded = image::open(&path)
        .unwrap_or_else(|error| panic!("failed to open {}: {error}", path.display()))
        .to_rgba8();
    let long_side = decoded.width().max(decoded.height());
    if long_side <= MAX_SOURCE_LONG_SIDE {
        return decoded;
    }
    let scale = MAX_SOURCE_LONG_SIDE as f32 / long_side as f32;
    let width = (decoded.width() as f32 * scale).round().max(1.0) as u32;
    let height = (decoded.height() as f32 * scale).round().max(1.0) as u32;
    image::imageops::resize(
        &decoded,
        width,
        height,
        image::imageops::FilterType::Triangle,
    )
}

fn build_expanded_frame(source: &RgbaImage, margins: Margins) -> (RgbaImage, Vec<u8>) {
    let width = source.width() + margins.left + margins.right;
    let height = source.height() + margins.top + margins.bottom;
    let mut frame = RgbaImage::new(width, height);
    let mut mask = vec![0u8; (width * height) as usize];
    for y in 0..height {
        let clamped_y = (y as i64 - margins.top as i64).clamp(0, source.height() as i64 - 1) as u32;
        for x in 0..width {
            let clamped_x =
                (x as i64 - margins.left as i64).clamp(0, source.width() as i64 - 1) as u32;
            frame.put_pixel(x, y, *source.get_pixel(clamped_x, clamped_y));
            let inside = x >= margins.left
                && x < margins.left + source.width()
                && y >= margins.top
                && y < margins.top + source.height();
            if !inside {
                mask[(y * width + x) as usize] = 255;
            }
        }
    }
    (frame, mask)
}

fn restore_protected(output: &mut RgbaImage, source: &RgbaImage, margins: Margins) {
    for y in 0..source.height() {
        for x in 0..source.width() {
            let pixel = *source.get_pixel(x, y);
            output.put_pixel(x + margins.left, y + margins.top, pixel);
        }
    }
}

fn inside_source(x: u32, y: u32, source: &RgbaImage, margins: Margins) -> bool {
    x >= margins.left
        && x < margins.left + source.width()
        && y >= margins.top
        && y < margins.top + source.height()
}

fn border_metrics(
    generated: &RgbaImage,
    frame: &RgbaImage,
    source: &RgbaImage,
    margins: Margins,
) -> (u64, f64, f64) {
    let mut changed = 0u64;
    let mut border_pixels = 0u64;
    let mut luminance_sum = 0.0f64;
    let mut luminance_sq_sum = 0.0f64;
    for y in 0..generated.height() {
        for x in 0..generated.width() {
            if inside_source(x, y, source, margins) {
                continue;
            }
            border_pixels += 1;
            let generated_pixel = generated.get_pixel(x, y);
            if generated_pixel != frame.get_pixel(x, y) {
                changed += 1;
            }
            let luminance = 0.2126 * generated_pixel[0] as f64
                + 0.7152 * generated_pixel[1] as f64
                + 0.0722 * generated_pixel[2] as f64;
            luminance_sum += luminance;
            luminance_sq_sum += luminance * luminance;
        }
    }
    let count = border_pixels.max(1) as f64;
    let mean = luminance_sum / count;
    let variance = (luminance_sq_sum / count - mean * mean).max(0.0);
    (changed, border_pixels as f64, variance.sqrt())
}

/// Mean absolute RGB difference between the generated pixel next to a seam
/// and the source pixel it continues from. Lower is smoother; 0 would be
/// exact continuation.
fn seam_gradient(output: &RgbaImage, source: &RgbaImage, margins: Margins) -> f64 {
    let mut total = 0.0f64;
    let mut count = 0u64;
    for y in 0..source.height() {
        if margins.left > 0 {
            let generated = output.get_pixel(margins.left - 1, y + margins.top);
            let reference = source.get_pixel(0, y);
            total += channel_difference(generated, reference);
            count += 1;
        }
        if margins.right > 0 {
            let generated = output.get_pixel(margins.left + source.width(), y + margins.top);
            let reference = source.get_pixel(source.width() - 1, y);
            total += channel_difference(generated, reference);
            count += 1;
        }
    }
    for x in 0..source.width() {
        if margins.top > 0 {
            let generated = output.get_pixel(x + margins.left, margins.top - 1);
            let reference = source.get_pixel(x, 0);
            total += channel_difference(generated, reference);
            count += 1;
        }
        if margins.bottom > 0 {
            let generated = output.get_pixel(x + margins.left, margins.top + source.height());
            let reference = source.get_pixel(x, source.height() - 1);
            total += channel_difference(generated, reference);
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    total / count as f64 / 3.0
}

fn channel_difference(a: &image::Rgba<u8>, b: &image::Rgba<u8>) -> f64 {
    (a[0] as f64 - b[0] as f64).abs()
        + (a[1] as f64 - b[1] as f64).abs()
        + (a[2] as f64 - b[2] as f64).abs()
}

fn run_case(case: &Case, evidence: &Path) -> serde_json::Value {
    let source = load_fixture(case.fixture);
    let (frame, mask) = build_expanded_frame(&source, case.margins);
    let request = LamaInpaintRequest {
        image_rgba: frame.as_raw().clone(),
        image_w: frame.width(),
        image_h: frame.height(),
        mask,
        mask_w: frame.width(),
        mask_h: frame.height(),
        preview_max_dimension: Some(2048),
    };
    let started = std::time::Instant::now();
    let result = lama_inpaint(request).expect("lama_inpaint failed");
    let wall_ms = started.elapsed().as_millis() as u64;

    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(&result.png_base64)
        .expect("decode base64");
    let provider = image::load_from_memory(&png_bytes)
        .expect("decode provider PNG")
        .to_rgba8();
    assert_eq!(provider.width(), frame.width());
    assert_eq!(provider.height(), frame.height());

    let mut accepted = provider.clone();
    restore_protected(&mut accepted, &source, case.margins);
    for y in 0..source.height() {
        for x in 0..source.width() {
            assert_eq!(
                accepted.get_pixel(x + case.margins.left, y + case.margins.top),
                source.get_pixel(x, y),
                "protected pixel drifted at {x},{y}"
            );
        }
    }

    let (changed, border_pixels, border_stddev) =
        border_metrics(&accepted, &frame, &source, case.margins);
    let seam = seam_gradient(&accepted, &source, case.margins);

    let prefix = format!("{}-{}", case.id, case.fixture.trim_end_matches(".jpg"));
    save_evidence(&source, &evidence.join(format!("{prefix}-source.png")));
    save_evidence(&frame, &evidence.join(format!("{prefix}-frame.png")));
    save_evidence(&provider, &evidence.join(format!("{prefix}-provider.png")));
    save_evidence(&accepted, &evidence.join(format!("{prefix}-accepted.png")));

    assert_eq!(result.width, frame.width());
    assert_eq!(result.height, frame.height());
    assert!(
        changed as f64 / border_pixels.max(1.0) > 0.02,
        "generated border did not change from the edge-clamped context"
    );
    assert!(
        border_stddev > 1.0,
        "generated border luminance is degenerate (stddev {border_stddev})"
    );

    serde_json::json!({
        "case": case.id,
        "fixture": case.fixture,
        "source": format!("{}x{}", source.width(), source.height()),
        "output": format!("{}x{}", frame.width(), frame.height()),
        "provider_ms": result.processing_time_ms,
        "wall_ms": wall_ms,
        "execution_backend": result.execution_backend,
        "model_id": result.model_id,
        "warnings": result.warnings,
        "border_changed_ratio": changed as f64 / border_pixels.max(1.0),
        "border_luminance_stddev": border_stddev,
        "mean_seam_gradient_0_255": seam,
    })
}

#[test]
fn lama_expand_qualification() {
    if std::env::var("VARVE_LAMA_QUALIFICATION").as_deref() != Ok("1") {
        eprintln!("lama_expand_qualification skipped: set VARVE_LAMA_QUALIFICATION=1 to run");
        return;
    }
    let evidence = evidence_dir();
    std::fs::create_dir_all(&evidence).expect("create evidence dir");
    if !varve_bgremove::runtime::native_ai_ready() {
        let dylib = onnxruntime_dylib();
        assert!(
            dylib.exists(),
            "ONNX Runtime dylib is missing at {}; run `node scripts/fetch-onnxruntime.mjs`",
            dylib.display()
        );
        varve_bgremove::runtime::init_native_runtime(&dylib).expect("init native onnxruntime");
    }
    let mut results = Vec::new();
    for case in CASES {
        println!(
            "EXPAND_QUALIFICATION start case={} fixture={}",
            case.id, case.fixture
        );
        let summary = run_case(case, &evidence);
        println!("EXPAND_QUALIFICATION result {summary}");
        results.push(summary);
    }
    let report = serde_json::json!({
        "model": MODEL_ID,
        "generated_at": "2026-09-13",
        "cases": results,
    });
    std::fs::write(
        evidence.join("qualification-report.json"),
        serde_json::to_string_pretty(&report).expect("serialize report"),
    )
    .expect("write report");
}
