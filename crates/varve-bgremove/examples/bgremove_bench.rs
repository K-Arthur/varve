//! Native background-removal benchmark harness.
//!
//! Runs every installed segmentation model over a corpus directory, records
//! cold/warm inference latency, RSS samples, mask artifacts, and (when
//! reference masks are present) quality metrics, then writes a machine
//! readable `results.json` and a human-readable `report.md`.
//!
//! ```text
//! cargo run -p varve-bgremove --features ai --example bgremove_bench -- \
//!   --dylib apps/desktop/src-tauri/onnxruntime-libs/linux-x86_64/libonnxruntime.so \
//!   --models-dir /path/to/models \
//!   --images-dir tests/fixtures/bg-removal-corpus \
//!   --reference-dir /path/to/reference-masks \
//!   --output-dir /tmp/bgremove-bench \
//!   --iterations 4
//! ```
//!
//! Model files are named per the manifest convention (`<model-id>.onnx`,
//! `birefnet-general-lite.onnx` etc.) or rembg asset names.

use std::path::{Path, PathBuf};
use std::time::Instant;

use image::GenericImageView;
use varve_bgremove::metrics::{compute_mask_metrics, MaskMetricsOptions};

const MODELS: &[&str] = &[
    "u2netp",
    "isnet-general-use",
    "birefnet-general-lite",
    "birefnet-general",
];

/// rembg asset file names for the pinned manifest checkpoints.
fn model_file(model_id: &str) -> &'static str {
    match model_id {
        "isnet-general-use" => "isnet-general-use.onnx",
        "birefnet-general-lite" => "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        "birefnet-general" => "BiRefNet-general-epoch_244.onnx",
        _ => "u2netp.onnx",
    }
}

