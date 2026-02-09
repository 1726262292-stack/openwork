use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::State;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

use crate::openwrk::manager::OpenwrkManager;
use crate::openwrk::{resolve_openwrk_data_dir, resolve_openwrk_status};
use crate::types::{OpenwrkStatus, OpenwrkWorkspace};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenwrkDetachedHost {
    pub openwork_url: String,
    pub token: String,
    pub host_token: String,
    pub port: u16,
}

fn allocate_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to allocate free port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    Ok(port)
}

fn wait_for_openwork_health(openwork_url: &str, timeout_ms: u64) -> Result<(), String> {
    let start = Instant::now();
    let mut last_error: Option<String> = None;
    while start.elapsed() < Duration::from_millis(timeout_ms) {
        match ureq::get(&format!("{}/health", openwork_url.trim_end_matches('/'))).call() {
            Ok(response) if response.status() >= 200 && response.status() < 300 => return Ok(()),
            Ok(response) => last_error = Some(format!("HTTP {}", response.status())),
            Err(err) => last_error = Some(err.to_string()),
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(last_error.unwrap_or_else(|| "Timed out waiting for OpenWork server".to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenwrkWorkspaceResponse {
    pub workspace: OpenwrkWorkspace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenwrkDisposeResponse {
    pub disposed: bool,
}

fn resolve_data_dir(manager: &OpenwrkManager) -> String {
    manager
        .inner
        .lock()
        .ok()
        .and_then(|state| state.data_dir.clone())
        .unwrap_or_else(resolve_openwrk_data_dir)
}

fn resolve_base_url(manager: &OpenwrkManager) -> Result<String, String> {
    let data_dir = resolve_data_dir(manager);
    let status = resolve_openwrk_status(&data_dir, None);
    status
        .daemon
        .map(|daemon| daemon.base_url)
        .ok_or_else(|| "openwrk daemon is not running".to_string())
}

#[tauri::command]
pub fn openwrk_status(manager: State<OpenwrkManager>) -> OpenwrkStatus {
    let data_dir = resolve_data_dir(&manager);
    let last_error = manager
        .inner
        .lock()
        .ok()
        .and_then(|state| state.last_stderr.clone());
    resolve_openwrk_status(&data_dir, last_error)
}

#[tauri::command]
pub fn openwrk_workspace_activate(
    manager: State<OpenwrkManager>,
    workspace_path: String,
    name: Option<String>,
) -> Result<OpenwrkWorkspace, String> {
    let base_url = resolve_base_url(&manager)?;
    let add_url = format!("{}/workspaces", base_url.trim_end_matches('/'));
    let payload = json!({
        "path": workspace_path,
        "name": name,
    });

    let add_response = ureq::post(&add_url)
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("Failed to add workspace: {e}"))?;
    let added: OpenwrkWorkspaceResponse = add_response
        .into_json()
        .map_err(|e| format!("Failed to parse openwrk response: {e}"))?;

    let id = added.workspace.id.clone();
    let activate_url = format!(
        "{}/workspaces/{}/activate",
        base_url.trim_end_matches('/'),
        id
    );
    ureq::post(&activate_url)
        .set("Content-Type", "application/json")
        .send_string("")
        .map_err(|e| format!("Failed to activate workspace: {e}"))?;

    let path_url = format!("{}/workspaces/{}/path", base_url.trim_end_matches('/'), id);
    let _ = ureq::get(&path_url).call();

    Ok(added.workspace)
}

#[tauri::command]
pub fn openwrk_instance_dispose(
    manager: State<OpenwrkManager>,
    workspace_path: String,
) -> Result<bool, String> {
    let base_url = resolve_base_url(&manager)?;
    let add_url = format!("{}/workspaces", base_url.trim_end_matches('/'));
    let payload = json!({
        "path": workspace_path,
    });

    let add_response = ureq::post(&add_url)
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("Failed to ensure workspace: {e}"))?;
    let added: OpenwrkWorkspaceResponse = add_response
        .into_json()
        .map_err(|e| format!("Failed to parse openwrk response: {e}"))?;

    let id = added.workspace.id;
    let dispose_url = format!(
        "{}/instances/{}/dispose",
        base_url.trim_end_matches('/'),
        id
    );
    let response = ureq::post(&dispose_url)
        .set("Content-Type", "application/json")
        .send_string("")
        .map_err(|e| format!("Failed to dispose instance: {e}"))?;
    let result: OpenwrkDisposeResponse = response
        .into_json()
        .map_err(|e| format!("Failed to parse openwrk response: {e}"))?;

    Ok(result.disposed)
}

#[tauri::command]
pub fn openwrk_start_detached(
    app: AppHandle,
    workspace_path: String,
) -> Result<OpenwrkDetachedHost, String> {
    let workspace_path = workspace_path.trim().to_string();
    if workspace_path.is_empty() {
        return Err("workspacePath is required".to_string());
    }

    let port = allocate_free_port()?;
    let token = Uuid::new_v4().to_string();
    let host_token = Uuid::new_v4().to_string();
    let openwork_url = format!("http://127.0.0.1:{port}");

    let command = match app.shell().sidecar("openwrk") {
        Ok(command) => command,
        Err(_) => app.shell().command("openwrk"),
    };

    // Start a dedicated host stack for this workspace.
    // We pass explicit tokens and a free port so the UI can connect deterministically.
    command
        .args([
            "start",
            "--workspace",
            &workspace_path,
            "--approval",
            "auto",
            "--no-opencode-auth",
            "--owpenbot",
            "true",
            "--detach",
            "--openwork-host",
            "0.0.0.0",
            "--openwork-port",
            &port.to_string(),
            "--openwork-token",
            &token,
            "--openwork-host-token",
            &host_token,
        ])
        .spawn()
        .map_err(|e| format!("Failed to start openwrk: {e}"))?;

    wait_for_openwork_health(&openwork_url, 12_000)?;

    Ok(OpenwrkDetachedHost {
        openwork_url,
        token,
        host_token,
        port,
    })
}
