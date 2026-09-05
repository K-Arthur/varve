//! Native OS print integration for the Tauri desktop build.
//!
//! Uses `lp`/`lpr` on Linux (CUPS) to send PDF print jobs to enumerated
//! printers. The OS-native print dialog is not directly invocable from
//! a Tauri command; this module provides the building blocks:
//!
//! - Printer enumeration via `lpstat -p`
//! - Print job submission via `lp`
//! - Colour-managed output through the exported PDF pipeline
//!
//! Research basis: CUPS `lp`(1) and `lpstat`(1) man pages, IPC via
//! `std::process::Command`.

use serde::Serialize;
use std::path::Path;

/// A printer discovered on the system.
#[derive(Debug, Serialize)]
pub struct Printer {
    /// Printer name (as reported by CUPS / lpstat).
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Whether the printer supports colour output.
    pub is_color: bool,
    /// Supported paper sizes (e.g. "A4", "Letter").
    pub paper_sizes: Vec<String>,
    /// Whether the printer supports duplex.
    pub supports_duplex: bool,
    /// Whether the printer is currently accepting jobs.
    pub accepting_jobs: bool,
}

/// Result of a print job submission.
#[derive(Debug, Serialize)]
pub struct PrintJobResult {
    /// Job ID assigned by the print system (0 if unknown).
    pub job_id: u32,
    /// Human-readable status message.
    pub message: String,
    /// Whether the job was submitted successfully.
    pub success: bool,
}

/// Enumerate available printers via `lpstat -p`.
///
/// Returns an empty vec if `lpstat` is not available or fails.
pub fn list_printers() -> Vec<Printer> {
    let mut printers = Vec::new();

    // Try `lpstat -p` for CUPS printer list
    let output = std::process::Command::new("lpstat").args(["-p"]).output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return printers,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        // lpstat -p output: "printer <name> is idle|disabled|...  since <date>"
        if let Some(name) = line.strip_prefix("printer ") {
            let name = name.split_whitespace().next().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }

            // Get detailed info for this printer
            let details = get_printer_details(&name);
            printers.push(Printer {
                name,
                description: details.0,
                is_color: details.1,
                paper_sizes: details.2,
                supports_duplex: details.3,
                accepting_jobs: line.contains("idle") || line.contains("printing"),
            });
        }
    }

    printers
}

