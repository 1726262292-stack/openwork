import { installerConfigSourceLabel, type InstallerConfigResolution } from "./config"
import { OPENWORK_LOGO_SVG } from "./openwork-logo"
import { INSTALLER_VERSION } from "./version"

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

export function renderInstallerHtml(resolution: InstallerConfigResolution | null, token: string): string {
  const config = resolution?.config ?? null
  const logo = config?.logoUrl
    ? `<img class="logo" src="${escapeHtml(config.logoUrl)}" alt="${escapeHtml(config.clientName)}" />`
    : `<div class="logo">${OPENWORK_LOGO_SVG}</div>`
  const sourceLabel = resolution ? installerConfigSourceLabel(resolution.source) : ""
  const appName = config?.appName ?? "OpenWork"
  const configuredContent = config
    ? `
  ${logo}
  <div class="title">${escapeHtml(config.appName)} Installer</div>
  <div class="client">This sets up ${escapeHtml(config.appName)} for ${escapeHtml(config.clientName)} (${escapeHtml(config.webUrl)}).</div>
  <div class="source">Configured via ${escapeHtml(sourceLabel)}.</div>
  <div class="bar" id="bar"><div id="bar-fill"></div></div>
  <div class="buttons">
    <button class="primary" id="action">Install</button>
    <button id="exit">Exit</button>
  </div>
  <div class="activation" id="activation" hidden>
    <div class="activation-title">Browser didn&apos;t open?</div>
    <div class="activation-copy">Try again, or copy this one-time activation link into a browser on this computer.</div>
    <div class="link-row">
      <input id="activation-link" type="url" readonly aria-label="Activation link" />
      <button id="copy-activation" type="button">Copy link</button>
    </div>
    <button id="retry-activation" type="button">Try opening browser again</button>
    <div class="activation-expiry" id="activation-expiry"></div>
  </div>
  <div class="status" id="status"></div>`
    : `
  <div class="logo">${OPENWORK_LOGO_SVG}</div>
  <div class="title">Paste your install link</div>
  <div class="client">It's in the copy box on your team's install page — the tab you downloaded this from. Your organization admin can also copy it from the Members page.</div>
  <form class="paste" id="paste-form">
    <div class="link-row">
      <input id="install-link" type="url" placeholder="https://.../install?token=..." autocomplete="off" required />
      <button class="primary paste-button" id="paste-button" type="button">Paste</button>
    </div>
    <button class="primary" id="continue" type="submit">Continue</button>
  </form>
  <div class="buttons single">
    <button id="exit">Exit</button>
  </div>
  <div class="status" id="status"></div>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(appName)} Installer</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center;
    background: #ffffff; color: #18181b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-user-select: none; user-select: none;
  }
  main { display: grid; gap: 6px; justify-items: center; width: 340px; text-align: center; }
  .logo { max-height: 100px; max-width: 260px; width: auto; height: auto; object-fit: contain; margin-bottom: 10px; }
  div.logo svg { max-height: 72px; width: auto; height: 72px; }
  .title { font-size: 17px; font-weight: 600; }
  .client { font-size: 14px; color: #71717a; margin-bottom: 6px; line-height: 1.35; }
  .source { font-size: 11px; color: #a1a1aa; margin-bottom: 8px; }
  .status { font-size: 12px; color: #71717a; min-height: 30px; margin-top: 12px; }
  .status.error { color: #dc2626; }
  .status.done { color: #16a34a; font-weight: 600; }
  .bar { width: 100%; height: 4px; border-radius: 2px; background: rgba(24,24,27,.12); overflow: hidden; visibility: hidden; }
  .bar > div { height: 100%; width: 0%; background: #18181b; transition: width .2s; }
  .buttons { display: flex; gap: 10px; margin-top: 6px; }
  button {
    font: inherit; font-size: 13px; padding: 7px 22px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgba(24,24,27,.2); background: #ffffff; color: #18181b;
  }
  button.primary { background: #18181b; color: #ffffff; border-color: transparent; font-weight: 600; }
  button:disabled { opacity: .4; cursor: default; }
  .single { margin-top: 2px; }
  .paste { display: grid; gap: 10px; width: 100%; margin-top: 10px; }
  .link-row { display: flex; gap: 8px; width: 100%; }
  .link-row input { flex: 1; min-width: 0; }
  .paste-button { padding-left: 16px; padding-right: 16px; }
  input { box-sizing: border-box; width: 100%; border: 1px solid rgba(24,24,27,.16); border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 13px; }
  .activation { display: grid; gap: 8px; width: 100%; margin-top: 10px; padding: 12px; box-sizing: border-box; border: 1px solid rgba(24,24,27,.12); border-radius: 10px; background: #f7f7f8; text-align: left; }
  .activation[hidden] { display: none; }
  .activation-title { font-size: 13px; font-weight: 600; }
  .activation-copy, .activation-expiry { color: #71717a; font-size: 11px; line-height: 1.4; }
  #activation-link { background: #ffffff; color: #52525b; font-size: 10px; }
  #copy-activation, #retry-activation { padding-left: 12px; padding-right: 12px; }
  /* Pinned to the window edge so identifying the build never shifts the primary action. */
  .version { position: fixed; bottom: 6px; left: 0; right: 0; text-align: center; font-size: 10px; color: #c8c8cc; }
</style>
</head>
<body>
<main>
${configuredContent}
</main>
<div class="version">Installer ${escapeHtml(INSTALLER_VERSION)}</div>
<script>
  const TOKEN = ${JSON.stringify(token)};
  const CONFIGURED = ${config ? "true" : "false"};
  const HAS_ACTIVATION = ${resolution?.activation ? "true" : "false"};
  const statusEl = document.getElementById("status");
  const barEl = document.getElementById("bar");
  const barFillEl = document.getElementById("bar-fill");
  const actionBtn = document.getElementById("action");
  const exitBtn = document.getElementById("exit");
  const pasteForm = document.getElementById("paste-form");
  const installLinkInput = document.getElementById("install-link");
  const pasteBtn = document.getElementById("paste-button");
  const continueBtn = document.getElementById("continue");
  const activationEl = document.getElementById("activation");
  const activationLinkInput = document.getElementById("activation-link");
  const activationExpiryEl = document.getElementById("activation-expiry");
  const copyActivationBtn = document.getElementById("copy-activation");
  const retryActivationBtn = document.getElementById("retry-activation");
  let polling = null;
  let installed = false;

  async function api(path) {
    const response = await fetch(path, { method: "POST", headers: { "x-installer-token": TOKEN } });
    if (!response.ok) throw new Error("request failed: " + response.status);
    return response.json();
  }

  async function postJson(path) {
    const response = await fetch(path, { method: "POST", headers: { "x-installer-token": TOKEN } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "request failed: " + response.status);
    return payload;
  }

  function editableInput() {
    const element = document.activeElement;
    if (!element || element.tagName !== "INPUT") return null;
    if (element.disabled || element.readOnly) return null;
    return element;
  }

  function inputRange(input) {
    const length = input.value.length;
    const start = typeof input.selectionStart === "number" ? input.selectionStart : length;
    const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
    return { start, end };
  }

  function dispatchInput(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function showClipboardError() {
    statusEl.textContent = "Could not read the clipboard. Copy your install link, then click Paste again or type it here.";
    statusEl.classList.add("error");
  }

  function clearClipboardError() {
    if (CONFIGURED) return;
    statusEl.textContent = "";
    statusEl.classList.remove("error");
  }

  function setInputValue(input, text) {
    input.value = text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input);
  }

  function insertInputValue(input, text) {
    const range = inputRange(input);
    input.setRangeText(text, range.start, range.end, "end");
    input.focus();
    dispatchInput(input);
  }

  function deleteInputSelection(input) {
    const range = inputRange(input);
    if (range.start === range.end) return;
    input.setRangeText("", range.start, range.end, "start");
    input.focus();
    dispatchInput(input);
  }

  async function readClipboardText() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
    return null;
  }

  async function writeClipboardText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }

  function tryExecCommand(command) {
    try {
      return document.execCommand(command);
    } catch {
      return false;
    }
  }

  async function pasteClipboardText(input, replace) {
    input.focus();
    const text = await readClipboardText().catch(() => null);
    if (text !== null) {
      if (replace) setInputValue(input, text);
      else insertInputValue(input, text);
      clearClipboardError();
      return;
    }
    if (replace) input.select();
    if (tryExecCommand("paste")) {
      clearClipboardError();
      return;
    }
    showClipboardError();
  }

  function selectedInputText(input) {
    const range = inputRange(input);
    return range.start === range.end ? "" : input.value.slice(range.start, range.end);
  }

  async function copyInputSelection(input, cut) {
    const selectedText = selectedInputText(input);
    if (!selectedText) return;
    const wrote = await writeClipboardText(selectedText).catch(() => false);
    if (wrote) {
      if (cut) deleteInputSelection(input);
      clearClipboardError();
      return;
    }
    if (tryExecCommand(cut ? "cut" : "copy")) {
      clearClipboardError();
      return;
    }
    showClipboardError();
  }

  function showActivation(payload) {
    activationLinkInput.value = payload.activationUrl;
    activationEl.hidden = false;
    const expiry = new Date(payload.expiresAt);
    activationExpiryEl.textContent = Number.isNaN(expiry.getTime())
      ? "This link is one-time and short-lived."
      : "One-time link · expires " + expiry.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  async function copyFreshActivation() {
    const payload = await postJson("/api/activation");
    showActivation(payload);
    activationLinkInput.focus();
    activationLinkInput.select();
    const wrote = await writeClipboardText(payload.activationUrl).catch(() => false);
    if (!wrote && !tryExecCommand("copy")) {
      throw new Error("Could not copy automatically. Select the link and copy it manually.");
    }
    copyActivationBtn.textContent = "Copied";
    setTimeout(() => { copyActivationBtn.textContent = "Copy link"; }, 1800);
  }

  async function openActivation() {
    actionBtn.disabled = true;
    retryActivationBtn.disabled = true;
    statusEl.classList.remove("error");
    statusEl.textContent = "Opening the secure approval step in your browser...";
    try {
      const payload = await postJson("/api/open-activation");
      showActivation(payload);
      statusEl.textContent = payload.opened
        ? "Browser requested. Keep this installer open until OpenWork is connected."
        : "The browser did not open. Try again or copy the activation link below.";
      statusEl.classList.toggle("error", !payload.opened);
      actionBtn.textContent = "Try opening browser again";
    } catch (error) {
      statusEl.textContent = error.message || "Could not open the browser.";
      statusEl.classList.add("error");
    } finally {
      actionBtn.disabled = false;
      retryActivationBtn.disabled = false;
    }
  }

  function closeWindow() {
    if (window.openworkInstallerExit) {
      // Native webview: the bound function terminates the window run loop.
      window.openworkInstallerExit();
      return;
    }
    api("/api/exit").catch(() => {});
    window.close();
  }

  function render(status) {
    if (!CONFIGURED) return;
    const downloading = status.step === "download" && status.totalBytes;
    barEl.style.visibility = downloading ? "visible" : "hidden";
    if (downloading) barFillEl.style.width = Math.round(100 * status.downloadedBytes / status.totalBytes) + "%";
    statusEl.classList.toggle("error", status.state === "error");
    statusEl.classList.toggle("done", status.state === "done");

    if (status.state === "running") {
      statusEl.textContent = status.message;
      actionBtn.disabled = true;
      return;
    }
    if (polling) { clearInterval(polling); polling = null; }
    if (status.state === "done") {
      installed = true;
      statusEl.textContent = "Successfully Installed";
      actionBtn.textContent = HAS_ACTIVATION ? "Open this in your browser" : "Launch";
      actionBtn.disabled = false;
      return;
    }
    if (status.state === "error") {
      statusEl.textContent = status.message + " " + (status.error ?? "");
      actionBtn.textContent = "Retry";
      actionBtn.disabled = false;
    }
  }

  if (pasteForm) {
    if (pasteBtn) pasteBtn.addEventListener("click", async () => {
      pasteBtn.disabled = true;
      try {
        await pasteClipboardText(installLinkInput, true);
      } finally {
        pasteBtn.disabled = false;
      }
    });

    pasteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      continueBtn.disabled = true;
      statusEl.classList.remove("error");
      statusEl.textContent = "Checking install link...";
      try {
        const response = await fetch("/api/resolve-link", {
          method: "POST",
          headers: { "content-type": "application/json", "x-installer-token": TOKEN },
          body: JSON.stringify({ installLink: installLinkInput.value })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Install link could not be resolved.");
        window.location.reload();
      } catch (error) {
        statusEl.textContent = error.message || "Install link could not be resolved.";
        statusEl.classList.add("error");
        continueBtn.disabled = false;
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const input = editableInput();
    if (!input) return;
    const key = event.key.toLowerCase();
    if (key === "v") {
      event.preventDefault();
      void pasteClipboardText(input, false);
      return;
    }
    if (key === "c") {
      event.preventDefault();
      void copyInputSelection(input, false);
      return;
    }
    if (key === "x") {
      event.preventDefault();
      void copyInputSelection(input, true);
      return;
    }
    if (key === "a") {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  if (actionBtn) actionBtn.addEventListener("click", async () => {
    if (installed) {
      if (HAS_ACTIVATION) {
        await openActivation();
        return;
      }
      try { await api("/api/launch"); } catch {}
      closeWindow();
      return;
    }
    actionBtn.disabled = true;
    try {
      await api("/api/install");
      polling = setInterval(async () => {
        try {
          const response = await fetch("/api/status", { headers: { "x-installer-token": TOKEN } });
          render(await response.json());
        } catch {}
      }, 400);
    } catch (error) {
      statusEl.textContent = "Could not start install: " + error.message;
      statusEl.classList.add("error");
      actionBtn.disabled = false;
    }
  });

  if (copyActivationBtn) copyActivationBtn.addEventListener("click", async () => {
    copyActivationBtn.disabled = true;
    try {
      await copyFreshActivation();
    } catch (error) {
      statusEl.textContent = error.message || "Could not copy the activation link.";
      statusEl.classList.add("error");
    } finally {
      copyActivationBtn.disabled = false;
    }
  });

  if (retryActivationBtn) retryActivationBtn.addEventListener("click", openActivation);

  exitBtn.addEventListener("click", closeWindow);
</script>
</body>
</html>`
}
