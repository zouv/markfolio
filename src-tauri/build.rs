fn main() {
    tauri_build::build();
    // Tauri links its Common Controls v6 manifest only into application binaries.
    // Unit-test executables also need it for dependencies using TaskDialogIndirect.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = std::env::var("OUT_DIR").expect("Cargo output directory");
        println!("cargo:rustc-link-arg-tests={out}/resource.lib");
    }
}
