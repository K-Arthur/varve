pub use crate::print_shared::{PrintJobResult, Printer};
use std::path::Path;

pub fn list_printers() -> Vec<Printer> {
    let output = std::process::Command::new("wmic")
        .args(["printer", "get", "name,description,local,default,printerstate"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            parse_wmic_printers(&stdout)
        }
        _ => fallback_powershell_printers(),
    }
}

fn parse_wmic_printers(output: &str) -> Vec<Printer> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let name = line.split(',').next().unwrap_or(line).trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(Printer {
                name,
                description: String::new(),
                is_color: true,
                paper_sizes: vec!["A4".to_string(), "Letter".to_string()],
                supports_duplex: false,
                accepting_jobs: true,
            })
        })
        .collect()
}

fn fallback_powershell_printers() -> Vec<Printer> {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-Printer | Select-Object Name,DriverName | ConvertTo-Json",
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.trim() == "[]" || stdout.trim().is_empty() {
                return vec![];
            }
            parse_powershell_printers_json(&stdout)
        }
        _ => vec![],
    }
}

fn parse_powershell_printers_json(json: &str) -> Vec<Printer> {
    let mut printers = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        let arr = match value {
            serde_json::Value::Array(ref arr) => arr,
            serde_json::Value::Object(ref obj) => {
                if let Some(name) = obj.get("Name").and_then(|n| n.as_str()) {
                    printers.push(Printer {
                        name: name.to_string(),
                        description: obj
                            .get("DriverName")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        is_color: true,
                        paper_sizes: vec!["A4".to_string(), "Letter".to_string()],
                        supports_duplex: false,
                        accepting_jobs: true,
                    });
                }
                return printers;
            }
            _ => return printers,
        };
        for item in arr {
            if let Some(name) = item.get("Name").and_then(|n| n.as_str()) {
                printers.push(Printer {
                    name: name.to_string(),
                    description: item
                        .get("DriverName")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string(),
                    is_color: true,
                    paper_sizes: vec!["A4".to_string(), "Letter".to_string()],
                    supports_duplex: false,
                    accepting_jobs: true,
                });
            }
        }
    }
    printers
}

pub fn print_pdf(
    temporary_dir: &Path,
    printer_name: &str,
    pdf_bytes: &[u8],
    job_title: &str,
    copies: u32,
    _duplex: bool,
    _color_mode: &str,
    _page_size: &str,
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

    let ps_args = vec!["-NoProfile", "-WindowStyle", "Hidden"];
    let printer_flag = format!("-PrinterName '{}'", printer_name.replace('\'', "''"));
    let verb_flag = "Start-Process".to_string();
    let ps_script = format!(
        "{} -FilePath '{}' -Verb Print {} -PassThru | Select-Object -ExpandProperty Id",
        verb_flag,
        pdf_path.display().to_string().replace('\'', "''"),
        printer_flag,
    );

    if copies > 1 {
        let _ = copies;
    }

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(ps_args);
    cmd.arg("-Command");
    cmd.arg(&ps_script);

    let output = cmd.output();

    let _ = std::fs::remove_file(&pdf_path);

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let job_id = stdout.trim().parse::<u32>().unwrap_or(0);
            PrintJobResult {
                job_id,
                message: "Sent to printer".to_string(),
                success: true,
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
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
    let ps_script = format!(
        "Remove-PrintJob -PrinterName '{}' -ID {}",
        printer_name.replace('\'', "''"),
        job_id,
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to cancel job: {}", e))?;

    if output.status.success() {
        Ok(format!("Cancelled job {} on {}", job_id, printer_name))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Cancel failed: {}", stderr.trim()))
    }
}
