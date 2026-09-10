use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder, MenuItemKind, SubmenuBuilder};
use tauri::{AppHandle, Wry};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum NativeMenuItemSpec {
    #[serde(rename = "item")]
    Item {
        id: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        accelerator: Option<String>,
        #[serde(default = "default_enabled")]
        enabled: bool,
    },
    #[serde(rename = "check")]
    Check {
        id: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        accelerator: Option<String>,
        #[serde(default = "default_enabled")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
    },
    #[serde(rename = "separator")]
    Separator { id: String },
    #[serde(rename = "submenu")]
    Submenu {
        id: String,
        label: String,
        items: Vec<NativeMenuItemSpec>,
        #[serde(default = "default_enabled")]
        enabled: bool,
    },
    #[serde(rename = "predefined")]
    Predefined {
        id: String,
        // The frontend spec is camelCase throughout. This is the only
        // multi-word field in it, and being non-optional the mismatch failed
        // the whole `build_native_menu` payload with "missing field
        // `item_type`" — so no native menu was ever installed.
        #[serde(rename = "itemType")]
        item_type: String,
    },
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeSubmenuSpec {
    pub id: String,
    pub label: String,
    pub items: Vec<NativeMenuItemSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeMenuSpec {
    pub submenus: Vec<NativeSubmenuSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuStatePatch {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Build the full native menu tree from a spec, set it on the app, and wire
/// up event forwarding to the webview.
pub fn build_and_set_menu(app: &AppHandle<Wry>, spec: &NativeMenuSpec) -> Result<(), String> {
    let mut builder = MenuBuilder::new(app);

    for sub_spec in &spec.submenus {
        let mut sub_builder = SubmenuBuilder::new(app, &sub_spec.label);
        sub_builder = add_items_to_submenu(sub_builder, app, &sub_spec.items)?;
        let submenu = sub_builder.build().map_err(|e| e.to_string())?;
        builder = builder.item(&submenu);
    }

    let menu = builder.build().map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

fn add_items_to_submenu<'m>(
    builder: SubmenuBuilder<'m, Wry, AppHandle<Wry>>,
    app: &'m AppHandle<Wry>,
    items: &[NativeMenuItemSpec],
) -> Result<SubmenuBuilder<'m, Wry, AppHandle<Wry>>, String> {
    let mut b = builder;
    for item in items {
        b = match item {
            NativeMenuItemSpec::Separator { .. } => b.separator(),
            NativeMenuItemSpec::Item {
                id,
                label,
                accelerator,
                enabled,
            } => {
                let mut item_builder = MenuItemBuilder::with_id(id, label);
                if let Some(accel) = accelerator {
                    item_builder = item_builder.accelerator(accel);
                }
                if !enabled {
                    item_builder = item_builder.enabled(false);
                }
                let menu_item = item_builder.build(app).map_err(|e| e.to_string())?;
                b.item(&menu_item)
            }
            NativeMenuItemSpec::Check {
                id,
                label,
                accelerator,
                enabled,
                checked,
            } => {
                let mut item_builder = tauri::menu::CheckMenuItemBuilder::with_id(id, label);
                if let Some(accel) = accelerator {
                    item_builder = item_builder.accelerator(accel);
                }
                if !enabled {
                    item_builder = item_builder.enabled(false);
                }
                item_builder = item_builder.checked(*checked);
                let check_item = item_builder.build(app).map_err(|e| e.to_string())?;
                b.item(&check_item)
            }
            NativeMenuItemSpec::Submenu {
                id,
                label,
                items: children,
                ..
            } => {
                let mut sub_builder = SubmenuBuilder::with_id(app, id, label);
                sub_builder = add_items_to_submenu(sub_builder, app, children)?;
                let submenu = sub_builder.build().map_err(|e| e.to_string())?;
                b.item(&submenu)
            }
            NativeMenuItemSpec::Predefined { item_type, .. } => match item_type.as_str() {
                "about" => b.about(None),
                "quit" => b.quit(),
                "hide" => b.hide(),
                "hide_others" => b.hide_others(),
                "show_all" => b.show_all(),
                "services" => b.services(),
                "undo" => b.undo(),
                "redo" => b.redo(),
                "cut" => b.cut(),
                "copy" => b.copy(),
                "paste" => b.paste(),
                "select_all" => b.select_all(),
                "minimize" => b.minimize(),
                "maximize" => b.maximize(),
                "close_window" => b.close_window(),
                "fullscreen" => b.fullscreen(),
                "bring_all_to_front" => b.bring_all_to_front(),
                _ => b.separator(),
            },
        };
    }
    Ok(b)
}

/// Recursively find a menu item by ID in a submenu's children and apply patches.
fn apply_patch_to_kind(item: &MenuItemKind<Wry>, patch: &MenuStatePatch) -> Result<(), String> {
    if item.id().0 != patch.id {
        return match item {
            MenuItemKind::Submenu(sub) => {
                for child in sub.items().map_err(|e| e.to_string())? {
                    apply_patch_to_kind(&child, patch)?;
                }
                Ok(())
            }
            _ => Ok(()),
        };
    }

    match item {
        MenuItemKind::MenuItem(item) => {
            if let Some(enabled) = patch.enabled {
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
            if let Some(ref label) = patch.label {
                item.set_text(label).map_err(|e| e.to_string())?;
            }
        }
        MenuItemKind::Check(item) => {
            if let Some(enabled) = patch.enabled {
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
            if let Some(checked) = patch.checked {
                item.set_checked(checked).map_err(|e| e.to_string())?;
            }
            if let Some(ref label) = patch.label {
                item.set_text(label).map_err(|e| e.to_string())?;
            }
        }
        MenuItemKind::Predefined(item) => {
            if let Some(ref label) = patch.label {
                item.set_text(label).map_err(|e| e.to_string())?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Apply state patches to the current menu tree (must be set first via build_and_set_menu).
pub fn apply_menu_state_patches(
    app: &AppHandle<Wry>,
    patches: &[MenuStatePatch],
) -> Result<(), String> {
    let menu = match app.menu() {
        Some(m) => m,
        None => return Ok(()),
    };
    for item in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = item {
            for child in sub.items().map_err(|e| e.to_string())? {
                for patch in patches {
                    apply_patch_to_kind(&child, patch)?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn build_native_menu(app: AppHandle<Wry>, spec: NativeMenuSpec) -> Result<(), String> {
    build_and_set_menu(&app, &spec)?;
    Ok(())
}

#[tauri::command]
pub fn update_native_menu_state(
    app: AppHandle<Wry>,
    patches: Vec<MenuStatePatch>,
) -> Result<(), String> {
    apply_menu_state_patches(&app, &patches)
}
