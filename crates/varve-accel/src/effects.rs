//! Offscreen GPU compute for live effects.
//!
//! Effects are dispatched as storage-buffer compute passes and read back to
//! RGBA bytes. This is deliberately separate from canvas presentation: the
//! webview still replays the render IR (ADR-0001/0003); the GPU here only
//! produces pixels for a workload the caller asked for. Results are compared
//! against the CPU kernels in `varve-effects` by the parity tests below, so a
//! GPU path never silently changes effect semantics.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use varve_effects::{clamp01, EffectKind, EffectRequest, Params};

use crate::capability::EffectiveBackend;
use crate::discovery::{AccelError, GpuCompute, READBACK_TIMEOUT};

/// Mirrors the native effect ceiling in `apply_live_effect_binary` — the GPU
/// path must never accept a larger surface than the CPU path.
pub const MAX_GPU_EFFECT_PIXELS: u64 = 33_554_432;

const PARAMS_BYTES: usize = 80; // 5 * vec4<f32>

/// Provenance of one GPU effect run. `backend` is always `Gpu` here; the
/// fallback decision belongs to the caller and is reported by the command.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRunInfo {
    pub backend: EffectiveBackend,
    pub device_id: String,
    pub device_name: String,
    pub passes: u32,
    pub duration_ms: f64,
}

/// Resampling filters exposed by the GPU resampler. Names and behavior mirror
/// `varve_upscale::UpscaleFilter` (which mirrors image-rs `FilterType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuResampleFilter {
    Nearest,
    Bilinear,
    Bicubic,
    Lanczos3,
}

impl GpuResampleFilter {
    /// Mirror `varve_upscale::UpscaleFilter::from_method`.
    pub fn from_method(method: &str) -> Self {
        match method {
            "nearest" => Self::Nearest,
            "bilinear" => Self::Bilinear,
            "lanczos3" => Self::Lanczos3,
            _ => Self::Bicubic,
        }
    }

    fn code(self) -> u32 {
        match self {
            Self::Nearest => 0,
            Self::Bilinear => 1,
            Self::Bicubic => 2,
            Self::Lanczos3 => 3,
        }
    }
}

/// Provenance of one GPU resample run.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResampleRunInfo {
    pub backend: EffectiveBackend,
    pub device_id: String,
    pub device_name: String,
    pub filter: String,
    pub duration_ms: f64,
}

/// True when the native GPU engine has a verified implementation for `kind`.
/// Everything else must fall back to the CPU kernels.
pub fn gpu_effect_supported(kind: EffectKind) -> bool {
    matches!(kind, EffectKind::RgbSplit)
}

fn shader_key(kind: EffectKind) -> Option<&'static str> {
    match kind {
        EffectKind::RgbSplit => Some("rgb_split"),
        _ => None,
    }
}

/// A GPU device plus the pipeline cache for effect kernels. Held by the
/// desktop application; dropped and recreated after device loss.
pub struct GpuEffectEngine {
    gpu: GpuCompute,
    layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    pipelines: Mutex<HashMap<&'static str, wgpu::ComputePipeline>>,
}

impl GpuEffectEngine {
    /// Create an engine on the best hardware adapter, or report why none is
    /// usable (software-only, missing, initialization failure).
    pub fn create() -> Result<Self, AccelError> {
        let gpu = GpuCompute::create(None)?;
        Ok(Self::from_compute(gpu))
    }

