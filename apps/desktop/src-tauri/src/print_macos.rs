pub use crate::print_shared::{PrintJobResult, Printer};
use std::path::Path;

pub fn list_printers() -> Vec<Printer> {
    let output = std::process::Command::new("lpstat")
        .args(["-p"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            parse_lpstat_printers(&stdout)
        }
        _ => vec![],
    }
}

fn parse_lpstat_printers(output: &str) -> Vec<Printer> {
    output
        .lines()
        .filter_map(|line| {
            if let Some(name) = line.strip_prefix("printer ") {
                let name = name.split_whitespace().next().unwrap_or("").to_string();
                if name.is_empty() {
                    return None;
                }
                let details = get_printer_details_macos(&name);
                Some(Printer {
                    name,
                    description: details.0,
                    is_color: details.1,
                    paper_sizes: details.2,
                    supports_duplex: details.3,
                    accepting_jobs: line.contains("idle") || line.contains("printing"),
                })
            } else {
                None
            }
        })
        .collect()
}

fn get_printer_details_macos(name: &str) -> (String, bool, Vec<String>, bool) {
    let desc = String::new();
    let color = true;
    let sizes = vec!["A4".to_string(), "Letter".to_string()];
    let duplex = false;

    let output = std::process::Command::new("lpoptions")
        .args(["-p", name, "-l"])
        .output();

    if let Ok(o) = output {
        let stdout = String::from_utf8_lossy(&o.stdout);
        for line in stdout.lines() {
            if line.starts_with("ColorModel") || line.starts_with("ColorModel/") {
                let _has_color = line.contains("RGB") || line.contains("CMYK") || line.contains("CMY");
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
    let safe_title: String = job_title.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let pdf_path = temporary_dir.join(format!("varve_print_{}_{}.pdf", safe_title, staging_id()));

    if let Err(e) = std::fs::write(&pdf_path, pdf_bytes) {
        return PrintJobResult {
            job_id: 0,
            message: format!("Failed to write temp PDF: {}", e),
            success: false,
        };
    }

    let mut cmd = std::process::Command::new("lp");
    cmd.arg("-d").arg(printer_name);
    cmd.arg("-t").arg(job_title);

    if copies > 1 {
        cmd.arg("-n").arg(copies.to_string());
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

    cmd.arg(&pdf_path);

    let output = cmd.output();
    let _ = std::fs::remove_file(&pdf_path);

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
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
            message: format!("Print command error: {}", e),
            success: false,
        },
    }
}

fn staging_id() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

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
