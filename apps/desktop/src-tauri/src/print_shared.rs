use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Printer {
    pub name: String,
    pub description: String,
    pub is_color: bool,
    pub paper_sizes: Vec<String>,
    pub supports_duplex: bool,
    pub accepting_jobs: bool,
}

#[derive(Debug, Serialize)]
pub struct PrintJobResult {
    pub job_id: u32,
    pub message: String,
    pub success: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

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
