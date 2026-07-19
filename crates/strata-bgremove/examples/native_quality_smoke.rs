#[cfg(feature = "ai")]
fn main() -> Result<(), String> {
    use base64::Engine;
    use strata_bgremove::{RemovalMethod, RemovalOptions};

    let mut args = std::env::args().skip(1);
    let runtime_path = args
        .next()
        .ok_or("usage: native_quality_smoke <onnxruntime-dylib> <model.onnx> <image> <mask.png>")?;
    let source_model = args.next().ok_or("missing model path")?;
    let image_path = args.next().ok_or("missing image path")?;
    let output_path = args.next().ok_or("missing output mask path")?;

    strata_bgremove::runtime::init_native_runtime(std::path::Path::new(&runtime_path))?;
    let destination = strata_bgremove::model::model_path("birefnet-general-lite");
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create model directory: {error}"))?;
    }
    std::fs::copy(&source_model, &destination)
        .map_err(|error| format!("failed to stage model: {error}"))?;

    let image = image::open(&image_path)
        .map_err(|error| format!("failed to decode input image: {error}"))?;
    let result = strata_bgremove::remove_background(
        &image,
        &RemovalOptions {
            method: RemovalMethod::AiQuality,
            tolerance: None,
            feather_radius: Some(0.0),
            decontaminate: Some(false),
            click_x: None,
            click_y: None,
            preview_max_dimension: Some(2048),
        },
    )?;
    let png = base64::engine::general_purpose::STANDARD
        .decode(&result.mask_base64)
        .map_err(|error| format!("failed to decode output mask: {error}"))?;
    std::fs::write(&output_path, png)
        .map_err(|error| format!("failed to write output mask: {error}"))?;
    println!(
        "method={} confidence={:.6} processing_ms={} dimensions={}x{} output={}",
        result.method,
        result.confidence,
        result.processing_time_ms,
        result.width,
        result.height,
        output_path
    );
    Ok(())
}

#[cfg(not(feature = "ai"))]
fn main() {
    eprintln!("native_quality_smoke requires --features ai");
    std::process::exit(2);
}
