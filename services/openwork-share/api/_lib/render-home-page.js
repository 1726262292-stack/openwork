import { DEFAULT_PUBLIC_BASE_URL, OPENWORK_DOWNLOAD_URL, OPENWORK_SITE_URL, SHARE_EASE, buildOgImageUrl, buildRootUrl, escapeHtml } from "./share-utils.js";

export function renderHomePage(req) {
  const canonicalUrl = buildRootUrl(req) || DEFAULT_PUBLIC_BASE_URL;
  const ogImageUrl = buildOgImageUrl(req, "root");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Package Your Worker - OpenWork Share</title>
  <meta name="description" content="Drag and drop skills, agents, commands, or MCP configs here to create beautiful shareable links." />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Package Your Worker" />
  <meta property="og:description" content="Drop skills, agents, commands, or MCP configs into OpenWork Share to create beautiful shareable links." />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Package Your Worker" />
  <meta name="twitter:description" content="Drop skills, agents, commands, or MCP configs into OpenWork Share to create beautiful shareable links." />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  <style>
    @font-face {
      font-family: "FK Raster Roman Compact Smooth";
      src: url("https://openwork.software/fonts/FKRasterRomanCompact-Smooth.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      color-scheme: light;
      --ow-bg: #f6f9fc;
      --ow-ink: #011627;
      --ow-muted: #5f6b7a;
      --ow-card: #ffffff;
      --ow-border: rgba(148, 163, 184, 0.16);
      --ow-shadow: 0 20px 60px -24px rgba(15, 23, 42, 0.18);
      --ow-primary: #011627;
      --ow-ease: ${SHARE_EASE};
      --ow-sans: Inter, "Segoe UI", "Helvetica Neue", sans-serif;
      --ow-accent: "FK Raster Roman Compact Smooth", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: var(--ow-sans);
      color: var(--ow-ink);
      background-color: var(--ow-bg);
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Landing Page Slate Mesh Background */
    body::after {
      content: "";
      position: absolute;
      top: 0;
      right: 0;
      width: 60vw;
      height: 80vh;
      background: radial-gradient(circle at 70% 30%, rgba(100, 116, 139, 0.25) 0%, transparent 60%);
      filter: blur(60px);
      z-index: 0;
      pointer-events: none;
    }

    a { color: inherit; }

    .shell {
      position: relative;
      z-index: 10;
      width: min(100%, 1024px);
      margin: 0 auto;
      padding: 8px 32px 64px;
    }

    /* Navigation */
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 80px;
      margin-bottom: 40px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 20px;
      letter-spacing: -0.02em;
      color: var(--ow-ink);
    }

    .brand-mark {
      width: 24px;
      height: 24px;
      background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="%23011627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') no-repeat center center;
    }

    .nav-links {
      display: none;
    }
    
    @media (min-width: 768px) {
      .nav-links {
        display: flex;
        gap: 32px;
        font-size: 15px;
        color: var(--ow-muted);
        font-weight: 500;
      }
      .nav-links a {
        text-decoration: none;
        transition: color 0.2s;
      }
      .nav-links a:hover {
        color: var(--ow-ink);
      }
    }

    .nav-actions { display: flex; align-items: center; gap: 12px; }

    /* Buttons */
    .button-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 24px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      color: #fff;
      background: var(--ow-primary);
      box-shadow: 0 14px 32px -16px rgba(1, 22, 39, 0.55);
      font-family: inherit;
      font-weight: 500;
      font-size: 16px;
      transition: all 300ms var(--ow-ease);
      will-change: transform, background-color, box-shadow;
    }

    .button-primary:hover {
      background: rgb(110, 110, 110);
      transform: translateY(-1px);
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.04) 0px 1px 2px 0px,
        rgba(0, 0, 0, 0.04) 0px 2px 4px 0px;
    }
    
    .button-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      background: var(--ow-primary);
      box-shadow: 0 14px 32px -16px rgba(1, 22, 39, 0.55);
    }

    .button-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 24px;
      border-radius: 999px;
      text-decoration: none;
      background: rgb(255, 255, 255);
      color: rgb(0, 0, 0);
      border: none;
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.04) 0px 1px 2px 0px;
      font-family: inherit;
      font-weight: 500;
      font-size: 16px;
      transition: all 300ms var(--ow-ease);
      cursor: pointer;
      will-change: transform, background-color, box-shadow;
    }

    .button-secondary:hover {
      background: rgb(242, 242, 242);
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.04) 0px 1px 2px 0px,
        rgba(0, 0, 0, 0.04) 0px 2px 4px 0px;
    }

    /* Layout */
    .hero-layout {
      display: flex;
      flex-direction: column;
      gap: 64px;
    }
    @media (min-width: 1024px) {
      .hero-layout {
        flex-direction: row;
        align-items: center;
      }
    }

    /* Left Column: Hero Copy */
    .hero-copy {
      flex: 1.1;
      max-width: 600px;
    }

    h1 {
      margin: 0 0 24px 0;
      font-size: clamp(3rem, 5.5vw, 4.5rem);
      line-height: 1.1;
      letter-spacing: -0.04em;
      font-weight: 500;
      color: var(--ow-ink);
    }

    h1 em {
      font-style: normal;
      font-family: var(--ow-accent);
      font-weight: 400;
      font-size: 1.05em;
      display: inline-block;
      vertical-align: baseline;
    }

    .hero-body {
      margin: 0 0 32px 0;
      font-size: 20px;
      line-height: 1.6;
      color: #374151; /* gray-700 */
      max-width: 500px;
    }

    .hero-artifact {
      flex: 1;
      width: 100%;
      max-width: 560px;
    }

    .simple-app {
      display: grid;
      gap: 16px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.72);
      border-radius: 28px;
      box-shadow: 0 24px 60px -28px rgba(15, 23, 42, 0.18);
    }

    .simple-app-header {
      display: grid;
      gap: 6px;
    }

    .simple-app-title {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
      letter-spacing: -0.03em;
    }

    .simple-app-copy {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
      color: var(--ow-muted);
    }

    .paste-panel {
      display: grid;
      gap: 12px;
    }

    .paste-panel textarea {
      width: 100%;
      min-height: 180px;
      resize: vertical;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 16px;
      padding: 14px 16px;
      font: inherit;
      color: var(--ow-ink);
      background: rgba(255, 255, 255, 0.96);
    }

    .paste-panel textarea:focus {
      outline: 2px solid rgba(36, 99, 235, 0.18);
      outline-offset: 2px;
      border-color: rgba(36, 99, 235, 0.34);
    }

    .paste-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      color: var(--ow-muted);
    }

    .paste-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .drop-zone {
      border: 1px dashed rgba(148, 163, 184, 0.4);
      border-radius: 20px;
      padding: 32px 24px;
      text-align: center;
      background: #fafafa;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .drop-zone:hover, .drop-zone.is-dragover {
      border-color: rgba(37, 99, 235, 0.4);
      background: #f0f7ff;
    }
    .drop-zone[aria-busy="true"] { cursor: progress; opacity: 0.7; }

    .drop-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #3b82f6;
    }
    .drop-icon svg { width: 24px; height: 24px; }

    .drop-text h3 { margin: 0 0 8px 0; font-size: 18px; font-weight: 500; color: var(--ow-ink); }
    .drop-text p { margin: 0; font-size: 14px; color: var(--ow-muted); line-height: 1.5; }

    /* Included Items list */
    .included-section {
      margin-top: 24px;
      text-align: left;
      width: 100%;
    }
    .included-section h4 {
      margin: 0 0 12px 0;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ow-muted);
    }
    .included-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .included-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.15);
      border-radius: 12px;
    }
    .item-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .item-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }
    /* Agent solid colors matching landing */
    .dot-agent { background: #f97316; }
    .dot-skill { background: #2463eb; }
    .dot-mcp { background: #0f9f7f; }
    .dot-command { background: #8b5cf6; }

    .item-title { font-size: 14px; font-weight: 500; color: var(--ow-ink); }
    .item-meta { font-size: 12px; color: var(--ow-muted); }
    
    .status-area {
      margin-top: 20px;
      font-size: 13px;
      color: var(--ow-muted);
      text-align: center;
    }

    /* Results layout */
    .results-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin-top: 64px;
    }
    @media (min-width: 768px) {
      .results-grid { grid-template-columns: 1fr 1fr; }
    }

    .result-card {
      background: #ffffff;
      border: 1px solid var(--ow-border);
      border-radius: 1.5rem;
      padding: 32px;
      box-shadow: var(--ow-shadow);
    }
    .result-card h3 { margin: 0 0 8px 0; font-size: 20px; font-weight: 500; }
    .result-card p { margin: 0 0 24px 0; font-size: 15px; color: var(--ow-muted); line-height: 1.6; }

    .url-box {
      background: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 12px;
      padding: 16px;
      font-family: ui-monospace, monospace;
      font-size: 13px;
      color: var(--ow-ink);
      word-break: break-all;
      margin-bottom: 16px;
    }
    
    .warnings-list {
      margin: 0; padding-left: 20px; color: #b91c1c; font-size: 14px; line-height: 1.6;
    }

    .visually-hidden {
      position: absolute;
      width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <a class="brand" href="/" aria-label="OpenWork Share home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>openwork</span>
      </a>
      <div class="nav-links">
        <a href="https://openwork.software/docs" target="_blank" rel="noreferrer">Docs</a>
        <a href="${escapeHtml(OPENWORK_DOWNLOAD_URL)}" target="_blank" rel="noreferrer">Download</a>
        <a href="https://openwork.software/enterprise" target="_blank" rel="noreferrer">Enterprise</a>
      </div>
      <div class="nav-actions">
        <a class="button-secondary" href="https://github.com/different-ai/openwork" target="_blank" rel="noreferrer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHub
        </a>
      </div>
    </nav>

    <section class="hero-layout">
      <div class="hero-copy">
        <h1>Package <em>Your</em><br/>Worker</h1>
        <p class="hero-body">Drag and drop skills, agents, commands, or MCP configs here to create beautiful shareable links.</p>
        <p style="margin-top: 16px; font-size: 13px; color: var(--ow-muted);">Ignores files that look like they contain secrets.</p>
      </div>

      <div class="hero-artifact">
        <div class="simple-app">
          <div class="simple-app-header">
            <h2 class="simple-app-title">Create a share link</h2>
            <p class="simple-app-copy">Drop files, paste a skill, then generate one clean shareable link.</p>
          </div>
          <div class="drop-zone" id="drop-zone" role="button" tabindex="0" aria-busy="false">
            <div class="drop-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </div>
            <div class="drop-text">
              <h3>Drop files here</h3>
              <p>or click to browse local files</p>
            </div>

            <div class="included-section" id="included-section" hidden>
              <h4>Included Items</h4>
              <div class="included-list" id="included-list">
                <!-- Items injected here -->
              </div>
            </div>
          </div>
          <div class="paste-panel" id="paste-panel">
            <textarea id="paste-input" placeholder="Paste a full SKILL.md file here, including frontmatter and markdown instructions."></textarea>
            <div class="paste-meta">
              <span id="paste-status">Paste one skill and we will package it like a dropped file.</span>
              <span id="paste-count">0 characters</span>
            </div>
            <div class="paste-actions">
              <button class="button-secondary" type="button" id="paste-clipboard">Paste from clipboard</button>
            </div>
          </div>
          <button class="button-primary" type="button" id="generate-link" disabled>Generate share link</button>
          <div class="status-area" id="status-line" data-busy="false">
            <span id="status-text">Nothing selected yet.</span>
          </div>
          <input class="visually-hidden" id="file-input" type="file" multiple />
        </div>
      </div>
    </section>

    <section class="results-grid" id="results-area" hidden>
      <div class="result-card">
        <h3>Share link ready</h3>
        <p>Your worker package is published. Anyone with this link can import it directly into OpenWork.</p>
        <div class="url-box" id="result-url"></div>
        <div style="display: flex; gap: 12px;">
          <a class="button-primary" id="open-result" href="#" target="_blank">Open share page</a>
          <button class="button-secondary" id="copy-result" type="button">Copy link</button>
        </div>
      </div>
      <div class="result-card">
        <h3>Warnings</h3>
        <p>Review any files that were skipped.</p>
        <ul class="warnings-list" id="warnings-list">
          <!-- Warnings injected here -->
        </ul>
      </div>
    </section>

  </main>

  <script>
    const fileInput = document.getElementById("file-input");
    const generateButton = document.getElementById("generate-link");
    const dropZone = document.getElementById("drop-zone");
    const statusLine = document.getElementById("status-line");
    const statusText = document.getElementById("status-text");
    const includedSection = document.getElementById("included-section");
    const includedList = document.getElementById("included-list");
    const warningsList = document.getElementById("warnings-list");
    const resultsArea = document.getElementById("results-area");
    const resultUrl = document.getElementById("result-url");
    const openResult = document.getElementById("open-result");
    const copyResult = document.getElementById("copy-result");
    const pastePanel = document.getElementById("paste-panel");
    const pasteInput = document.getElementById("paste-input");
    const pasteStatus = document.getElementById("paste-status");
    const pasteCount = document.getElementById("paste-count");
    const pasteClipboardButton = document.getElementById("paste-clipboard");

    let selectedEntries = [];
    let latestPreview = null;
    let latestGeneratedUrl = "";

    function hasUsablePastedSkill() {
      return Boolean((pasteInput.value || "").trim());
    }

    function setBusy(busy, message) {
      statusLine.dataset.busy = busy ? "true" : "false";
      statusText.textContent = message;
      dropZone.setAttribute("aria-busy", busy ? "true" : "false");
      generateButton.disabled = busy || (!selectedEntries.length && !hasUsablePastedSkill()) || !latestPreview;
    }

    function updatePasteCount() {
      const count = (pasteInput.value || "").trim().length;
      pasteCount.textContent = count + (count === 1 ? " character" : " characters");
    }

    function buildVirtualEntry(name, path, content) {
      const safeName = name || "pasted-skill.md";
      const safePath = path || ".opencode/skills/pasted-skill/SKILL.md";
      return {
        name: safeName,
        path: safePath,
        async read() {
          return String(content || "");
        },
      };
    }

    function normalizeEntriesFromFiles(files) {
      return Array.from(files || []).filter(Boolean).map((file) => ({
        name: file.name,
        path: file.relativePath || file.webkitRelativePath || file.name,
        async read() {
          return await file.text();
        },
      }));
    }

    function toneInitial(kind) {
      if (kind === "MCP") return "mcp";
      if (kind === "Command") return "command";
      if (kind === "Agent") return "agent";
      return "skill";
    }

    function renderItems(items) {
      if (!items || !items.length) {
        includedSection.hidden = true;
        return;
      }
      includedSection.hidden = false;
      includedList.innerHTML = items.map((item) => {
        const dotClass = "dot-" + toneInitial(item.kind);
        return '<div class="included-item">' +
          '<div class="item-left">' +
            '<div class="item-dot ' + dotClass + '"></div>' +
            '<span class="item-title">' + escapeHtml(item.name || "Unnamed item") + '</span>' +
          '</div>' +
          '<span class="item-meta">' + escapeHtml(item.kind || "Item") + '</span>' +
        '</div>';
      }).join("");
    }

    function renderWarnings(warnings) {
      if (!Array.isArray(warnings) || !warnings.length) {
        warningsList.innerHTML = '<li style="color: #64748b; list-style: none; margin-left: -20px;">No warnings. Package is clean.</li>';
        return;
      }
      warningsList.innerHTML = warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join("");
    }

    function setGeneratedUrl(url) {
      latestGeneratedUrl = url || "";
      if (!latestGeneratedUrl) {
        resultsArea.hidden = true;
        return;
      }
      resultsArea.hidden = false;
      resultUrl.textContent = latestGeneratedUrl;
      openResult.href = latestGeneratedUrl;
    }

    async function copyGeneratedUrl() {
      if (!latestGeneratedUrl) return;
      try {
        await navigator.clipboard.writeText(latestGeneratedUrl);
        copyResult.textContent = "Copied!";
        setTimeout(() => copyResult.textContent = "Copy link", 2000);
      } catch {
        // Fallback
      }
    }

    async function fileToPayload(file) {
      return {
        name: file.name,
        path: file.path || file.relativePath || file.webkitRelativePath || file.name,
        content: await file.read(),
      };
    }

    function flattenEntries(entry, prefix) {
      return new Promise((resolve, reject) => {
        if (entry.isFile) {
          entry.file((file) => {
            file.relativePath = prefix + file.name;
            resolve([file]);
          }, reject);
          return;
        }
        if (!entry.isDirectory) {
          resolve([]);
          return;
        }
        const reader = entry.createReader();
        const files = [];
        function readBatch() {
          reader.readEntries(async (entries) => {
            if (!entries.length) { resolve(files); return; }
            for (const child of entries) {
              files.push(...await flattenEntries(child, prefix + entry.name + "/"));
            }
            readBatch();
          }, reject);
        }
        readBatch();
      });
    }

    async function collectDroppedFiles(dataTransfer) {
      const items = Array.from(dataTransfer.items || []);
      if (!items.length) return Array.from(dataTransfer.files || []);
      const collected = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (!entry) {
          const file = item.getAsFile ? item.getAsFile() : null;
          if (file) collected.push(file);
          continue;
        }
        collected.push(...await flattenEntries(entry, ""));
      }
      return collected;
    }

    async function requestPackage(previewOnly) {
      const payload = await Promise.all(selectedEntries.map(fileToPayload));
      const response = await fetch('/v1/package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ files: payload, preview: previewOnly }),
      });
      let json = null;
      try { json = await response.json(); } catch {}
      if (!response.ok) throw new Error(json?.message || 'Packaging failed.');
      return json;
    }

    async function refreshPreview() {
      if (!selectedEntries.length && hasUsablePastedSkill()) {
        selectedEntries = [buildVirtualEntry("SKILL.md", ".opencode/skills/pasted-skill/SKILL.md", pasteInput.value.trim())];
      }
      if (!selectedEntries.length) {
        latestPreview = null;
        renderItems(null);
        setGeneratedUrl("");
        setBusy(false, 'Nothing selected yet.');
        return;
      }
      setBusy(true, 'Reading files...');
      try {
        latestPreview = await requestPackage(true);
        renderItems(latestPreview.items);
        setBusy(false, 'Preview ready. Click Generate to publish.');
      } catch (error) {
        latestPreview = null;
        setBusy(false, error.message);
      }
    }

    async function publishBundle() {
      if (!selectedEntries.length && hasUsablePastedSkill()) {
        selectedEntries = [buildVirtualEntry("SKILL.md", ".opencode/skills/pasted-skill/SKILL.md", pasteInput.value.trim())];
      }
      if (!selectedEntries.length) return;
      setBusy(true, 'Publishing...');
      try {
        const result = await requestPackage(false);
        latestPreview = result;
        renderItems(result.items);
        renderWarnings(result.warnings);
        setGeneratedUrl(result.url || '');
        setBusy(false, 'Package published successfully!');
      } catch (error) {
        setBusy(false, error.message);
      }
    }

    async function assignEntries(entries) {
      selectedEntries = Array.from(entries || []).filter(Boolean);
      setGeneratedUrl("");
      await refreshPreview();
    }

    async function pasteFromClipboard() {
      if (!navigator.clipboard?.readText) {
        pasteStatus.textContent = "Clipboard access is not available in this browser.";
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          pasteStatus.textContent = "Clipboard is empty.";
          return;
        }
        pasteInput.value = text;
        updatePasteCount();
        selectedEntries = [];
        latestPreview = null;
        setGeneratedUrl("");
        pasteStatus.textContent = "Clipboard pasted. Preview is ready.";
        await refreshPreview();
      } catch {
        pasteStatus.textContent = "Clipboard access was blocked. Paste manually into the field.";
      }
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
    }

    generateButton.addEventListener('click', publishBundle);
    copyResult.addEventListener('click', copyGeneratedUrl);
    fileInput.addEventListener('change', e => assignEntries(normalizeEntriesFromFiles(e.target.files)));
    pasteInput.addEventListener('input', () => {
      updatePasteCount();
      selectedEntries = [];
      latestPreview = null;
      setGeneratedUrl("");
      pasteStatus.textContent = pasteInput.value.trim()
        ? 'Generate a link to preview and publish the pasted skill.'
        : 'Paste one skill and we will package it like a dropped file.';
      refreshPreview();
    });
    pasteClipboardButton.addEventListener('click', pasteFromClipboard);

    dropZone.addEventListener('click', () => {
      if (dropZone.getAttribute("aria-busy") !== "true") fileInput.click();
    });

    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, ev => {
      ev.preventDefault();
      dropZone.classList.add('is-dragover');
    }));

    ['dragleave', 'dragend'].forEach(e => dropZone.addEventListener(e, () => {
      dropZone.classList.remove('is-dragover');
    }));

    dropZone.addEventListener('drop', async ev => {
      ev.preventDefault();
      dropZone.classList.remove('is-dragover');
      if (dropZone.getAttribute("aria-busy") === "true") return;
      await assignEntries(normalizeEntriesFromFiles(await collectDroppedFiles(ev.dataTransfer)));
    });

    updatePasteCount();
  </script>
</body>
</html>`;
}
