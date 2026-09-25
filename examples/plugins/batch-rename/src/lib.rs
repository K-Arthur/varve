//! Varve API v1 undoable rename example. This guest only proposes names;
//! the host rechecks targets, shows a preview, and commits one history step.
use std::sync::Mutex;
use varve_plugin_sdk::{GuestInput, GuestOutput, RenameProposal, MAX_INPUT_BYTES};
#[cfg(test)]
use varve_plugin_sdk::{SelectedNode, StyleSnapshot};

static INPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn unavailable() -> GuestOutput {
    GuestOutput {
        summary: "Cannot preview layer names".into(),
        lines: vec!["Run this command with a valid API v1 selection.".into()],
        renames: vec![],
    }
}

fn remove_number_prefix(name: &str) -> &str {
    match name.split_once(" · ") {
        Some((prefix, rest))
            if (1..=3).contains(&prefix.len()) && prefix.bytes().all(|b| b.is_ascii_digit()) =>
        {
            rest
        }
        _ => name,
    }
}

fn normalized_name(name: &str) -> String {
    remove_number_prefix(name)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(100) // At most 200 UTF-16 units; the host limit is 256.
        .collect()
}

fn preview(input: GuestInput) -> GuestOutput {
    if !input.is_for("rename") {
        return unavailable();
    }
    let mut renames = Vec::new();
    let mut locked = 0;
    let mut too_long = 0;
    let mut ordinal = 0;
    for node in &input.selection {
        if node.locked {
            locked += 1;
            continue;
        }
        // The host validates expectedName against its bounded proposal schema.
        if node.id.is_empty() || node.name.encode_utf16().count() > 256 {
            too_long += 1;
            continue;
        }
        ordinal += 1;
        let base = normalized_name(&node.name);
        let base = if base.is_empty() {
            format!("{} layer", node.kind.chars().take(40).collect::<String>())
        } else {
            base
        };
        let candidate = format!("{ordinal:02} · {base}");
        if candidate != node.name {
            renames.push(RenameProposal {
                id: node.id.clone(),
                expected_name: node.name.clone(),
                name: candidate,
            });
        }
    }
    let count = renames.len();
    GuestOutput {
        summary: format!("Preview {count} numbered layer names"),
        lines: vec![
            "Names are numbered in selection order. Existing number prefixes are replaced; artwork stays editable.".into(),
            format!("{locked} locked layers skipped; {too_long} layers with overlong names skipped."),
            format!("Based on document revision {}. Apply in Varve after reviewing the preview.", input.revision),
        ],
        renames,
    }
}

fn encode(output: GuestOutput) -> i32 {
    let bytes = serde_json::to_vec(&output).unwrap_or_else(|_| {
        b"{\"summary\":\"Preview failed\",\"lines\":[],\"renames\":[]}".to_vec()
    });
    let mut result = RESULT.lock().unwrap();
    *result = bytes;
    result.as_ptr() as i32
}

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

#[no_mangle]
pub extern "C" fn run(pointer: i32, length: i32) -> i32 {
    let output = (|| {
        let length = usize::try_from(length).ok()?;
        let input = INPUT.lock().ok()?;
        if pointer < 0 || pointer as usize != input.as_ptr() as usize || length > input.len() {
            return None;
        }
        let request: GuestInput = serde_json::from_slice(&input[..length]).ok()?;
        Some(preview(request))
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

    fn node(id: &str, name: &str, locked: bool) -> SelectedNode {
        SelectedNode {
            id: id.into(),
            name: name.into(),
            kind: "frame".into(),
            locked,
            style: StyleSnapshot::default(),
        }
    }

    #[test]
    fn proposes_renames_and_skips_locked_layers() {
        let output = preview(GuestInput {
            api_version: 1,
            command_id: "rename".into(),
            document_id: "doc".into(),
            revision: 7,
            selection: vec![
                node("1", "Card", false),
                node("2", "Locked", true),
                node("3", "01 · Button", false),
            ],
        });
        assert_eq!(output.renames.len(), 2);
        assert_eq!(output.renames[0].name, "01 · Card");
        assert_eq!(output.renames[1].name, "02 · Button");
        assert!(output.lines.iter().any(|line| line.contains("1 locked")));
    }
}
