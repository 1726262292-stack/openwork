export const TOY_UI_CSS = `:root {
  --bg: #0b1020;
  --panel: rgba(255, 255, 255, 0.06);
  --panel-2: rgba(255, 255, 255, 0.04);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.68);
  --muted-2: rgba(255, 255, 255, 0.5);
  --border: rgba(255, 255, 255, 0.12);
  --accent: #53b8ff;
  --danger: #ff5b5b;
  --ok: #51d69c;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--sans);
  background: radial-gradient(1200px 900px at 20% 10%, rgba(83, 184, 255, 0.14), transparent 60%),
    radial-gradient(900px 700px at 80% 0%, rgba(81, 214, 156, 0.1), transparent 55%),
    linear-gradient(180deg, #080b16, var(--bg));
  color: var(--text);
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.2px;
}

.title .sub {
  color: var(--muted);
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 14px;
}

@media (max-width: 940px) {
  .grid { grid-template-columns: 1fr; }
}

.card {
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.card h2 {
  margin: 0;
  padding: 12px 14px;
  font-size: 13px;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.88);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card .body {
  padding: 12px 14px;
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--muted);
}

.pill.ok { border-color: rgba(81, 214, 156, 0.45); color: rgba(81, 214, 156, 0.95); }
.pill.bad { border-color: rgba(255, 91, 91, 0.45); color: rgba(255, 91, 91, 0.92); }

.muted { color: var(--muted); }
.mono { font-family: var(--mono); }

.chat {
  height: 56vh;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}

.chatlog {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 10px;
  background: rgba(0, 0, 0, 0.14);
}

.msg .meta {
  font-size: 11px;
  color: var(--muted-2);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.msg .content {
  white-space: pre-wrap;
  line-height: 1.35;
  font-size: 13px;
}

.composer {
  border-top: 1px solid var(--border);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.composer textarea {
  width: 100%;
  resize: vertical;
  min-height: 80px;
  max-height: 220px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  outline: none;
  font-family: var(--sans);
  font-size: 13px;
}

.composer textarea:focus { border-color: rgba(83, 184, 255, 0.45); }

.btn {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.btn:hover { border-color: rgba(83, 184, 255, 0.4); }
.btn.primary { border-color: rgba(83, 184, 255, 0.6); background: rgba(83, 184, 255, 0.12); }
.btn.danger { border-color: rgba(255, 91, 91, 0.6); background: rgba(255, 91, 91, 0.08); }

.kv {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 10px;
  font-size: 12px;
}

.kv .k { color: var(--muted-2); }

.codebox {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.18);
  font-family: var(--mono);
  font-size: 11px;
  white-space: pre-wrap;
  line-height: 1.3;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.14);
}

.item .row { justify-content: space-between; }

.small { font-size: 11px; color: var(--muted-2); }

.hr { height: 1px; background: var(--border); margin: 10px 0; }
`;

