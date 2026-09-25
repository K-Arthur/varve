//! Read-only Varve API v1 example. The guest receives only a selected-node
//! snapshot; no document, DOM, Tauri, filesystem, network, or WASI handle.
use std::collections::BTreeMap;
use std::sync::Mutex;
#[cfg(test)]
use varve_plugin_sdk::StyleSnapshot;
use varve_plugin_sdk::{GuestInput, GuestOutput, SelectedNode, MAX_INPUT_BYTES};

static INPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn unavailable() -> GuestOutput {
    GuestOutput {
        summary: "Cannot analyze this selection".into(),
        lines: vec!["Run Analyze selection with a valid API v1 snapshot.".into()],
        renames: vec![],
    }
}

fn count_line(label: &str, values: impl Iterator<Item = u32>) -> String {
    let values: Vec<u32> = values.collect();
    let min = values.iter().min().copied().unwrap_or(0);
    let max = values.iter().max().copied().unwrap_or(0);
    if min == max {
        format!("{label}: {min} per layer.")
    } else {
        format!("{label}: mixed ({min} to {max} per layer).")
    }
}

fn opacity_line(nodes: &[SelectedNode]) -> String {
    let min = nodes
        .iter()
        .map(|node| node.style.opacity)
        .fold(f64::INFINITY, f64::min);
    let max = nodes
        .iter()
        .map(|node| node.style.opacity)
        .fold(f64::NEG_INFINITY, f64::max);
    if min == max {
        format!("Opacity: {:.1}% across the selection.", min * 100.0)
    } else {
        format!(
            "Opacity: mixed ({:.1}% to {:.1}%).",
            min * 100.0,
            max * 100.0
        )
    }
}

fn blend_line(nodes: &[SelectedNode]) -> String {
    let modes: std::collections::BTreeSet<&str> = nodes
        .iter()
        .map(|node| node.style.blend_mode.as_str())
        .collect();
    if modes.len() == 1 {
        format!(
            "Blend mode: {} across the selection.",
            modes.first().copied().unwrap_or("unknown")
        )
    } else {
        let examples = modes.iter().take(3).copied().collect::<Vec<_>>().join(", ");
        let remaining = modes.len().saturating_sub(3);
        let more = if remaining > 0 {
            format!(", +{remaining} more")
        } else {
            String::new()
        };
        format!("Blend mode: mixed ({}{more}).", examples)
    }
}

fn font_lines(nodes: &[SelectedNode]) -> [String; 2] {
    let text: Vec<&SelectedNode> = nodes.iter().filter(|node| node.kind == "text").collect();
    if text.is_empty() {
        return [
            "Font family: no text layers selected.".into(),
            "Font size: no text layers selected.".into(),
        ];
    }
    let families: std::collections::BTreeSet<&str> = text
        .iter()
        .filter_map(|node| node.style.font_family.as_deref())
        .collect();
    let missing_families = text.len()
        - text
            .iter()
            .filter(|node| node.style.font_family.is_some())
            .count();
    let family = if families.len() == 1 && missing_families == 0 {
        format!(
            "Font family: {} across selected text.",
            families.first().copied().unwrap_or("unknown")
        )
    } else if families.is_empty() {
        "Font family: unavailable for selected text.".into()
    } else {
        format!(
            "Font family: mixed or unavailable ({} distinct, {missing_families} unspecified).",
            families.len()
        )
    };
    let sizes: Vec<f64> = text
        .iter()
        .filter_map(|node| node.style.font_size)
        .collect();
    let size = if sizes.is_empty() {
        "Font size: unavailable for selected text.".into()
    } else {
        let min = sizes.iter().copied().fold(f64::INFINITY, f64::min);
        let max = sizes.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if min == max && sizes.len() == text.len() {
            format!("Font size: {min:.1} px across selected text.")
        } else {
            format!(
                "Font size: mixed or unavailable ({min:.1} to {max:.1} px; {} unspecified).",
                text.len() - sizes.len()
            )
        }
    };
    [family, size]
}