fn find_model(models_dir: &Path, model_id: &str) -> Option<PathBuf> {
    let candidates = [
        models_dir.join(format!("{model_id}.onnx")),
        models_dir.join(model_file(model_id)),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn percentile(mut values: Vec<f64>, p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let index = ((values.len() - 1) as f64 * p).floor() as usize;
    Some(values[index])
}

/// Current RSS in bytes via `/proc/self/status` (Linux only).
fn rss_bytes() -> Option<u64> {
    let contents = std::fs::read_to_string("/proc/self/status").ok()?;
    contents.lines().find_map(|line| {
        let value = line.strip_prefix("VmRSS:")?.trim();
        let kilobytes = value.strip_suffix(" kB")?.trim().parse::<u64>().ok()?;
        Some(kilobytes * 1024)
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CaseResult {
    case_id: String,
    image: String,
    model_id: String,
    model_size_bytes: u64,
    image_w: u32,
    image_h: u32,
    cold_load_ms: f64,
    warm_ms: Vec<f64>,
    warm_p50_ms: Option<f64>,
    warm_p95_ms: Option<f64>,
    rss_peak_bytes: Option<u64>,
    rss_steady_bytes: Option<u64>,
    iou: Option<f64>,
    dice: Option<f64>,
    precision: Option<f64>,
    recall: Option<f64>,
    f_beta: Option<f64>,
    mask_mae: Option<f64>,
    boundary_f_score: Option<f64>,
    boundary_precision: Option<f64>,
    boundary_recall: Option<f64>,
    alpha_sad: Option<f64>,
    alpha_mse: Option<f64>,
    alpha_gradient_error: Option<f64>,
    foreground_ratio: Option<f64>,
    soft_edge_ratio: Option<f64>,
    reference_source: Option<String>,
    error: Option<String>,
}

fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut dylib = None;
    let mut models_dir = None;
    let mut images_dir = None;
    let mut reference_dir = None;
    let mut output_dir = None;
    let mut iterations = 3usize;
    let mut preview_max = 2048u32;
    let mut models_filter: Option<Vec<String>> = None;
    while let Some(arg) = args.next() {
        let mut value = || {
            args.next()
                .unwrap_or_else(|| panic!("missing value for {arg}"))
        };
        match arg.as_str() {
            "--dylib" => dylib = Some(value()),
            "--models-dir" => models_dir = Some(value()),
            "--images-dir" => images_dir = Some(value()),
            "--reference-dir" => reference_dir = Some(value()),
            "--output-dir" => output_dir = Some(value()),
            "--iterations" => iterations = value().parse().map_err(|_| "bad --iterations")?,
            "--preview-max" => preview_max = value().parse().map_err(|_| "bad --preview-max")?,
            "--models" => {
                models_filter = Some(value().split(',').map(str::to_owned).collect::<Vec<_>>())
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    let dylib = dylib.ok_or("missing --dylib")?;
    let models_dir = PathBuf::from(models_dir.ok_or("missing --models-dir")?);
    let images_dir = PathBuf::from(images_dir.ok_or("missing --images-dir")?);
    let output_dir = PathBuf::from(output_dir.ok_or("missing --output-dir")?);
    let reference_dir = reference_dir.map(PathBuf::from);

    varve_bgremove::runtime::init_native_runtime(Path::new(&dylib))?;
    varve_bgremove::model::configure_models_dir(models_dir.clone());
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("cannot create output dir: {e}"))?;

    let mut images: Vec<PathBuf> = Vec::new();
    let mut walk = vec![images_dir.clone()];
    while let Some(dir) = walk.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk.push(path);
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("jpg" | "jpeg" | "png")
            ) {
                images.push(path);
            }
        }
    }
    images.sort();
    if images.is_empty() {
        return Err(format!("no images found in {}", images_dir.display()));
    }

    let mut results: Vec<CaseResult> = Vec::new();
    // Merge with an existing report so models/images can be run in separate
    // invocations (e.g. under memory pressure) without losing measurements.
    let results_path = output_dir.join("results.json");
    if results_path.is_file() {
        if let Ok(existing) = std::fs::read_to_string(&results_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&existing) {
                if let Some(prior) = parsed["results"].as_array() {
                    for entry in prior {
                        if entry.get("case_id").and_then(|v| v.as_str()).is_some() {
                            results.push(
                                serde_json::from_value(entry.clone())
                                    .map_err(|e| format!("merge existing result: {e}"))?,
                            );
                        }
                    }
                }
            }
        }
    }
    let models_to_run: Vec<&str> = match &models_filter {
        Some(filter) => MODELS
            .iter()
            .copied()
            .filter(|model| filter.iter().any(|wanted| wanted == model))
            .collect(),
        None => MODELS.to_vec(),
    };
    for model_id in models_to_run {
        let Some(model_path) = find_model(&models_dir, model_id) else {
            eprintln!(
                "[bgremove-bench] model {model_id} not found in {}; skipping",
                models_dir.display()
            );
            continue;
        };
        if let Some(info) = varve_bgremove::model::model_info(model_id) {
            varve_bgremove::inference::verify_model_sha256(
                &model_path,
                info.checksum_sha256.as_deref(),
            )?;
        }
        let model_size = std::fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0);
        // Stage under the library's expected path so the session pool keys
        // consistently between model and image.
        let staged = varve_bgremove::model::model_path(model_id);
        if staged != model_path {
            std::fs::create_dir_all(staged.parent().expect("staged parent"))
                .map_err(|e| e.to_string())?;
            std::fs::copy(&model_path, &staged).map_err(|e| e.to_string())?;
        }

        for image_path in &images {
            let case_id = format!(
                "{}-{}",
                image_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("image"),
                model_id
            );
            eprintln!("[bgremove-bench] {case_id}");
            let image = image::open(image_path)
                .map_err(|e| format!("decode {}: {e}", image_path.display()))?;
            let (image_w, image_h) = image.dimensions();

            let mut warm: Vec<f64> = Vec::new();
            let mut cold_load_ms = 0.0f64;
            let mut rss_peak = 0u64;
            let mut last_mask: Option<Vec<u8>> = None;
            let mut error: Option<String> = None;

            for iteration in 0..iterations {
                let token = varve_bgremove::session_pool::InferenceCancellationToken::default();
                let started = Instant::now();
                let result = varve_bgremove::inference::remove_ai_cancellable(
                    &image,
                    &varve_bgremove::RemovalOptions {
                        method: varve_bgremove::RemovalMethod::AiQuality,
                        tolerance: None,
                        feather_radius: Some(0.0),
                        decontaminate: Some(false),
                        click_x: None,
                        click_y: None,
                        preview_max_dimension: Some(preview_max),
                    },
                    model_id,
                    &token,
                );
                let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                if let Some(current) = rss_bytes() {
                    rss_peak = rss_peak.max(current);
                }
                match result {
                    Ok(result) => {
                        if iteration == 0 {
                            cold_load_ms = elapsed;
                        } else {
                            warm.push(elapsed);
                        }
                        let png = base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            &result.mask_base64,
                        )
                        .map_err(|e| format!("mask decode: {e}"))?;
                        let mask = decode_png_mask(&png, result.width, result.height)?;
                        std::fs::write(output_dir.join(format!("{case_id}-mask.png")), png)
                            .map_err(|e| e.to_string())?;
                        last_mask = Some(mask);
                    }
                    Err(e) => {
                        eprintln!("[bgremove-bench] {case_id} failed: {e}");
                        error = Some(e);
                        break;
                    }
                }
            }
            let steady = last_mask.as_ref().and_then(|_| rss_bytes());

            let mut metrics = None;
            let mut foreground_ratio = None;
            let mut soft_edge_ratio = None;
            let mut reference_source = None;
            if let (Some(mask), Some(reference_dir)) =
                (last_mask.as_deref(), reference_dir.as_deref())
            {
                let stem = image_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("image");
                let candidates = [
                    (format!("{stem}-{model_id}-rembg.png"), "reference-model"),
                    (format!("{stem}-ground-truth.png"), "ground-truth"),
                    (format!("{stem}.alpha.png"), "ground-truth"),
                ];
                if let Some((expected_path, source)) = candidates
                    .iter()
                    .map(|(name, source)| (reference_dir.join(name), *source))
                    .find(|(path, _)| path.is_file())
                {
                    if let Ok(expected) = std::fs::read(&expected_path) {
                        if let Ok(expected_mask) = decode_png_mask(&expected, image_w, image_h) {
                            let alpha_target = source == "ground-truth"
                                && expected_mask
                                    .iter()
                                    .any(|&value| value != 0 && value != 255);
                            metrics = Some(compute_mask_metrics(
                                mask,
                                &expected_mask,
                                image_w,
                                image_h,
                                MaskMetricsOptions {
                                    alpha_target,
                                    ..Default::default()
                                },
                            ));
                            let mut fg = 0usize;
                            let mut soft = 0usize;
                            for &value in mask {
                                if value >= 128 {
                                    fg += 1;
                                }
                                if value > 8 && value < 247 {
                                    soft += 1;
                                }
                            }
                            let total = mask.len().max(1);
                            foreground_ratio = Some(fg as f64 / total as f64);
                            soft_edge_ratio = Some(soft as f64 / total as f64);
                            reference_source = Some(source.to_owned());
                        }
                    }
                } else {
                    eprintln!(
                        "[bgremove-bench] reference mask missing for {case_id} in {}",
                        reference_dir.display()
                    );
                }
            }

            results.push(CaseResult {
                case_id: case_id.clone(),
                image: image_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_owned(),
                model_id: model_id.to_string(),
                model_size_bytes: model_size,
                image_w,
                image_h,
                cold_load_ms,
                warm_ms: warm.clone(),
                warm_p50_ms: percentile(warm.clone(), 0.5),
                warm_p95_ms: percentile(warm, 0.95),
                rss_peak_bytes: (rss_peak > 0).then_some(rss_peak),
                rss_steady_bytes: steady,
                iou: metrics.map(|m| m.iou),
                dice: metrics.map(|m| m.dice),
                precision: metrics.map(|m| m.precision),
                recall: metrics.map(|m| m.recall),
                f_beta: metrics.map(|m| m.f_beta),
                mask_mae: metrics.map(|m| m.mae),
                boundary_f_score: metrics.map(|m| m.boundary_f_score),
                boundary_precision: metrics.map(|m| m.boundary_precision),
                boundary_recall: metrics.map(|m| m.boundary_recall),
                alpha_sad: metrics.and_then(|m| m.alpha_sad),
                alpha_mse: metrics.and_then(|m| m.alpha_mse),
                alpha_gradient_error: metrics.and_then(|m| m.alpha_gradient_error),
                foreground_ratio,
                soft_edge_ratio,
                reference_source,
                error,
            });
        }
    }

    let git_commit = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .unwrap_or_else(|| "unknown".to_owned());

    let cpu = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|contents| {
            contents
                .lines()
                .find(|line| line.starts_with("model name"))
                .map(|line| line.split(':').nth(1).unwrap_or("").trim().to_owned())
        });

    // Fresh measurements supersede merged ones with the same case id:
    // keep the newest occurrence of each case id.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    results.reverse();
    results.retain(|entry| seen.insert(entry.case_id.clone()));
    results.reverse();

    let report = serde_json::json!({
        "schemaVersion": 2,
        "generatedAt": chrono_utc(),
        "gitCommit": git_commit,
        "runtime": "ort-native",
        "onnxRuntime": "bundled dylib 1.27.1 (ort rc.13)",
        "executionProvider": "cpu",
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpu": cpu,
        "iterations": iterations,
        "previewMaxDimension": preview_max,
        "results": results,
    });
    std::fs::write(
        output_dir.join("results.json"),
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    write_summary(&output_dir, &report);
    eprintln!(
        "[bgremove-bench] done; artifacts in {}",
        output_dir.display()
    );
    Ok(())
}