export const TOY_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenWork Toy UI</title>
    <link rel="stylesheet" href="/ui/assets/toy.css" />
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div class="title">
          <h1>OpenWork Toy UI</h1>
          <div class="sub">Local-first host contract harness (served by openwork-server)</div>
        </div>
        <div class="row">
          <span class="pill" id="pill-conn">disconnected</span>
          <span class="pill" id="pill-scope">scope: unknown</span>
        </div>
      </div>

      <div class="grid">
        <div class="card chat">
          <h2>
            <span>Session</span>
            <span class="small mono" id="session-id">session: -</span>
          </h2>
          <div class="chatlog" id="chatlog"></div>
          <div class="composer">
            <div class="row">
              <button class="btn" id="btn-new">New session</button>
              <button class="btn" id="btn-refresh">Refresh messages</button>
              <span class="small" id="hint">Tip: open this page as /w/&lt;id&gt;/ui#token=&lt;token&gt;</span>
            </div>
            <textarea id="prompt" placeholder="Write a prompt..." spellcheck="false"></textarea>
            <div class="row">
              <button class="btn primary" id="btn-send">Send prompt</button>
              <button class="btn" id="btn-events">Connect SSE</button>
              <button class="btn" id="btn-events-stop">Stop SSE</button>
              <span class="small" id="status"></span>
            </div>
          </div>
        </div>

        <div class="card">
          <h2><span>Host</span><span class="small mono" id="host-id">-</span></h2>
          <div class="body">
            <div class="kv">
              <div class="k">workspace</div>
              <div class="mono" id="workspace-id">-</div>
              <div class="k">server</div>
              <div class="mono" id="server-version">-</div>
              <div class="k">sandbox</div>
              <div class="mono" id="sandbox">-</div>
              <div class="k">file injection</div>
              <div class="mono" id="file-injection">-</div>
            </div>

            <div class="hr"></div>

            <div class="row">
              <input id="file" type="file" />
              <button class="btn" id="btn-upload">Upload to inbox</button>
            </div>
            <div class="small">Uploads go to <span class="mono">.opencode/openwork/inbox/</span> inside the workspace.</div>

            <div class="hr"></div>

            <div class="row">
              <button class="btn" id="btn-artifacts">List artifacts</button>
              <span class="small">Downloads read from <span class="mono">.opencode/openwork/outbox/</span>.</span>
            </div>
            <div class="list" id="artifacts"></div>

            <div class="hr"></div>

            <div class="row">
              <button class="btn" id="btn-approvals">Refresh approvals</button>
              <span class="small">(Owner or host token required)</span>
            </div>
            <div class="list" id="approvals"></div>

            <div class="hr"></div>

            <div class="row">
              <button class="btn" id="btn-share">Show connect artifact</button>
              <button class="btn" id="btn-copy">Copy JSON</button>
            </div>
            <div class="codebox" id="connect"></div>
          </div>
        </div>
      </div>
    </div>

    <script type="module" src="/ui/assets/toy.js"></script>
  </body>
</html>
`;

export const TOY_UI_JS = String.raw`const qs = (sel) => document.querySelector(sel);

const pillConn = qs("#pill-conn");
const pillScope = qs("#pill-scope");
const chatlog = qs("#chatlog");
const promptEl = qs("#prompt");
const statusEl = qs("#status");
const sessionIdEl = qs("#session-id");
const workspaceIdEl = qs("#workspace-id");
const serverVersionEl = qs("#server-version");
const sandboxEl = qs("#sandbox");
const fileInjectionEl = qs("#file-injection");
const artifactsEl = qs("#artifacts");
const approvalsEl = qs("#approvals");
const connectEl = qs("#connect");
const hostIdEl = qs("#host-id");

const STORAGE_TOKEN = "openwork.toy.token";
const STORAGE_SESSION_PREFIX = "openwork.toy.session.";

function setPill(el, label, kind) {
  el.textContent = label;
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

function getTokenFromHash() {
  const raw = (location.hash || "").startsWith("#") ? (location.hash || "").slice(1) : (location.hash || "");
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  return (params.get("token") || "").trim();
}

function stripHashToken() {
  const raw = (location.hash || "").startsWith("#") ? (location.hash || "").slice(1) : (location.hash || "");
  if (!raw) return;
  const params = new URLSearchParams(raw);
  if (!params.has("token")) return;
  params.delete("token");
  const next = params.toString();
  const url = location.pathname + location.search + (next ? "#" + next : "");
  history.replaceState(null, "", url);
}

function readToken() {
  const fromHash = getTokenFromHash();
  if (fromHash) {
    try { localStorage.setItem(STORAGE_TOKEN, fromHash); } catch {}
    stripHashToken();
    return fromHash;
  }
  try {
    return (localStorage.getItem(STORAGE_TOKEN) || "").trim();
  } catch {
    return "";
  }
}

function parseWorkspaceIdFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const wIndex = parts.indexOf("w");
  if (wIndex !== -1 && parts[wIndex + 1]) return decodeURIComponent(parts[wIndex + 1]);
  return "";
}

async function apiFetch(path, options) {
  const token = readToken();
  const opts = options || {};
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", "Bearer " + token);
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json && json.message ? json.message : (text || res.statusText);
    const code = json && json.code ? json.code : "request_failed";
    const err = new Error(code + ": " + msg);
    err.status = res.status;
    err.code = code;
    err.details = json && json.details ? json.details : undefined;
    throw err;
  }
  return json;
}

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.style.color = kind === "bad" ? "var(--danger)" : kind === "ok" ? "var(--ok)" : "var(--muted)";
}

