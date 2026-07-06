//! WASM bindings for `@strata/engine` web backend.

use strata_bridge::parse_engine_nodes_json;
use strata_core::Point;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn build_ir_json(nodes_json: &str) -> Result<String, JsValue> {
    let scene = parse_engine_nodes_json(nodes_json).map_err(|e| JsValue::from_str(&e))?;
    let ir = strata_engine::build_render_ir(&scene);
    serde_json::to_string(&ir).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn hit_test_json(nodes_json: &str, x: f64, y: f64) -> Result<i32, JsValue> {
    let scene = parse_engine_nodes_json(nodes_json).map_err(|e| JsValue::from_str(&e))?;
    Ok(strata_core::hit_test(&scene, Point::new(x, y))
        .map(|i| i as i32)
        .unwrap_or(-1))
}

#[wasm_bindgen]
pub fn wasm_engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