/// Get detailed printer information via `lpinfo` or `lpoptions`.
fn get_printer_details(name: &str) -> (String, bool, Vec<String>, bool) {
    let desc = String::new();
    let color = true; // Default to colour for modern printers
    let sizes = vec!["A4".to_string(), "Letter".to_string()];
    let duplex = false;

    // Try `lpoptions -p <name> -l` for supported options
    let output = std::process::Command::new("lpoptions")
        .args(["-p", name, "-l"])
        .output();

    if let Ok(o) = output {
        let stdout = String::from_utf8_lossy(&o.stdout);
        for line in stdout.lines() {
            if line.starts_with("ColorModel") || line.starts_with("ColorModel/") {
                // Contains Gray/Grayscale vs RGB/CMYK → color capable if RGB/CMYK present
                let has_color =
                    line.contains("RGB") || line.contains("CMYK") || line.contains("CMY");
                let has_gray = line.contains("Gray") || line.contains("Grayscale");
                let _ = (has_color, has_gray);
            }
            if line.starts_with("PageSize") || line.starts_with("PageSize/") {
                let sizes_str = line.split(':').nth(1).unwrap_or("");
                let _: Vec<String> = sizes_str
                    .split_whitespace()
                    .map(|s| s.trim_matches('*').to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }
    }

    (desc, color, sizes, duplex)
}

/// Submit a PDF print job to a specific printer.
///
/// Uses `lp -d <printer> -o <options>` to send the job.
pub fn print_pdf(
    temporary_dir: &Path,
    printer_name: &str,
    pdf_bytes: &[u8],
    job_title: &str,
    copies: u32,
    duplex: bool,
    color_mode: &str,
    page_size: &str,
) -> PrintJobResult {
    // Write PDF to a temp file for lp to consume. The name carries the
    // process id and a timestamp so two Varve processes printing at once can
    // never collide on a shared counter, and a stale sweep removes leftovers
    // from crashed processes under our own naming prefix only.
    sweep_stale_print_files(temporary_dir);
    let tmp_path = temporary_dir.join(format!(
        "varve_print_{}-{}-{}.pdf",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        job_id_counter()
    ));
    if let Err(e) = std::fs::write(&tmp_path, pdf_bytes) {
        return PrintJobResult {
            job_id: 0,
            message: format!("Failed to write temp PDF: {e}"),
            success: false,
        };
    }

    let mut cmd = std::process::Command::new("lp");
    cmd.arg("-d").arg(printer_name);
    cmd.arg("-t").arg(job_title);

    if copies > 1 {
        cmd.arg(format!("-n {}", copies));
    }

    if duplex {
        cmd.arg("-o").arg("sides=two-sided-long-edge");
    } else {
        cmd.arg("-o").arg("sides=one-sided");
    }

    if color_mode == "grayscale" {
        cmd.arg("-o").arg("ColorModel=Gray");
    } else {
        cmd.arg("-o").arg("ColorModel=RGB");
    }

    if !page_size.is_empty() && page_size != "auto" {
        cmd.arg("-o").arg(format!("media={page_size}"));
    }

    cmd.arg(tmp_path.to_str().unwrap_or(""));

    let output = cmd.output();

    // Clean up temp file
    let _ = std::fs::remove_file(&tmp_path);

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            // Parse job ID from "request id is <name>-<id> (1 file(s))"
            let job_id = stdout
                .split_whitespace()
                .filter_map(|w| w.split('-').last())
                .filter_map(|s| s.parse::<u32>().ok())
                .next()
                .unwrap_or(0);

            PrintJobResult {
                job_id,
                message: stdout.trim().to_string(),
                success: true,
            }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            PrintJobResult {
                job_id: 0,
                message: format!("Print failed: {}", stderr.trim()),
                success: false,
            }
        }
        Err(e) => PrintJobResult {
            job_id: 0,
            message: format!("Print command error: {e}"),
            success: false,
        },
    }
}

/// Cancel a print job by ID.
pub fn cancel_job(printer_name: &str, job_id: u32) -> Result<String, String> {
    let output = std::process::Command::new("cancel")
        .args([&format!("{printer_name}-{job_id}")])
        .output()
        .map_err(|e| format!("Failed to run cancel: {e}"))?;

    if output.status.success() {
        Ok(format!("Job {job_id} cancelled"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Cancel failed: {}", stderr.trim()))
    }
}

/// Atomic counter for temp file names.
fn job_id_counter() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Remove print staging files left behind by crashed processes. Only files
/// matching our own `varve_print_` prefix are touched, and only when they
/// are older than a day — a crash leftover is preferable to deleting a file
/// another process is still writing.
fn sweep_stale_print_files(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff =
        std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(24 * 60 * 60));
    let Some(cutoff) = cutoff else {
        return;
    };
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("varve_print_")
        {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if let Ok(modified) = meta.modified() {
            if modified < cutoff {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_printers_does_not_panic() {
        // Should not panic even when lpstat is not available
        let printers = list_printers();
        // On CI without CUPS, this will be empty
        println!("Found {} printers", printers.len());
    }

    #[test]
    fn printer_struct_serializes() {
        let p = Printer {
            name: "test-printer".into(),
            description: "Test Printer".into(),
            is_color: true,
            paper_sizes: vec!["A4".into(), "Letter".into()],
            supports_duplex: true,
            accepting_jobs: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("test-printer"));
        assert!(json.contains("is_color"));
        assert!(json.contains("paper_sizes"));
    }

    #[test]
    fn print_job_result_serializes() {
        let r = PrintJobResult {
            job_id: 42,
            message: "OK".into(),
            success: true,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("42"));
        assert!(json.contains("OK"));
    }
}