function appendMsg(role, text) {
  const el = document.createElement("div");
  el.className = "msg";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = role;
  const content = document.createElement("div");
  content.className = "content";
  content.textContent = text;
  el.appendChild(meta);
  el.appendChild(content);
  chatlog.appendChild(el);
  chatlog.scrollTop = chatlog.scrollHeight;
}

function renderMessages(items) {
  chatlog.innerHTML = "";
  if (!Array.isArray(items) || !items.length) {
    appendMsg("system", "No messages yet.");
    return;
  }
  for (const msg of items) {
    const info = msg && msg.info ? msg.info : null;
    const parts = Array.isArray(msg && msg.parts) ? msg.parts : [];
    const role = info && info.role ? info.role : "message";
    const textParts = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text);
    const body = textParts.length ? textParts.join("\n") : JSON.stringify(parts, null, 2);
    appendMsg(role, body);
  }
}

function sessionKey(workspaceId) {
  return STORAGE_SESSION_PREFIX + workspaceId;
}

function readSessionId(workspaceId) {
  try { return (localStorage.getItem(sessionKey(workspaceId)) || "").trim(); } catch { return ""; }
}

function writeSessionId(workspaceId, sessionId) {
  try { localStorage.setItem(sessionKey(workspaceId), sessionId); } catch {}
}