    pub fn from_compute(gpu: GpuCompute) -> Self {
        let layout = gpu
            .device()
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("varve-effect-layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: false },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
        let pipeline_layout =
            gpu.device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("varve-effect-pipeline-layout"),
                    bind_group_layouts: &[Some(&layout)],
                    immediate_size: 0,
                });
        Self {
            gpu,
            layout,
            pipeline_layout,
            pipelines: Mutex::new(HashMap::new()),
        }
    }

    pub fn info(&self) -> &crate::capability::AcceleratorDevice {
        self.gpu.info()
    }

    pub fn self_test(&self) -> Result<crate::discovery::SelfTestReport, AccelError> {
        self.gpu.self_test()
    }

    /// Apply a live effect on the GPU. Callers must have checked
    /// [`gpu_effect_supported`] first; unsupported kinds return an error so
    /// the caller can fall back to the CPU path.
    pub fn apply(
        &self,
        request: &EffectRequest,
        rgba: &[u8],
    ) -> Result<(Vec<u8>, EffectRunInfo), AccelError> {
        let started = Instant::now();
        let key = shader_key(request.effect).ok_or_else(|| {
            AccelError::Execution(format!("{:?} has no GPU kernel", request.effect))
        })?;
        varve_effects::validate_surface(request.width, request.height, rgba.len())
            .map_err(AccelError::Execution)?;
        let pixels = u64::from(request.width) * u64::from(request.height);
        if pixels > MAX_GPU_EFFECT_PIXELS {
            return Err(AccelError::Execution(format!(
                "Surface contains {pixels} pixels; the GPU effect limit is {MAX_GPU_EFFECT_PIXELS}"
            )));
        }

        let params = pack_params(request)?;
        let byte_len = pixels * 4;

        let input = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-effect-input"),
            size: byte_len,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu.queue().write_buffer(&input, 0, rgba);

        let output = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-effect-output"),
            size: byte_len,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let staging = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-effect-staging"),
            size: byte_len,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniform = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-effect-params"),
            size: PARAMS_BYTES as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu
            .queue()
            .write_buffer(&uniform, 0, &params_bytes(&params));

        let bind_group = self
            .gpu
            .device()
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("varve-effect-bind-group"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: input.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: output.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: uniform.as_entire_binding(),
                    },
                ],
            });

        let pipeline = self.pipeline(key)?;
        let workgroups_x = request.width.div_ceil(8);
        let workgroups_y = request.height.div_ceil(8);
        let mut encoder =
            self.gpu
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("varve-effect-encoder"),
                });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("varve-effect-pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(workgroups_x, workgroups_y, 1);
        }
        encoder.copy_buffer_to_buffer(&output, 0, &staging, 0, byte_len);
        self.gpu.queue().submit(Some(encoder.finish()));

        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.gpu
            .device()
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(READBACK_TIMEOUT),
            })
            .map_err(|err| AccelError::DeviceLost(format!("{err}")))?;
        rx.recv_timeout(READBACK_TIMEOUT)
            .map_err(|_| AccelError::Execution("effect readback timed out".into()))?
            .map_err(|err| AccelError::DeviceLost(format!("effect map failed: {err}")))?;

        let mut result = vec![0u8; rgba.len()];
        {
            let data = slice
                .get_mapped_range()
                .map_err(|err| AccelError::DeviceLost(format!("effect map range failed: {err}")))?;
            if data.len() != result.len() {
                return Err(AccelError::Execution(format!(
                    "GPU returned {} bytes, expected {}",
                    data.len(),
                    result.len()
                )));
            }
            result.copy_from_slice(&data);
        }
        staging.unmap();

        let info = EffectRunInfo {
            backend: EffectiveBackend::Gpu,
            device_id: self.gpu.info().id.clone(),
            device_name: self.gpu.info().name.clone(),
            passes: 1,
            duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        };
        Ok((result, info))
    }

    /// Resample RGBA bytes with the same filters and edge/weighting rules as
    /// image-rs `resize` (used by `varve-upscale` for non-AI methods). Returns
    /// raw RGBA at `dst_width × dst_height`.
    #[allow(clippy::too_many_arguments)]
    pub fn resample(
        &self,
        rgba: &[u8],
        src_width: u32,
        src_height: u32,
        dst_width: u32,
        dst_height: u32,
        filter: GpuResampleFilter,
    ) -> Result<(Vec<u8>, ResampleRunInfo), AccelError> {
        let started = Instant::now();
        if src_width == 0 || src_height == 0 || dst_width == 0 || dst_height == 0 {
            return Err(AccelError::Execution(
                "Resample dimensions must be non-zero".into(),
            ));
        }
        let dst_pixels = u64::from(dst_width) * u64::from(dst_height);
        let src_pixels = u64::from(src_width) * u64::from(src_height);
        if dst_pixels > MAX_GPU_EFFECT_PIXELS || src_pixels > MAX_GPU_EFFECT_PIXELS {
            return Err(AccelError::Execution(format!(
                "Resample surface ({src_pixels} -> {dst_pixels} pixels) exceeds the GPU limit of {MAX_GPU_EFFECT_PIXELS}"
            )));
        }
        // Check the pixel ceiling before multiplying by the RGBA channel
        // count. Arbitrary u32 dimensions can overflow that byte count even
        // though their pixel product still fits in u64.
        let expected = src_pixels * 4;
        if rgba.len() as u64 != expected {
            return Err(AccelError::Execution(format!(
                "Resample source has {} bytes, expected {expected}",
                rgba.len()
            )));
        }

        let ratio_x = src_width as f32 / dst_width as f32;
        let ratio_y = src_height as f32 / dst_height as f32;
        let inv_sratio_x = 1.0f32 / ratio_x.max(1.0);
        let inv_sratio_y = 1.0f32 / ratio_y.max(1.0);
        let mut params = [0.0f32; 12];
        params[0] = src_width as f32;
        params[1] = src_height as f32;
        params[2] = dst_width as f32;
        params[3] = dst_height as f32;
        params[4] = filter.code() as f32;
        params[5] = ratio_x;
        params[6] = ratio_y;
        params[7] = inv_sratio_x;
        params[8] = inv_sratio_y;
        let param_bytes = params_bytes(&params);

        let input_size = src_pixels * 4;
        let output_size = dst_pixels * 4;
        let input = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-resample-input"),
            size: input_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu.queue().write_buffer(&input, 0, rgba);
        let output = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-resample-output"),
            size: output_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let staging = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-resample-staging"),
            size: output_size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniform = self.gpu.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-resample-params"),
            size: PARAMS_BYTES as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu.queue().write_buffer(&uniform, 0, &param_bytes);
        let bind_group = self
            .gpu
            .device()
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("varve-resample-bind-group"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: input.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: output.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: uniform.as_entire_binding(),
                    },
                ],
            });
        let pipeline = self.pipeline("resample")?;
        let mut encoder =
            self.gpu
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("varve-resample-encoder"),
                });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("varve-resample-pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(dst_width.div_ceil(8), dst_height.div_ceil(8), 1);
        }
        encoder.copy_buffer_to_buffer(&output, 0, &staging, 0, output_size);
        self.gpu.queue().submit(Some(encoder.finish()));

        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.gpu
            .device()
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(READBACK_TIMEOUT),
            })
            .map_err(|err| AccelError::DeviceLost(format!("{err}")))?;
        rx.recv_timeout(READBACK_TIMEOUT)
            .map_err(|_| AccelError::Execution("resample readback timed out".into()))?
            .map_err(|err| AccelError::DeviceLost(format!("resample map failed: {err}")))?;

        let mut result = vec![0u8; output_size as usize];
        {
            let data = slice.get_mapped_range().map_err(|err| {
                AccelError::DeviceLost(format!("resample map range failed: {err}"))
            })?;
            if data.len() != result.len() {
                return Err(AccelError::Execution(format!(
                    "GPU resample returned {} bytes, expected {}",
                    data.len(),
                    result.len()
                )));
            }
            result.copy_from_slice(&data);
        }
        staging.unmap();

        let info = ResampleRunInfo {
            backend: EffectiveBackend::Gpu,
            device_id: self.gpu.info().id.clone(),
            device_name: self.gpu.info().name.clone(),
            filter: format!("{filter:?}"),
            duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        };
        Ok((result, info))
    }

    fn pipeline(&self, key: &'static str) -> Result<wgpu::ComputePipeline, AccelError> {
        if let Some(pipeline) = self
            .pipelines
            .lock()
            .map_err(|_| AccelError::Execution("pipeline cache poisoned".into()))?
            .get(key)
            .cloned()
        {
            return Ok(pipeline);
        }
        let (source, entry) = match key {
            "rgb_split" => (wgpu::include_wgsl!("shaders/rgb_split.wgsl"), "main"),
            "resample" => (wgpu::include_wgsl!("shaders/resample.wgsl"), "main"),
            other => {
                return Err(AccelError::Execution(format!(
                    "Unknown GPU effect shader: {other}"
                )))
            }
        };
        let module = self.gpu.device().create_shader_module(source);
        let pipeline =
            self.gpu
                .device()
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("varve-effect-pipeline"),
                    layout: Some(&self.pipeline_layout),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    cache: None,
                });
        self.pipelines
            .lock()
            .map_err(|_| AccelError::Execution("pipeline cache poisoned".into()))?
            .insert(key, pipeline.clone());
        Ok(pipeline)
    }
}

