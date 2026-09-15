//! Process-isolated prompt-capable image-to-image/inpainting helper.
//!
//! The desktop app owns lifecycle and cancellation. This process owns the
//! diffusion runtime so an allocation failure, device loss, or incompatible
//! artifact cannot take down the editor webview. Communication is a small
//! request file plus a result file; model weights never cross the JSON/JS IPC
//! boundary.

use diffusion_rs::api::{BackendDevice, ConfigBuilder, ModelConfigBuilder, Module, gen_img};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    model_path: PathBuf,
    init_image_path: PathBuf,
    mask_path: PathBuf,
    output_path: PathBuf,
    prompt: String,
    #[serde(default)]
    negative_prompt: String,
    width: u32,
    height: u32,
    steps: u32,
    #[serde(default = "default_guidance_scale")]
    guidance_scale: f32,
    seed: i64,
    strength: f32,
}

fn default_guidance_scale() -> f32 {
    7.0
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    width: u32,
    height: u32,
    backend: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestedBackend {
    Cpu,
    Vulkan,
    Metal,
}

impl RequestedBackend {
    fn from_environment() -> Result<Self, String> {
        let requested = env::var("VARVE_GENERATIVE_BACKEND").unwrap_or_else(|_| {
            if cfg!(feature = "metal") {
                "metal".into()
            } else if cfg!(feature = "vulkan") {
                "vulkan".into()
            } else {
                "cpu".into()
            }
        });
        match requested.trim().to_ascii_lowercase().as_str() {
            "cpu" => Ok(Self::Cpu),
            "vulkan" if cfg!(feature = "vulkan") => Ok(Self::Vulkan),
            "metal" if cfg!(feature = "metal") => Ok(Self::Metal),
            "vulkan" => Err("The helper was built without its Vulkan feature".into()),
            "metal" => Err("The helper was built without its Metal feature".into()),
            _ => Err(format!(
                "Unsupported VARVE_GENERATIVE_BACKEND value: {requested}"
            )),
        }
    }

    fn configure(self, model: &mut ModelConfigBuilder) -> &'static str {
        let device = match self {
            Self::Cpu => return "native-cpu",
            Self::Vulkan => BackendDevice::VULKAN0,
            Self::Metal => BackendDevice::METAL,
        };
        let backends = HashMap::from([
            (Module::Diffusion, device.clone()),
            (Module::Te, device.clone()),
            (Module::Vae, device),
        ]);
        model.backend(backends);
        match self {
            Self::Vulkan => "native-vulkan",
            Self::Metal => "native-metal",
            Self::Cpu => unreachable!(),
        }
    }
}

fn validate_request(request: &Request) -> Result<(), String> {
    for (label, path) in [
        ("model", &request.model_path),
        ("source", &request.init_image_path),
        ("mask", &request.mask_path),
    ] {
        if !path.is_file() {
            return Err(format!("{label} artifact does not exist"));
        }
    }
    if request.prompt.trim().is_empty() {
        return Err("A prompt is required for prompt-capable generation".into());
    }
    if request.width == 0 || request.height == 0 || request.width > 2048 || request.height > 2048 {
        return Err("Generation dimensions must be between 1 and 2048 pixels".into());
    }
    validate_image_dimensions(
        &request.init_image_path,
        "source",
        request.width,
        request.height,
    )?;
    validate_image_dimensions(&request.mask_path, "mask", request.width, request.height)?;
    if request.steps == 0 || request.steps > 100 {
        return Err("Generation steps must be between 1 and 100".into());
    }
    if !request.strength.is_finite() || !(0.0..=1.0).contains(&request.strength) {
        return Err("Generation strength must be between 0 and 1".into());
    }
    if !request.guidance_scale.is_finite() || !(0.0..=50.0).contains(&request.guidance_scale) {
        return Err("Generation guidance scale must be between 0 and 50".into());
    }
    Ok(())
}

fn validate_image_dimensions(
    path: &std::path::Path,
    label: &str,
    expected_width: u32,
    expected_height: u32,
) -> Result<(), String> {
    let (width, height) = image::image_dimensions(path)
        .map_err(|error| format!("The {label} artifact is not a readable image: {error}"))?;
    if width != expected_width || height != expected_height {
        return Err(format!(
            "The {label} artifact dimensions {width}x{height} do not match the working frame {expected_width}x{expected_height}"
        ));
    }
    Ok(())
}