async function resolveDefaultModel(workspaceId) {
  try {
    const providers = await apiFetch("/w/" + encodeURIComponent(workspaceId) + "/opencode/config/providers");
    const def = providers && providers.default ? providers.default : null;
    if (def && typeof def === "object") {
      const entries = Object.entries(def);
      if (entries.length) {
        const providerID = entries[0][0];
        const modelID = entries[0][1];
        if (providerID && modelID) return { providerID, modelID };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function ensureSession(workspaceId) {
  const existing = readSessionId(workspaceId);
  if (existing) return existing;
  const created = await apiFetch("/w/" + encodeURIComponent(workspaceId) + "/opencode/session", {
    method: "POST",
    body: JSON.stringify({ title: "OpenWork Toy UI" }),
  });
  const id = created && created.id ? String(created.id) : "";
  if (!id) throw new Error("session_create_failed");
  writeSessionId(workspaceId, id);
  return id;
}

async function refreshHost(workspaceId) {
  const token = readToken();
  if (!token) {
    setPill(pillConn, "token missing", "bad");
    setStatus("Add #token=... to the URL fragment", "bad");
    return;
  }
  try {
    const status = await apiFetch("/status");
    const caps = await apiFetch("/capabilities");
    hostIdEl.textContent = location.origin;
    serverVersionEl.textContent = caps && caps.serverVersion ? caps.serverVersion : (status && status.version ? status.version : "-");
    const sandbox = caps && caps.sandbox ? caps.sandbox : null;
    sandboxEl.textContent = sandbox ? (sandbox.backend + " (" + (sandbox.enabled ? "on" : "off") + ")") : "-";
    const files = caps && caps.toolProviders && caps.toolProviders.files ? caps.toolProviders.files : null;
    fileInjectionEl.textContent = files ? ((files.injection ? "upload" : "no upload") + " / " + (files.outbox ? "download" : "no download")) : "-";
    workspaceIdEl.textContent = workspaceId || "-";
    setPill(pillConn, "connected", "ok");
    setStatus("Connected", "ok");

    try {
      const me = await apiFetch("/whoami");
      const scope = me && me.actor && me.actor.scope ? me.actor.scope : "unknown";
      pillScope.textContent = "scope: " + scope;
    } catch {
      pillScope.textContent = "scope: unknown";
    }
  } catch (e) {
    setPill(pillConn, "disconnected", "bad");
    setStatus(e && e.message ? e.message : "Disconnected", "bad");
  }
}

async function refreshMessages(workspaceId) {
  const sessionId = readSessionId(workspaceId);
  sessionIdEl.textContent = sessionId ? ("session: " + sessionId) : "session: -";
  if (!sessionId) {
    renderMessages([]);
    return;
  }
  const url = "/w/" + encodeURIComponent(workspaceId) + "/opencode/session/" + encodeURIComponent(sessionId) + "/message?limit=50";
  const msgs = await apiFetch(url);
  renderMessages(msgs);
}

async function listArtifacts(workspaceId) {
  const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/artifacts");
  const items = Array.isArray(data && data.items) ? data.items : [];
  artifactsEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No artifacts found.";
    artifactsEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const top = document.createElement("div");
    top.className = "row";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "mono";
    name.textContent = item.path;
    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = String(item.size) + " bytes";
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Download";
    btn.onclick = async () => {
      try {
        const res = await fetch(
          "/workspace/" + encodeURIComponent(workspaceId) + "/artifacts/" + encodeURIComponent(item.id),
          { headers: { Authorization: "Bearer " + readToken() } },
        );
        if (!res.ok) throw new Error("download_failed: " + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const parts = String(item.path || "artifact").split("/");
        a.download = parts.length ? parts[parts.length - 1] : "artifact";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setStatus(e && e.message ? e.message : "Download failed", "bad");
      }
    };

    top.appendChild(left);
    top.appendChild(btn);
    row.appendChild(top);
    artifactsEl.appendChild(row);
  }
}

async function refreshApprovals() {
  approvalsEl.innerHTML = "";
  try {
    const data = await apiFetch("/approvals");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No pending approvals.";
      approvalsEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";

      const top = document.createElement("div");
      top.className = "row";

      const left = document.createElement("div");
      const action = document.createElement("div");
      action.className = "mono";
      action.textContent = item.action;
      const summary = document.createElement("div");
      summary.className = "small";
      summary.textContent = item.summary;
      left.appendChild(action);
      left.appendChild(summary);

      const buttons = document.createElement("div");
      buttons.className = "row";

      const allow = document.createElement("button");
      allow.className = "btn primary";
      allow.textContent = "Allow";

      const deny = document.createElement("button");
      deny.className = "btn danger";
      deny.textContent = "Deny";

      allow.onclick = async () => {
        await apiFetch("/approvals/" + encodeURIComponent(item.id), {
          method: "POST",
          body: JSON.stringify({ reply: "allow" }),
        });
        await refreshApprovals();
      };

      deny.onclick = async () => {
        await apiFetch("/approvals/" + encodeURIComponent(item.id), {
          method: "POST",
          body: JSON.stringify({ reply: "deny" }),
        });
        await refreshApprovals();
      };

      buttons.appendChild(allow);
      buttons.appendChild(deny);

      top.appendChild(left);
      top.appendChild(buttons);
      row.appendChild(top);
      approvalsEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "Approvals unavailable";
    approvalsEl.appendChild(warn);
  }
}

let eventsAbort = null;

async function connectSse(workspaceId) {
  if (eventsAbort) return;
  const controller = new AbortController();
  eventsAbort = controller;
  setStatus("Connecting SSE...", "");

  const url = "/w/" + encodeURIComponent(workspaceId) + "/opencode/event";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + readToken() },
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    eventsAbort = null;
    throw new Error("sse_failed: " + res.status);
  }

  setStatus("SSE connected", "ok");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  const pump = async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const rest = line.slice(5);
            dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
          }
        }
        if (!dataLines.length) continue;
        const raw = dataLines.join("\n");
        try {
          const event = JSON.parse(raw);
          const payload = event && event.payload ? event.payload : event;
          if (payload && payload.type === "message.part.updated") {
            void refreshMessages(workspaceId);
          }
        } catch {
          // ignore
        }
      }
    }
  };

  pump()
    .catch(() => undefined)
    .finally(() => {
      eventsAbort = null;
      try { reader.releaseLock(); } catch {}
      setStatus("SSE disconnected", "");
    });
}

function stopSse() {
  if (!eventsAbort) return;
  eventsAbort.abort();
  eventsAbort = null;
}