/// Uniform packing for the RGB split kernel. Layout documented in the WGSL.
fn pack_params(request: &EffectRequest) -> Result<[f32; 20], AccelError> {
    let p = Params::new(&request.params);
    let coord = request.coord_space.unwrap_or_default();
    let scale = if coord.scale > 0.0 { coord.scale } else { 1.0 };
    let intensity = clamp01(p.f("intensity", 1.0));
    if intensity <= 0.0 {
        return Err(AccelError::Execution(
            "RGB split intensity is zero; nothing to accelerate".into(),
        ));
    }

    let mut params = [0.0f32; 20];
    params[0] = request.width as f32;
    params[1] = request.height as f32;

    let radial = p.s("mode", "offset") == "radial";
    params[2] = if radial { 1.0 } else { 0.0 };
    params[3] = match p.s("borderMode", "transparent") {
        "clamp" => 1.0,
        "wrap" => 2.0,
        "mirror" => 3.0,
        _ => 0.0,
    };

    if radial {
        let amount = p.f("amount", 4.0) * scale * intensity;
        let falloff = p.f("falloff", 1.0).max(0.0);
        let angle = p.f("fringeAngle", 0.0) * std::f64::consts::PI / 180.0;
        let cx = p.f("centerX", 0.5) * f64::from(request.width);
        let cy = p.f("centerY", 0.5) * f64::from(request.height);
        let ex = cx.max(f64::from(request.width) - cx);
        let ey = cy.max(f64::from(request.height) - cy);
        let max_r = f64::max(1.0, (ex * ex + ey * ey).sqrt());
        params[14] = amount as f32;
        params[15] = falloff as f32;
        params[16] = angle as f32;
        params[17] = cx as f32;
        params[18] = cy as f32;
        params[19] = max_r as f32;
    } else {
        params[4] = (p.f("redX", 0.0) * scale * intensity) as f32;
        params[5] = (p.f("redY", 0.0) * scale * intensity) as f32;
        params[8] = (p.f("greenX", 0.0) * scale * intensity) as f32;
        params[9] = (p.f("greenY", 0.0) * scale * intensity) as f32;
        params[12] = (p.f("blueX", 0.0) * scale * intensity) as f32;
        params[13] = (p.f("blueY", 0.0) * scale * intensity) as f32;
    }
    Ok(params)
}

