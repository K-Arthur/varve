use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct OutputDirectory(PathBuf);

impl Drop for OutputDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn compile_layout_assertions(bindings: &str) {
    let path = std::env::temp_dir().join(format!(
        "varve-bindgen-layout-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    let output_directory = OutputDirectory(path);
    let mut rustc = Command::new("rustc")
        .args([
            "--crate-type=lib",
            "--edition=2021",
            "--crate-name=layout_probe",
            "-",
        ])
        .arg("--out-dir")
        .arg(&output_directory.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    rustc
        .stdin
        .take()
        .unwrap()
        .write_all(bindings.as_bytes())
        .unwrap();
    let output = rustc.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "generated layout assertions must compile: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn c_forward_declaration_resolves_to_its_full_definition() {
    let bindings = bindgen::Builder::default()
        .header_contents(
            "forward.h",
            "typedef struct Forward Forward; struct Forward { int count; void *next; };",
        )
        .generate()
        .unwrap()
        .to_string();
    assert!(bindings.contains("pub count:"));
    assert!(bindings.contains("pub next:"));
    compile_layout_assertions(&bindings);
}

#[test]
fn upstream_nested_cpp_class_keeps_its_field_and_layout() {
    let bindings = bindgen::Builder::default()
        .header_contents("nested.hpp", "class A { class I; }; class A::I { int i; };")
        .clang_args(["-x", "c++", "-std=c++14"])
        .generate()
        .unwrap()
        .to_string();
    assert!(bindings.contains("pub struct A_I"));
    assert!(bindings.contains("pub i:"));
    compile_layout_assertions(&bindings);
}

#[cfg(target_os = "linux")]
#[test]
fn libc_file_definition_matches_the_real_native_layout() {
    let bindings = bindgen::Builder::default()
        .header_contents("stdio.h", "#include <stdio.h>")
        .allowlist_type("FILE")
        .generate()
        .unwrap()
        .to_string();
    assert!(bindings.contains("pub struct _IO_FILE"));
    assert!(bindings.contains("pub _flags:"));
    compile_layout_assertions(&bindings);
}