async function showConnectArtifact(workspaceId) {
  const token = readToken();
  let scope = "collaborator";
  try {
    const me = await apiFetch("/whoami");
    const s = me && me.actor && me.actor.scope ? me.actor.scope : "";
    if (s) scope = s;
  } catch {
    // ignore
  }

  const hostUrl = location.origin;
  const workspaceUrl = hostUrl + "/w/" + encodeURIComponent(workspaceId);
  const payload = {
    kind: "openwork.connect.v1",
    hostUrl: hostUrl,
    workspaceId: workspaceId,
    workspaceUrl: workspaceUrl,
    token: token,
    tokenScope: scope,
    createdAt: Date.now(),
  };
  connectEl.textContent = JSON.stringify(payload, null, 2);
}

async function copyConnectArtifact() {
  const text = connectEl.textContent || "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied", "ok");
  } catch {
    setStatus("Clipboard unavailable", "bad");
  }
}

async function main() {
  const workspaceId = parseWorkspaceIdFromPath();
  if (!workspaceId) {
    const token = readToken();
    if (!token) {
      appendMsg("system", "Open this as /ui#token=<token> or /w/<workspaceId>/ui#token=<token>");
      return;
    }
    try {
      const workspaces = await apiFetch("/workspaces");
      const active = (workspaces && workspaces.activeId) || (workspaces && workspaces.items && workspaces.items[0] && workspaces.items[0].id) || "";
      if (active) {
        location.href = "/w/" + encodeURIComponent(active) + "/ui";
        return;
      }
    } catch {
      // ignore
    }
    appendMsg("system", "No workspace configured.");
    return;
  }

  await refreshHost(workspaceId);
  sessionIdEl.textContent = readSessionId(workspaceId) ? ("session: " + readSessionId(workspaceId)) : "session: -";
  await refreshMessages(workspaceId).catch(() => undefined);

  qs("#btn-new").onclick = async () => {
    try {
      writeSessionId(workspaceId, "");
      const id = await ensureSession(workspaceId);
      sessionIdEl.textContent = "session: " + id;
      await refreshMessages(workspaceId);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Failed to create session", "bad");
    }
  };

  qs("#btn-refresh").onclick = async () => {
    await refreshMessages(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "refresh failed", "bad"));
  };

  qs("#btn-send").onclick = async () => {
    const text = (promptEl.value || "").trim();
    if (!text) return;
    appendMsg("user", text);
    promptEl.value = "";
    try {
      const sessionId = await ensureSession(workspaceId);
      sessionIdEl.textContent = "session: " + sessionId;
      const model = await resolveDefaultModel(workspaceId);
      const body = { parts: [{ type: "text", text: text }] };
      if (model) body.model = model;
      await apiFetch(
        "/w/" + encodeURIComponent(workspaceId) + "/opencode/session/" + encodeURIComponent(sessionId) + "/prompt_async",
        { method: "POST", body: JSON.stringify(body) },
      );
      setStatus("Prompt accepted", "ok");
      await refreshMessages(workspaceId).catch(() => undefined);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Prompt failed", "bad");
    }
  };

  qs("#btn-events").onclick = async () => {
    try {
      await connectSse(workspaceId);
    } catch (e) {
      setStatus(e && e.message ? e.message : "SSE failed", "bad");
    }
  };

  qs("#btn-events-stop").onclick = () => stopSse();

  qs("#btn-upload").onclick = async () => {
    const input = qs("#file");
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (!file) {
      setStatus("Pick a file first", "bad");
      return;
    }
    try {
      const form = new FormData();
      form.set("file", file);
      await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/inbox", { method: "POST", body: form });
      setStatus("Uploaded", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "Upload failed", "bad");
    }
  };

  qs("#btn-artifacts").onclick = async () => {
    await listArtifacts(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "artifacts failed", "bad"));
  };

  qs("#btn-approvals").onclick = async () => {
    await refreshApprovals().catch(() => undefined);
  };

  qs("#btn-share").onclick = async () => {
    await showConnectArtifact(workspaceId).catch(() => undefined);
  };

  qs("#btn-copy").onclick = async () => {
    await copyConnectArtifact();
  };
}

main().catch((e) => {
  setStatus(e && e.message ? e.message : "Startup failed", "bad");
});
`;

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function cssResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function jsResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