fn params_bytes(params: &[f32]) -> [u8; PARAMS_BYTES] {
    let mut bytes = [0u8; PARAMS_BYTES];
    for (index, value) in params.iter().enumerate().take(PARAMS_BYTES / 4) {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use varve_effects::{apply_effect, EffectQuality};

    fn synthetic(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
        for y in 0..height {
            for x in 0..width {
                let i = ((y as usize) * (width as usize) + x as usize) * 4;
                let fx = x as f64 / (width.max(2) - 1) as f64;
                let fy = y as f64 / (height.max(2) - 1) as f64;
                rgba[i] = ((fx * 255.0).round() as u8).wrapping_add((x % 7) as u8);
                rgba[i + 1] = ((fy * 255.0).round() as u8).wrapping_add((y % 5) as u8);
                rgba[i + 2] = (((1.0 - fx) * (1.0 - fy) * 255.0).round() as u8).wrapping_add(9);
                rgba[i + 3] = if (x + y) % 3 == 0 {
                    128
                } else if (x * y) % 5 == 0 {
                    0
                } else {
                    255
                };
            }
        }
        rgba
    }

    fn metrics(cpu: &[u8], gpu: &[u8]) -> (i32, f64, f64) {
        assert_eq!(cpu.len(), gpu.len());
        let mut max_diff = 0i32;
        let mut sum = 0f64;
        let mut within_one = 0usize;
        for (a, b) in cpu.iter().zip(gpu.iter()) {
            let diff = (*a as i32 - *b as i32).abs();
            max_diff = max_diff.max(diff);
            sum += f64::from(diff);
            if diff <= 1 {
                within_one += 1;
            }
        }
        let len = cpu.len().max(1) as f64;
        (max_diff, sum / len, within_one as f64 / len)
    }

    fn request(params: serde_json::Value, width: u32, height: u32) -> EffectRequest {
        EffectRequest {
            effect: EffectKind::RgbSplit,
            width,
            height,
            quality: EffectQuality::Export,
            coord_space: None,
            params,
        }
    }

    fn run_parity(params: serde_json::Value, width: u32, height: u32) -> Option<(i32, f64, f64)> {
        let engine = match GpuEffectEngine::create() {
            Ok(engine) => engine,
            Err(err) => {
                eprintln!("skipping GPU parity test: {err}");
                return None;
            }
        };
        let input = synthetic(width, height);
        let cpu_request = request(params.clone(), width, height);
        let cpu = apply_effect(&cpu_request, &input).expect("cpu effect");
        let (gpu, info) = engine.apply(&cpu_request, &input).expect("gpu effect");
        assert_eq!(info.backend, EffectiveBackend::Gpu);
        assert_eq!(gpu.len(), input.len());
        Some(metrics(&cpu, &gpu))
    }

    #[test]
    fn rgb_split_offset_gpu_matches_cpu() {
        let Some((max_diff, mean, within_one)) = run_parity(
            serde_json::json!({
                "mode": "offset",
                "redX": 5.0,
                "redY": -3.0,
                "greenX": -2.0,
                "greenY": 4.0,
                "blueX": 3.5,
                "blueY": 2.0,
                "borderMode": "clamp",
            }),
            129,
            97,
        ) else {
            return;
        };
        eprintln!("rgbSplit offset parity: max={max_diff} mean={mean:.4} within1={within_one:.4}");
        assert!(
            max_diff <= 2,
            "max channel diff {max_diff} exceeds tolerance"
        );
        assert!(mean <= 0.05, "mean channel diff {mean} exceeds tolerance");
        assert!(
            within_one >= 0.999,
            "only {within_one} of bytes are within 1"
        );
    }

    #[test]
    fn rgb_split_radial_gpu_matches_cpu() {
        let Some((max_diff, mean, within_one)) = run_parity(
            serde_json::json!({
                "mode": "radial",
                "amount": 7.0,
                "falloff": 1.0,
                "fringeAngle": 35.0,
                "centerX": 0.45,
                "centerY": 0.55,
                "borderMode": "mirror",
            }),
            96,
            64,
        ) else {
            return;
        };
        eprintln!("rgbSplit radial parity: max={max_diff} mean={mean:.4} within1={within_one:.4}");
        assert!(
            max_diff <= 2,
            "max channel diff {max_diff} exceeds tolerance"
        );
        assert!(mean <= 0.05, "mean channel diff {mean} exceeds tolerance");
    }

    #[test]
    fn gpu_engine_self_test_verifies_execution() {
        match GpuEffectEngine::create() {
            Ok(engine) => {
                let report = engine.self_test().expect("self-test");
                assert_eq!(report.elements_checked, 256);
                assert!(report.duration_ms >= 0.0);
                eprintln!(
                    "GPU self-test passed on {} ({}, {:.1} ms)",
                    report.device_name, report.backend, report.duration_ms
                );
            }
            Err(err) => eprintln!("skipping GPU self-test: {err}"),
        }
    }

    #[test]
    fn unsupported_effects_have_no_gpu_kernel() {
        assert!(gpu_effect_supported(EffectKind::RgbSplit));
        assert!(!gpu_effect_supported(EffectKind::Bloom));
        assert!(!gpu_effect_supported(EffectKind::Caustics));
    }

    fn synthetic_photo(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
        for y in 0..height {
            for x in 0..width {
                let i = ((y as usize) * (width as usize) + x as usize) * 4;
                let fx = x as f64 / width as f64;
                let fy = y as f64 / height as f64;
                rgba[i] =
                    ((fx * 220.0 + (fy * 9.0).sin() * 20.0).round() as i32).clamp(0, 255) as u8;
                rgba[i + 1] =
                    ((fy * 200.0 + (fx * 7.0).cos() * 25.0).round() as i32).clamp(0, 255) as u8;
                rgba[i + 2] = (((fx * 5.0).sin() * (fy * 5.0).cos() * 120.0 + 128.0).round() as i32)
                    .clamp(0, 255) as u8;
                rgba[i + 3] = if (x / 17 + y / 13) % 5 == 0 { 96 } else { 255 };
            }
        }
        rgba
    }

    fn diff_metrics(cpu: &[u8], gpu: &[u8]) -> (i32, f64, f64) {
        assert_eq!(cpu.len(), gpu.len());
        let mut max_diff = 0i32;
        let mut sum = 0f64;
        let mut squared = 0f64;
        for (a, b) in cpu.iter().zip(gpu.iter()) {
            let diff = (*a as i32 - *b as i32).abs();
            max_diff = max_diff.max(diff);
            sum += f64::from(diff);
            squared += f64::from(diff) * f64::from(diff);
        }
        let len = cpu.len().max(1) as f64;
        let mse = squared / len;
        let psnr = if mse == 0.0 {
            999.0
        } else {
            10.0 * (255.0f64 * 255.0 / mse).log10()
        };
        (max_diff, sum / len, psnr)
    }

    #[test]
    fn gpu_resample_matches_cpu_for_all_filters() {
        let engine = match GpuEffectEngine::create() {
            Ok(engine) => engine,
            Err(err) => {
                eprintln!("skipping GPU resample parity test: {err}");
                return;
            }
        };
        let (src_w, src_h) = (320u32, 240u32);
        let (dst_w, dst_h) = (800u32, 600u32);
        let input = synthetic_photo(src_w, src_h);
        let scale = f64::from(dst_w) / f64::from(src_w);
        for method in ["nearest", "bilinear", "bicubic", "lanczos3"] {
            let cpu = varve_upscale::cpu_upscale(
                &input,
                src_w,
                src_h,
                scale,
                varve_upscale::UpscaleFilter::from_method(method),
            )
            .expect("cpu resample");
            let (gpu, info) = engine
                .resample(
                    &input,
                    src_w,
                    src_h,
                    dst_w,
                    dst_h,
                    GpuResampleFilter::from_method(method),
                )
                .expect("gpu resample");
            assert_eq!(info.backend, EffectiveBackend::Gpu);
            let (max_diff, mean, psnr) = diff_metrics(&cpu, &gpu);
            eprintln!("resample {method} parity: max={max_diff} mean={mean:.4} psnr={psnr:.1}dB");
            assert!(max_diff <= 1, "{method}: max channel diff {max_diff}");
            assert!(mean <= 0.01, "{method}: mean channel diff {mean}");
            assert!(psnr >= 70.0, "{method}: psnr {psnr:.1} dB");
        }
    }

    #[test]
    fn gpu_resample_rejects_mismatched_input() {
        let engine = match GpuEffectEngine::create() {
            Ok(engine) => engine,
            Err(err) => {
                eprintln!("skipping GPU resample validation test: {err}");
                return;
            }
        };
        let err = engine
            .resample(&[0u8; 16], 4, 4, 8, 8, GpuResampleFilter::Bilinear)
            .expect_err("short input must be rejected");
        assert!(err.to_string().contains("expected"));
    }

    #[test]
    fn gpu_resample_rejects_oversized_dimensions_before_byte_count() {
        let engine = match GpuEffectEngine::create() {
            Ok(engine) => engine,
            Err(err) => {
                eprintln!("skipping GPU resample dimension validation test: {err}");
                return;
            }
        };
        let err = engine
            .resample(
                &[0u8; 4],
                u32::MAX,
                u32::MAX,
                1,
                1,
                GpuResampleFilter::Bilinear,
            )
            .expect_err("oversized dimensions must be rejected before byte arithmetic");
        assert!(err.to_string().contains("GPU limit"));
    }
}