fn analyze(input: GuestInput) -> GuestOutput {
    if !input.is_for("analyze") {
        return unavailable();
    }
    let mut kinds = BTreeMap::<String, usize>::new();
    let mut names = BTreeMap::<String, usize>::new();
    let mut locked = 0;
    let mut unnamed = 0;
    for node in &input.selection {
        if node.id.is_empty()
            || !node.style.opacity.is_finite()
            || !(0.0..=1.0).contains(&node.style.opacity)
            || node.style.blend_mode.is_empty()
            || node
                .style
                .font_size
                .is_some_and(|size| !size.is_finite() || size <= 0.0)
        {
            return unavailable();
        }
        *kinds.entry(node.kind.clone()).or_default() += 1;
        if node.locked {
            locked += 1;
        }
        let normalized = node.name.trim().to_lowercase();
        if normalized.is_empty() {
            unnamed += 1;
        } else {
            *names.entry(normalized).or_default() += 1;
        }
    }
    let duplicate_name_groups = names.values().filter(|count| **count > 1).count();
    let mut lines = Vec::with_capacity(12);
    lines.push(format!(
        "Selected objects by kind: {}",
        kinds
            .iter()
            .map(|(kind, count)| format!("{kind} {count}"))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    lines.push(opacity_line(&input.selection));
    lines.push(blend_line(&input.selection));
    lines.push(count_line(
        "Paint count",
        input.selection.iter().map(|node| node.style.paint_count),
    ));
    lines.push(count_line(
        "Stroke count",
        input.selection.iter().map(|node| node.style.stroke_count),
    ));
    lines.extend(font_lines(&input.selection));
    lines.push(format!("Locked layers: {locked}; unnamed layers: {unnamed}; repeated names: {duplicate_name_groups}."));
    lines.push(format!(
        "Snapshot revision: {}. Re-run after changing the selection.",
        input.revision
    ));
    lines.push("API v1 exposes counts and selected text font values, but not fill/stroke colors or computed styles.".into());
    GuestOutput {
        summary: format!(
            "Selection style audit: {} layers, {locked} locked",
            input.selection.len()
        ),
        lines,
        renames: vec![],
    }
}

fn encode(output: GuestOutput) -> i32 {
    let bytes = serde_json::to_vec(&output).unwrap_or_else(|_| {
        b"{\"summary\":\"Analysis failed\",\"lines\":[],\"renames\":[]}".to_vec()
    });
    let mut result = RESULT.lock().unwrap();
    *result = bytes;
    result.as_ptr() as i32
}

/// Reserve guest-owned input memory. The host copies UTF-8 JSON here.
#[no_mangle]
pub extern "C" fn alloc(length: i32) -> i32 {
    let Ok(length) = usize::try_from(length) else {
        return 0;
    };
    if length > MAX_INPUT_BYTES {
        return 0;
    }
    let mut input = INPUT.lock().unwrap();
    input.resize(length, 0);
    input.as_mut_ptr() as i32
}

/// Parse a bounded snapshot and return a pointer to a JSON result proposal.
#[no_mangle]
pub extern "C" fn run(pointer: i32, length: i32) -> i32 {
    let output = (|| {
        let length = usize::try_from(length).ok()?;
        let input = INPUT.lock().ok()?;
        if pointer < 0 || pointer as usize != input.as_ptr() as usize || length > input.len() {
            return None;
        }
        let request: GuestInput = serde_json::from_slice(&input[..length]).ok()?;
        Some(analyze(request))
    })()
    .unwrap_or_else(unavailable);
    encode(output)
}

#[no_mangle]
pub extern "C" fn result_len() -> i32 {
    RESULT.lock().unwrap().len() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(
        opacity: f64,
        blend_mode: &str,
        paints: u32,
        strokes: u32,
        family: Option<&str>,
        size: Option<f64>,
    ) -> StyleSnapshot {
        StyleSnapshot {
            opacity,
            blend_mode: blend_mode.into(),
            paint_count: paints,
            stroke_count: strokes,
            font_family: family.map(str::to_owned),
            font_size: size,
        }
    }

    #[test]
    fn reports_mixed_style_and_naming_without_edit_proposals() {
        let output = analyze(GuestInput {
            api_version: 1,
            command_id: "analyze".into(),
            document_id: "doc".into(),
            revision: 4,
            selection: vec![
                SelectedNode {
                    id: "1".into(),
                    name: "Card".into(),
                    kind: "frame".into(),
                    locked: false,
                    style: style(1.0, "normal", 2, 1, None, None),
                },
                SelectedNode {
                    id: "2".into(),
                    name: "Card".into(),
                    kind: "text".into(),
                    locked: true,
                    style: style(0.5, "multiply", 1, 0, Some("Inter"), Some(16.0)),
                },
                SelectedNode {
                    id: "3".into(),
                    name: "Caption".into(),
                    kind: "text".into(),
                    locked: false,
                    style: style(1.0, "normal", 1, 0, Some("Source Sans"), Some(12.0)),
                },
            ],
        });
        assert!(output.summary.contains("3 layers"));
        assert!(output
            .lines
            .iter()
            .any(|line| line.contains("repeated names: 1")));
        for expected in [
            "Opacity: mixed",
            "Blend mode: mixed",
            "Paint count: mixed",
            "Stroke count: mixed",
            "Font family: mixed",
            "Font size: mixed",
        ] {
            assert!(
                output.lines.iter().any(|line| line.contains(expected)),
                "missing {expected}"
            );
        }
        assert!(output.renames.is_empty());
    }

    #[test]
    fn reports_uniform_values_without_inventing_color_values() {
        let output = analyze(GuestInput {
            api_version: 1,
            command_id: "analyze".into(),
            document_id: "doc".into(),
            revision: 5,
            selection: vec![SelectedNode {
                id: "text".into(),
                name: "Headline".into(),
                kind: "text".into(),
                locked: false,
                style: style(1.0, "normal", 1, 0, Some("Inter"), Some(24.0)),
            }],
        });
        assert!(output
            .lines
            .iter()
            .any(|line| line.contains("Opacity: 100.0%")));
        assert!(output
            .lines
            .iter()
            .any(|line| line.contains("Font family: Inter")));
        assert!(output
            .lines
            .iter()
            .any(|line| line.contains("not fill/stroke colors")));
    }
}