fn run(request: Request) -> Result<Response, String> {
    validate_request(&request)?;
    if let Some(parent) = request.output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create output directory: {error}"))?;
    }

    let requested_backend = RequestedBackend::from_environment()?;
    let mut model = ModelConfigBuilder::default();
    let backend = requested_backend.configure(&mut model);
    model
        .model(request.model_path)
        .enable_mmap(true)
        .n_threads(0);
    let mut model = model
        .build()
        .map_err(|error| format!("Diffusion model configuration failed: {error}"))?;

    let output_path = request.output_path.clone();
    let mut config = ConfigBuilder::default();
    config
        .init_img(request.init_image_path)
        .mask_img(request.mask_path)
        .output(request.output_path)
        .prompt(request.prompt)
        .negative_prompt(request.negative_prompt)
        .cfg_scale(request.guidance_scale)
        .width(request.width as i32)
        .height(request.height as i32)
        .steps(request.steps as i32)
        .seed(request.seed)
        .strength(request.strength)
        .batch_count(1);
    let config = config
        .build()
        .map_err(|error| format!("Diffusion request configuration failed: {error}"))?;

    gen_img(&config, &mut model).map_err(|error| format!("Diffusion inference failed: {error}"))?;

    let output = image::image_dimensions(output_path)
        .map_err(|error| format!("Diffusion output could not be read: {error}"))?;
    Ok(Response {
        width: output.0,
        height: output.1,
        backend: backend.into(),
    })
}

fn main() {
    let result = (|| -> Result<(), String> {
        let mut args = env::args_os();
        let _program = args.next();
        if args.next().as_deref() != Some(std::ffi::OsStr::new("--request")) {
            return Err("Usage: varve-generative-helper --request <request.json>".into());
        }
        let request_path = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| "Missing request path".to_string())?;
        let request: Request = serde_json::from_slice(
            &fs::read(&request_path).map_err(|error| format!("Cannot read request: {error}"))?,
        )
        .map_err(|error| format!("Invalid generation request: {error}"))?;
        let response = run(request)?;
        println!(
            "{}",
            serde_json::to_string(&response).map_err(|error| error.to_string())?
        );
        Ok(())
    })();

    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{Request, validate_request};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    fn valid_request() -> (Request, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "varve-generative-helper-test-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&root).expect("create test directory");
        fs::write(root.join("model.safetensors"), [1u8]).expect("create model artifact");
        image::RgbaImage::from_pixel(512, 512, image::Rgba([238, 238, 238, 255]))
            .save(root.join("source.png"))
            .expect("create source artifact");
        image::GrayImage::from_pixel(512, 512, image::Luma([255]))
            .save(root.join("mask.png"))
            .expect("create mask artifact");
        (
            Request {
                model_path: root.join("model.safetensors"),
                init_image_path: root.join("source.png"),
                mask_path: root.join("mask.png"),
                output_path: root.join("output.png"),
                prompt: "a red chair".into(),
                negative_prompt: String::new(),
                width: 512,
                height: 512,
                steps: 24,
                guidance_scale: 7.0,
                seed: 4,
                strength: 0.75,
            },
            root,
        )
    }

    #[test]
    fn validates_prompt_and_runtime_limits_before_loading_weights() {
        let (mut request, root) = valid_request();
        assert!(validate_request(&request).is_ok());

        request.prompt.clear();
        assert!(validate_request(&request).is_err());
        request.prompt = "a red chair".into();
        request.width = 2049;
        assert!(validate_request(&request).is_err());
        request.width = 512;
        request.guidance_scale = 51.0;
        assert!(validate_request(&request).is_err());

        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn rejects_source_or_mask_dimensions_that_do_not_match_the_working_frame() {
        let (mut request, root) = valid_request();

        request.width = 256;
        assert!(
            validate_request(&request)
                .expect_err("a resized working frame must not be guessed")
                .contains("source artifact dimensions")
        );

        request.width = 512;
        image::GrayImage::from_pixel(256, 512, image::Luma([255]))
            .save(&request.mask_path)
            .expect("write mismatched mask");
        assert!(
            validate_request(&request)
                .expect_err("a mismatched mask must be rejected")
                .contains("mask artifact dimensions")
        );

        fs::remove_dir_all(root).expect("remove test directory");
    }
}
