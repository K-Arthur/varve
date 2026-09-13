//! Feasibility + verification probe for the native WebGPU plugin execution
//! provider. Not shipped in the app; this is the hardware-evidence tool.
//!
//! Usage:
//!   cargo run --release -p varve-bgremove --features ai --example webgpu_ep_probe \
//!     -- <libonnxruntime.so> <libonnxruntime_providers_webgpu.so> <model.onnx> [inputSize]
//!
//! Prints PLUGIN_REGISTERED / DEVICE lines, CPU-vs-GPU output parity, and a
//! node/timing placement summary parsed from the ONNX Runtime profiler JSON.

use std::path::Path;

use ort::environment::Environment;
use ort::session::Session;

fn lcg_input(size: usize) -> Vec<f32> {
    let mut state = 0x1234_5678u32;
    (0..3 * size * size)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 8) as f32 / 16_777_215.0) * 2.0 - 1.0
        })
        .collect()
}

fn run(
    session: &mut Session,
    size: usize,
    input: &[f32],
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let input_name = session
        .inputs()
        .first()
        .ok_or("model has no inputs")?
        .name()
        .to_owned();
    let output_name = session
        .outputs()
        .first()
        .ok_or("model has no outputs")?
        .name()
        .to_owned();
    let tensor = ort::value::Tensor::from_array(([1usize, 3, size, size], input.to_vec()))?;
    let outputs = session.run(ort::inputs! { input_name.as_str() => tensor })?;
    let output = outputs.get(&output_name).ok_or("output not found")?;
    let (_, data) = output.try_extract_tensor::<f32>()?;
    Ok(data.to_vec())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: webgpu_ep_probe <libonnxruntime> <plugin.so> <model.onnx> [size]");
        std::process::exit(64);
    }
    let size: usize = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(320);

    varve_bgremove::runtime::init_native_runtime(Path::new(&args[1]))?;
    let env = Environment::current()?;
    // Use the production registration path (the app calls the same function).
    match varve_bgremove::webgpu_ep::register(std::path::Path::new(&args[2])) {
        Ok(()) => println!(
            "PLUGIN_REGISTERED {:?}",
            varve_bgremove::webgpu_ep::status()
        ),
        Err(err) => {
            eprintln!("PLUGIN_REGISTER_FAILED: {err}");
            std::process::exit(2);
        }
    }

    let mut webgpu_devices = Vec::new();
    for device in env.devices() {
        let ep = device.ep().unwrap_or("<?>");
        let hardware = device.hardware_device();
        println!(
            "DEVICE ep={ep} vendor={:?} hardware_vendor={:?} hardware_id={:?} type={:?}",
            device.ep_vendor().unwrap_or("<?>"),
            hardware.vendor(),
            hardware.id(),
            hardware.ty()
        );
        if ep == "WebGpuExecutionProvider" {
            webgpu_devices.push(device);
        }
    }
    if webgpu_devices.is_empty() {
        eprintln!("NO_WEBGPU_DEVICES");
        std::process::exit(3);
    }

    let input = lcg_input(size);
    let mut cpu_session = Session::builder()?.commit_from_file(&args[3])?;
    let cpu_out = run(&mut cpu_session, size, &input)?;
    let mut cpu_times = Vec::new();
    for _ in 0..3 {
        let started = std::time::Instant::now();
        let _ = run(&mut cpu_session, size, &input)?;
        cpu_times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    cpu_times.sort_by(|a, b| a.partial_cmp(b).unwrap());

    std::fs::create_dir_all("reports/native-gpu")?;
    let profile_prefix = "webgpu-ep-profile.json";
    let profile_dir = std::path::Path::new("reports/native-gpu");
    for entry in std::fs::read_dir(profile_dir)?.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(profile_prefix)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let options = [("preferredLayout".to_string(), "NHWC".to_string())];
    let mut gpu_session = Session::builder()?
        .with_devices(webgpu_devices, Some(&options))?
        .with_profiling(std::path::Path::new(profile_dir).join(profile_prefix))?
        .commit_from_file(&args[3])?;
    let gpu_out = run(&mut gpu_session, size, &input)?;
    let mut gpu_times = Vec::new();
    for _ in 0..3 {
        let started = std::time::Instant::now();
        let _ = run(&mut gpu_session, size, &input)?;
        gpu_times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    gpu_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    drop(gpu_session);
    println!(
        "TIMING cpu_ms={:.1} gpu_ms={:.1}",
        cpu_times[cpu_times.len() / 2],
        gpu_times[gpu_times.len() / 2]
    );

    if cpu_out.len() != gpu_out.len() {
        eprintln!(
            "PARITY_LENGTH_MISMATCH cpu={} gpu={}",
            cpu_out.len(),
            gpu_out.len()
        );
        std::process::exit(4);
    }
    let mut max = 0f32;
    let mut sum = 0f64;
    for (cpu, gpu) in cpu_out.iter().zip(gpu_out.iter()) {
        let diff = (cpu - gpu).abs();
        max = max.max(diff);
        sum += f64::from(diff);
    }
    println!(
        "PARITY values={} max_abs={max:.6} mean_abs={:.8}",
        cpu_out.len(),
        sum / cpu_out.len().max(1) as f64
    );

    let mut candidates: Vec<_> = std::fs::read_dir(profile_dir)?
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(profile_prefix)
        })
        .collect();
    candidates.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let profile_path = candidates
        .last()
        .map(|entry| entry.path())
        .ok_or("profiler did not write a profile file")?;
    let text = std::fs::read_to_string(&profile_path)?;
    println!("PROFILE {}", profile_path.display());
    let mut webgpu_nodes = 0usize;
    let mut cpu_nodes = 0usize;
    let mut webgpu_ms = 0f64;
    let mut cpu_ms = 0f64;
    if let Ok(serde_json::Value::Array(events)) = serde_json::from_str::<serde_json::Value>(&text) {
        for event in &events {
            let Some(provider) = event.pointer("/args/provider").and_then(|v| v.as_str()) else {
                continue;
            };
            let duration = event.get("dur").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if provider.contains("WebGpu") {
                webgpu_nodes += 1;
                webgpu_ms += duration / 1000.0;
            } else {
                cpu_nodes += 1;
                cpu_ms += duration / 1000.0;
            }
        }
    } else {
        webgpu_nodes = text.matches("WebGpuExecutionProvider").count();
        cpu_nodes = text.matches("CPUExecutionProvider").count();
    }
    println!(
        "PLACEMENT webgpu_nodes={webgpu_nodes} cpu_nodes={cpu_nodes} webgpu_ms={webgpu_ms:.1} cpu_ms={cpu_ms:.1}"
    );

    // Production path: the same policy + session creation + provider
    // reporting the desktop app uses (`varve_bgremove::webgpu_ep` +
    // `OrtInferenceRuntime`).
    use varve_bgremove::inference::{InferenceRuntime, OrtInferenceRuntime};
    use varve_bgremove::webgpu_ep::{self, InferenceProviderPolicy};
    let runtime = OrtInferenceRuntime;
    let dims = [1usize, 3, size, size];

    webgpu_ep::set_inference_provider_policy(InferenceProviderPolicy::Gpu);
    let mut gpu_session = runtime.create_session(std::path::Path::new(&args[3]))?;
    let gpu_provider = gpu_session.execution_provider();
    let gpu_production = gpu_session.run_nd(&input, &dims)?;
    let gpu_production = gpu_production.data;

    webgpu_ep::set_inference_provider_policy(InferenceProviderPolicy::Cpu);
    let mut cpu_session = runtime.create_session(std::path::Path::new(&args[3]))?;
    let cpu_provider = cpu_session.execution_provider();
    let cpu_production = cpu_session.run_nd(&input, &dims)?;
    let cpu_production = cpu_production.data;

    let mut production_max = 0f32;
    for (a, b) in cpu_production.iter().zip(gpu_production.iter()) {
        production_max = production_max.max((a - b).abs());
    }
    println!(
        "PRODUCTION_PATH gpu_provider={gpu_provider} cpu_provider={cpu_provider} values={} parity_max={production_max:.6}",
        gpu_production.len()
    );
    if gpu_provider != "native-webgpu" || cpu_provider != "native-cpu" {
        eprintln!("PRODUCTION_PATH_PROVIDER_MISMATCH");
        std::process::exit(5);
    }
    Ok(())
}
