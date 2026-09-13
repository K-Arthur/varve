//! Native resource checks for local generative editing.
//!
//! The renderer cannot reliably observe available system memory, especially
//! on ChromeOS and embedded browser environments. The desktop command owns
//! the last preflight immediately before starting the helper so a low-memory
//! device receives a deterministic refusal instead of an avoidable OOM.

const BYTES_PER_MIB: u64 = 1024 * 1024;
const BYTES_PER_GIB: u64 = 1024 * BYTES_PER_MIB;
pub(crate) const NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES: u64 = 6 * BYTES_PER_GIB;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeResourceSnapshot {
    pub(crate) available_memory_bytes: Option<u64>,
    pub(crate) required_memory_bytes: u64,
    pub(crate) resource_tier: &'static str,
    pub(crate) execution_backend: &'static str,
    pub(crate) architecture: &'static str,
}

/// Parse Linux's stable MemAvailable field. ChromeOS's Linux desktop runtime
/// exposes the same procfs contract, so this also covers the native Linux
/// container without special-case ChromeOS detection.
fn parse_linux_available_memory(contents: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        if fields.next()? != "MemAvailable:" {
            return None;
        }
        let kib = fields.next()?.parse::<u64>().ok()?;
        kib.checked_mul(1024)
    })
}

#[cfg(target_os = "linux")]
fn available_memory_bytes_impl() -> Option<u64> {
    let contents = std::fs::read_to_string("/proc/meminfo").ok()?;
    parse_linux_available_memory(&contents)
}

#[cfg(target_os = "windows")]
fn available_memory_bytes_impl() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: Windows initializes the caller-owned structure when the size
    // field is set as required by GlobalMemoryStatusEx.
    let success = unsafe { GlobalMemoryStatusEx(&mut status) };
    (success != 0).then_some(status.ullAvailPhys)
}

#[cfg(target_os = "macos")]
fn available_memory_bytes_impl() -> Option<u64> {
    let mut statistics = std::mem::MaybeUninit::<libc::vm_statistics64>::zeroed();
    let mut count = libc::HOST_VM_INFO64_COUNT;
    // SAFETY: `statistics` is writable storage of the exact structure used by
    // HOST_VM_INFO64, and `count` is initialized to its element count.
    let result = unsafe {
        libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            statistics.as_mut_ptr().cast(),
            &mut count,
        )
    };
    if result != 0 {
        return None;
    }
    // SAFETY: host_statistics64 returned success and initialized the output.
    let statistics = unsafe { statistics.assume_init() };
    let available_pages = u64::from(statistics.free_count)
        .checked_add(u64::from(statistics.inactive_count))?
        .checked_add(u64::from(statistics.speculative_count))?;
    let page_size = unsafe { u64::from(libc::vm_page_size) };
    available_pages.checked_mul(page_size)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn available_memory_bytes_impl() -> Option<u64> {
    None
}

pub(crate) fn available_memory_bytes() -> Option<u64> {
    available_memory_bytes_impl()
}

pub(crate) fn resource_tier(available_memory_bytes: Option<u64>) -> &'static str {
    match available_memory_bytes {
        Some(bytes) if bytes < 4 * BYTES_PER_GIB => "constrained",
        Some(bytes) if bytes < 8 * BYTES_PER_GIB => "standard",
        Some(_) => "high",
        None => "unknown",
    }
}

pub(crate) fn estimated_required_memory_bytes(width: u32, height: u32) -> Option<u64> {
    let pixels = u64::from(width).checked_mul(u64::from(height))?;
    if pixels == 0 {
        return None;
    }
    // The fixed model minimum is deliberately conservative. The frame term
    // prevents a future larger output from bypassing the check merely because
    // the model itself fits; six RGBA working buffers cover helper input,
    // latent staging, output, and conversion copies.
    let frame_working_bytes = pixels.checked_mul(4)?.checked_mul(6)?;
    NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES.checked_add(frame_working_bytes)
}

pub(crate) fn snapshot(width: u32, height: u32) -> NativeResourceSnapshot {
    let available_memory_bytes = available_memory_bytes();
    NativeResourceSnapshot {
        available_memory_bytes,
        required_memory_bytes: estimated_required_memory_bytes(width, height)
            .unwrap_or(NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES),
        resource_tier: resource_tier(available_memory_bytes),
        execution_backend: "native-cpu",
        architecture: std::env::consts::ARCH,
    }
}

pub(crate) fn preflight(width: u32, height: u32) -> Result<NativeResourceSnapshot, String> {
    let snapshot = snapshot(width, height);
    if let Some(available) = snapshot.available_memory_bytes {
        if available < snapshot.required_memory_bytes {
            let available_mib = (available / BYTES_PER_MIB).max(1);
            let required_mib = snapshot.required_memory_bytes.div_ceil(BYTES_PER_MIB);
            return Err(format!(
                "Local diffusion generation needs about {required_mib} MiB, but only {available_mib} MiB is currently available on this {} device. Close other memory-heavy apps or use Quick Cleanup, which does not load the diffusion model.",
                snapshot.architecture
            ));
        }
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::{estimated_required_memory_bytes, parse_linux_available_memory, resource_tier};

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn parses_linux_mem_available_without_confusing_total_memory() {
        let contents =
            "MemTotal:       8000000 kB\nMemFree:        1000000 kB\nMemAvailable:   3500000 kB\n";
        assert_eq!(
            parse_linux_available_memory(contents),
            Some(3_500_000 * 1024)
        );
    }

    #[test]
    fn unknown_or_low_memory_is_classified_conservatively() {
        assert_eq!(resource_tier(None), "unknown");
        assert_eq!(resource_tier(Some(4 * GIB - 1)), "constrained");
        assert_eq!(resource_tier(Some(4 * GIB)), "standard");
        assert_eq!(resource_tier(Some(8 * GIB)), "high");
    }

    #[test]
    fn diffusion_requirement_is_nonzero_and_scales_for_large_frames() {
        let base = estimated_required_memory_bytes(512, 512).expect("valid dimensions");
        let large = estimated_required_memory_bytes(2048, 2048).expect("valid dimensions");
        assert!(base >= 6 * GIB);
        assert!(large > base);
        assert_eq!(estimated_required_memory_bytes(0, 512), None);
    }
}
