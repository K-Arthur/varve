//! Public data types for Varve's selected-layer plugin API v1.
//!
//! Guest modules import only `env.memory` and export `alloc`, `run`, and
//! `result_len`. The host owns all permissions, rendering, and document edits.
//! This crate defines the JSON contract; it does not grant host capabilities.

use serde::{Deserialize, Serialize};

pub const API_VERSION: u32 = 1;
pub const MAX_SELECTION: usize = 100;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestInput {
    pub api_version: u32,
    pub command_id: String,
    pub document_id: String,
    pub revision: u64,
    pub selection: Vec<SelectedNode>,
}

impl GuestInput {
    pub fn is_for(&self, command: &str) -> bool {
        self.api_version == API_VERSION
            && self.command_id == command
            && !self.document_id.is_empty()
            && !self.selection.is_empty()
            && self.selection.len() <= MAX_SELECTION
    }
}

#[derive(Debug, Deserialize)]
pub struct SelectedNode {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub locked: bool,
    pub style: StyleSnapshot,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleSnapshot {
    pub opacity: f64,
    pub blend_mode: String,
    pub paint_count: u32,
    pub stroke_count: u32,
    pub font_family: Option<String>,
    pub font_size: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProposal {
    pub id: String,
    pub expected_name: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct GuestOutput {
    pub summary: String,
    pub lines: Vec<String>,
    pub renames: Vec<RenameProposal>,
}
