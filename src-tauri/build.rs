use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn main() {
  ensure_opencode_sidecar();
  tauri_build::build();
}

fn ensure_opencode_sidecar() {
  let target = env::var("CARGO_CFG_TARGET_TRIPLE").unwrap_or_default();
  if target.is_empty() {
    return;
  }

  let manifest_dir = env::var("CARGO_MANIFEST_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("."));
  let sidecar_dir = manifest_dir.join("sidecars");

  let mut file_name = format!("opencode-{target}");
  if target.contains("windows") {
    file_name.push_str(".exe");
  }
  let dest_path = sidecar_dir.join(file_name);

  if dest_path.exists() {
    return;
  }

  let source_path = env::var("OPENCODE_BIN_PATH")
    .ok()
    .map(PathBuf::from)
    .filter(|path| path.is_file())
    .or_else(|| find_in_path(if target.contains("windows") { "opencode.exe" } else { "opencode" }));

  let Some(source_path) = source_path else {
    println!(
      "cargo:warning=OpenCode sidecar missing at {} (set OPENCODE_BIN_PATH or install OpenCode)",
      dest_path.display()
    );
    return;
  };

  if fs::create_dir_all(&sidecar_dir).is_err() {
    return;
  }

  if fs::copy(&source_path, &dest_path).is_err() {
    return;
  }

  #[cfg(unix)]
  {
    let _ = fs::set_permissions(&dest_path, fs::Permissions::from_mode(0o755));
  }
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
  let paths = env::var_os("PATH")?;
  env::split_paths(&paths).find_map(|dir| {
    let candidate = dir.join(binary);
    if candidate.is_file() {
      Some(candidate)
    } else {
      None
    }
  })
}