fn chrono_utc() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (now / 86400) as i64;
    let secs_of_day = now % 86400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

/// Convert days since epoch to (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn write_summary(output_dir: &Path, report: &serde_json::Value) {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(out, "# Native background-removal benchmark");
    let _ = writeln!(out);
    let _ = writeln!(out, "- Git commit: {}", report["gitCommit"]);
    let _ = writeln!(
        out,
        "- Runtime: {} / {} / {}",
        report["runtime"], report["onnxRuntime"], report["executionProvider"]
    );
    let _ = writeln!(out, "- Hardware: {}", report["cpu"]);
    let _ = writeln!(
        out,
        "- Iterations: {} (first = cold load, rest warm)",
        report["iterations"]
    );
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "| Case | Model | Cold ms | Warm p50 ms | Warm p95 ms | RSS peak | IoU | Dice | Boundary F | Mask MAE |"
    );
    let _ = writeln!(out, "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    if let Some(results) = report["results"].as_array() {
        for case in results {
            let f = |key: &str| match case.get(key).and_then(|v| v.as_f64()) {
                Some(v) => format!("{v:.3}"),
                None => "—".to_owned(),
            };
            let _ = writeln!(
                out,
                "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
                case["case_id"],
                case["model_id"],
                f("cold_load_ms"),
                f("warm_p50_ms"),
                f("warm_p95_ms"),
                case["rss_peak_bytes"]
                    .as_u64()
                    .map(|b| format!("{} MB", b / 1024 / 1024))
                    .unwrap_or_else(|| "—".into()),
                f("iou"),
                f("dice"),
                f("boundary_f_score"),
                f("mask_mae"),
            );
        }
    }
    let _ = std::fs::write(output_dir.join("report.md"), out);
}

fn decode_png_mask(png: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(png).map_err(|e| format!("reference decode: {e}"))?;
    let rgba = image.to_rgba8();
    if rgba.width() != width || rgba.height() != height {
        return Err(format!(
            "reference mask dimensions {}x{} do not match source {}x{}",
            rgba.width(),
            rgba.height(),
            width,
            height
        ));
    }
    Ok(rgba.into_raw().chunks_exact(4).map(|p| p[0]).collect())
}
