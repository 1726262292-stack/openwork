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
  <meta name="description" content="Drag and drop OpenWork skills, agents, commands, or MCP config to publish a shareable worker package." />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Package Your Worker" />
  <meta property="og:description" content="Drop skills, agents, or MCPs into OpenWork Share and publish a worker package in one move." />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Package Your Worker" />
  <meta name="twitter:description" content="Drop skills, agents, or MCPs into OpenWork Share and publish a worker package in one move." />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  <style>
    :root {
      color-scheme: light;
      --ow-bg: #f6f9fc;
      --ow-ink: #011627;
      --ow-muted: #5f6b7a;
      --ow-card: rgba(255, 255, 255, 0.78);
      --ow-card-strong: rgba(255, 255, 255, 0.92);
      --ow-border: rgba(255, 255, 255, 0.72);
      --ow-border-soft: rgba(148, 163, 184, 0.2);
      --ow-shadow: 0 24px 70px -28px rgba(15, 23, 42, 0.18);
      --ow-shadow-strong: 0 28px 80px -28px rgba(15, 23, 42, 0.26);
      --ow-primary: #011627;
      --ow-primary-hover: #0d2336;
      --ow-skill: linear-gradient(135deg, #f97316, #facc15);
      --ow-agent: linear-gradient(135deg, #1d4ed8, #60a5fa);
      --ow-mcp: linear-gradient(135deg, #0f766e, #2dd4bf);
      --ow-command: linear-gradient(135deg, #7c3aed, #c084fc);
      --ow-ease: ${SHARE_EASE};
      --ow-sans: Inter, "Segoe UI", "Helvetica Neue", sans-serif;
      --ow-accent: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: var(--ow-sans);
      color: var(--ow-ink);
      background:
        radial-gradient(circle at top left, rgba(251, 191, 36, 0.34), transparent 34%),
        radial-gradient(circle at top right, rgba(96, 165, 250, 0.28), transparent 30%),
        radial-gradient(circle at bottom right, rgba(244, 114, 182, 0.14), transparent 28%),
        linear-gradient(180deg, #fbfdff 0%, var(--ow-bg) 100%);
      overflow-x: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(rgba(1, 22, 39, 0.055) 0.75px, transparent 0.75px),
        radial-gradient(rgba(1, 22, 39, 0.03) 0.6px, transparent 0.6px);
      background-position: 0 0, 18px 18px;
      background-size: 36px 36px;
      opacity: 0.34;
      mix-blend-mode: multiply;
    }

    a { color: inherit; }

    .shell {
      position: relative;
      z-index: 1;
      width: min(100%, 1200px);
      margin: 0 auto;
      padding: 28px 18px 48px;
    }

    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 28px;
    }

    .brand,
    .nav-link,
    .ghost-pill,
    .primary-pill,
    .secondary-pill,
    .upload-trigger,
    .copy-button {
      transition:
        background-color 300ms var(--ow-ease),
        border-color 300ms var(--ow-ease),
        color 300ms var(--ow-ease),
        box-shadow 300ms var(--ow-ease),
        transform 300ms var(--ow-ease);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      padding: 12px 18px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.78);
      box-shadow: 0 18px 40px -30px rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(12px);
    }

    .brand:hover { transform: translateY(-1px); }

    .brand-mark {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, #011627, #1d4ed8 60%, #60a5fa);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.85);
    }

    .brand-label { display: grid; gap: 1px; }
    .brand-title { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .brand-subtitle { font-size: 12px; color: var(--ow-muted); }

    .nav-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }

    .nav-link,
    .ghost-pill,
    .secondary-pill,
    .copy-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 18px;
      border-radius: 999px;
      text-decoration: none;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.78);
      box-shadow: 0 18px 40px -30px rgba(15, 23, 42, 0.22);
      backdrop-filter: blur(12px);
    }

    .nav-link:hover,
    .ghost-pill:hover,
    .secondary-pill:hover,
    .copy-button:hover {
      background: rgb(242, 242, 242);
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.04) 0px 1px 2px 0px,
        rgba(0, 0, 0, 0.04) 0px 2px 4px 0px;
    }

    .secondary-pill:disabled,
    .upload-trigger:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none;
      box-shadow: 0 10px 26px -22px rgba(15, 23, 42, 0.18);
    }

    .secondary-pill:disabled:hover,
    .upload-trigger:disabled:hover {
      background: rgba(255, 255, 255, 0.62);
      box-shadow: 0 10px 26px -22px rgba(15, 23, 42, 0.18);
    }

    .primary-pill,
    .upload-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 48px;
      padding: 0 20px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      color: #fff;
      background: var(--ow-primary);
      box-shadow: 0 22px 46px -28px rgba(1, 22, 39, 0.7);
      font: inherit;
      font-weight: 600;
    }

    .primary-pill:hover,
    .upload-trigger:hover {
      background: rgb(13, 35, 54);
      transform: translateY(-1px);
    }

    .hero-card {
      position: relative;
      overflow: hidden;
      border-radius: 40px;
      border: 1px solid var(--ow-border);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.72));
      box-shadow: var(--ow-shadow-strong);
      backdrop-filter: blur(22px);
      padding: clamp(24px, 4vw, 42px);
    }

    .hero-card::before,
    .hero-card::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      pointer-events: none;
      filter: blur(2px);
    }

    .hero-card::before {
      top: -60px;
      right: -40px;
      width: 240px;
      height: 240px;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.28), rgba(251, 191, 36, 0));
    }

    .hero-card::after {
      left: -20px;
      bottom: -80px;
      width: 260px;
      height: 260px;
      background: radial-gradient(circle, rgba(96, 165, 250, 0.24), rgba(96, 165, 250, 0));
    }

    .hero-layout {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 24px;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      align-items: stretch;
    }

    .hero-copy { display: grid; gap: 18px; }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      min-height: 34px;
      padding: 0 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.95);
      box-shadow: 0 14px 32px -26px rgba(15, 23, 42, 0.28);
      color: #526172;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .hero-title {
      margin: 0;
      max-width: 12ch;
      font-size: clamp(3rem, 8vw, 5.5rem);
      line-height: 0.92;
      letter-spacing: -0.08em;
      font-weight: 700;
    }

    .hero-title em {
      font-style: normal;
      font-family: var(--ow-accent);
      font-weight: 600;
      letter-spacing: -0.06em;
    }

    .hero-body {
      margin: 0;
      max-width: 48ch;
      color: var(--ow-muted);
      font-size: 17px;
      line-height: 1.7;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .hero-footnote {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: #526172;
      font-size: 13px;
    }

    .hero-footnote span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.76);
      border: 1px solid rgba(255, 255, 255, 0.88);
    }

    .upload-panel,
    .stats-panel,
    .result-panel {
      display: grid;
      gap: 16px;
      border-radius: 32px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.86);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.72));
      box-shadow: var(--ow-shadow);
      backdrop-filter: blur(16px);
    }

    .panel-title { display: grid; gap: 6px; }
    .panel-title h2,
    .panel-title h3 { margin: 0; font-size: 26px; letter-spacing: -0.04em; }
    .panel-title p,
    .support-copy,
    .status-message,
    .hint-copy,
    .result-url-label,
    .item-subtext {
      margin: 0;
      color: var(--ow-muted);
      line-height: 1.6;
    }

    .drop-zone {
      position: relative;
      min-height: 250px;
      border-radius: 30px;
      border: 1.5px dashed rgba(113, 128, 150, 0.32);
      background: linear-gradient(180deg, rgba(247, 250, 252, 0.92), rgba(255, 255, 255, 0.82));
      padding: 24px;
      display: grid;
      gap: 18px;
      align-content: start;
      cursor: pointer;
      transition:
        border-color 300ms var(--ow-ease),
        background-color 300ms var(--ow-ease),
        box-shadow 300ms var(--ow-ease),
        transform 300ms var(--ow-ease);
    }

    .drop-zone:hover,
    .drop-zone.is-dragover {
      border-color: rgba(37, 99, 235, 0.28);
      background: linear-gradient(180deg, rgba(239, 246, 255, 0.96), rgba(255, 255, 255, 0.86));
      box-shadow: 0 18px 46px -34px rgba(37, 99, 235, 0.42);
      transform: translateY(-1px);
    }

    .drop-zone[aria-busy="true"] { cursor: progress; }

    .upload-icon {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(14, 165, 233, 0.18));
      color: #1d4ed8;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .upload-icon svg { width: 24px; height: 24px; }

    .drop-headline { margin: 0; font-size: 20px; letter-spacing: -0.04em; }
    .drop-subcopy { margin: 0; color: var(--ow-muted); font-size: 14px; }

    .support-copy strong,
    .status-message strong { color: var(--ow-ink); }

    .included-label {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #738193;
    }

    .included-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }

    .included-item,
    .stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px;
      border-radius: 22px;
      border: 1px solid rgba(255, 255, 255, 0.88);
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 18px 46px -36px rgba(15, 23, 42, 0.28);
    }

    .included-item .icon {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      flex: 0 0 auto;
      background: var(--ow-agent);
      display: grid;
      place-items: center;
      color: white;
      font-size: 13px;
      font-weight: 700;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }

    .included-item[data-tone="skill"] .icon { background: var(--ow-skill); }
    .included-item[data-tone="agent"] .icon { background: var(--ow-agent); }
    .included-item[data-tone="mcp"] .icon { background: var(--ow-mcp); }
    .included-item[data-tone="command"] .icon { background: var(--ow-command); }

    .item-copy {
      min-width: 0;
      display: grid;
      gap: 4px;
      flex: 1 1 auto;
    }

    .item-title {
      font-size: 15px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pill-ok {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: rgba(34, 197, 94, 0.12);
      color: #15803d;
      flex: 0 0 auto;
    }

    .grid-panels {
      display: grid;
      gap: 18px;
      margin-top: 22px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stat-card {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
      min-height: 148px;
    }

    .stat-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #738193;
    }

    .stat-value {
      font-size: 42px;
      line-height: 0.95;
      letter-spacing: -0.08em;
      font-weight: 700;
    }

    .stats-list,
    .warnings-list,
    .result-actions { display: grid; gap: 10px; }
    .warnings-list { margin: 0; padding-left: 18px; color: #9a3412; }

    .status-line {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 24px;
      font-size: 14px;
      color: var(--ow-muted);
    }

    .spinner {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 2px solid rgba(59, 130, 246, 0.18);
      border-top-color: #2563eb;
      animation: spin 1s linear infinite;
      display: none;
    }

    .status-line[data-busy="true"] .spinner { display: inline-block; }

    .result-url {
      word-break: break-all;
      padding: 14px 16px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.9);
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 16px 40px -36px rgba(15, 23, 42, 0.3);
    }

    .result-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .result-actions .primary-pill,
    .result-actions .copy-button,
    .result-actions .secondary-pill {
      width: 100%;
      min-height: 46px;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 960px) {
      .hero-layout,
      .grid-panels,
      .result-actions { grid-template-columns: 1fr; }
      .hero-title { max-width: none; }
    }

    @media (max-width: 640px) {
      .shell { padding: 18px 14px 40px; }
      .nav { align-items: stretch; flex-direction: column; }
      .nav-actions { justify-content: stretch; }
      .nav-link,
      .ghost-pill,
      .primary-pill,
      .secondary-pill,
      .copy-button,
      .upload-trigger { width: 100%; }
      .hero-card,
      .upload-panel,
      .stats-panel,
      .result-panel { border-radius: 28px; padding: 20px; }
      .hero-title { font-size: 3.4rem; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <a class="brand" href="/" aria-label="OpenWork Share home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-label">
          <span class="brand-title">OpenWork Share</span>
          <span class="brand-subtitle">Package and ship worker setup</span>
        </span>
      </a>
      <div class="nav-actions">
        <a class="nav-link" href="${escapeHtml(OPENWORK_SITE_URL)}" target="_blank" rel="noreferrer">OpenWork</a>
        <a class="nav-link" href="${escapeHtml(OPENWORK_DOWNLOAD_URL)}" target="_blank" rel="noreferrer">Download app</a>
      </div>
    </nav>

    <section class="hero-card">
      <div class="hero-layout">
        <div class="hero-copy">
          <span class="eyebrow">OpenWork Share Service</span>
          <h1 class="hero-title">Package <em>Your</em> Worker</h1>
          <p class="hero-body">Drag and drop skills, agents, or MCPs here to bundle them into a share link that opens straight into a new OpenWork worker.</p>
          <div class="hero-actions">
            <button class="upload-trigger" type="button" id="browse-files">Drop OpenWork files here</button>
            <button class="secondary-pill" type="button" id="generate-link" disabled>Generate share link</button>
          </div>
          <div class="hero-footnote">
            <span>Reads OpenWork skills, commands, agents, and OpenCode/OpenWork config.</span>
            <span>Rejects config that appears to contain secrets.</span>
          </div>
        </div>

        <section class="upload-panel">
          <div class="panel-title">
            <h2>Drop OpenWork files here</h2>
            <p>or click to browse local files</p>
          </div>

          <div class="drop-zone" id="drop-zone" role="button" tabindex="0" aria-busy="false">
            <div class="upload-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            <div>
              <h3 class="drop-headline">Drop OpenWork files here</h3>
              <p class="drop-subcopy">Skills, agents, commands, <code>opencode.json</code>, <code>opencode.jsonc</code>, or <code>openwork.json</code>.</p>
            </div>
            <p class="support-copy"><strong>Included</strong></p>
            <ul class="included-list" id="included-list">
              <li class="included-item" data-tone="agent">
                <div class="icon" aria-hidden="true">AI</div>
                <div class="item-copy">
                  <div class="item-title">Sales Inbound</div>
                  <p class="item-subtext">Agent · v1.2.0</p>
                </div>
                <span class="pill-ok" aria-hidden="true">✓</span>
              </li>
            </ul>
          </div>

          <p class="hint-copy" id="file-summary">Nothing selected yet. Drop a worker folder or a few OpenWork files to preview the package.</p>
          <div class="status-line" id="status-line" data-busy="false">
            <span class="spinner" aria-hidden="true"></span>
            <span id="status-text">Waiting for files.</span>
          </div>
          <input class="visually-hidden" id="file-input" type="file" multiple />
        </section>
      </div>
    </section>

    <section class="grid-panels">
      <section class="stats-panel">
        <div class="panel-title">
          <h3>Bundle shape</h3>
          <p>We infer the smallest useful OpenWork bundle type from the files you drop.</p>
        </div>
        <div class="stats-list" id="stats-list">
          <article class="stat-card">
            <div class="stat-label">Bundle type</div>
            <div class="stat-value" id="bundle-type">-</div>
            <p class="status-message">Drop files to see whether this becomes a skill, a skills set, or a full worker package.</p>
          </article>
        </div>
      </section>

      <section class="stats-panel">
        <div class="panel-title">
          <h3>Warnings</h3>
          <p>We ignore unsupported files and stop when config looks like it contains secrets.</p>
        </div>
        <ul class="warnings-list" id="warnings-list">
          <li>Secret-looking config values never get published.</li>
          <li>Unsupported files stay local and are skipped.</li>
        </ul>
      </section>

      <section class="result-panel">
        <div class="panel-title">
          <h3>Share link</h3>
          <p>Generate a worker package and jump straight to the public share page.</p>
        </div>
        <p class="result-url-label">Latest generated URL</p>
        <div class="result-url" id="result-url">No link yet.</div>
        <div class="result-actions">
          <a class="primary-pill" id="open-result" href="#" hidden>Open share page</a>
          <button class="copy-button" id="copy-result" type="button" hidden>Copy link</button>
        </div>
      </section>
    </section>
  </main>

  <script>
    const fileInput = document.getElementById("file-input");
    const browseButton = document.getElementById("browse-files");
    const generateButton = document.getElementById("generate-link");
    const dropZone = document.getElementById("drop-zone");
    const statusLine = document.getElementById("status-line");
    const statusText = document.getElementById("status-text");
    const includedList = document.getElementById("included-list");
    const warningsList = document.getElementById("warnings-list");
    const bundleTypeNode = document.getElementById("bundle-type");
    const fileSummary = document.getElementById("file-summary");
    const resultUrl = document.getElementById("result-url");
    const openResult = document.getElementById("open-result");
    const copyResult = document.getElementById("copy-result");

    let selectedFiles = [];
    let latestPreview = null;
    let latestGeneratedUrl = "";

    function setBusy(busy, message) {
      statusLine.dataset.busy = busy ? "true" : "false";
      statusText.textContent = message;
      dropZone.setAttribute("aria-busy", busy ? "true" : "false");
      generateButton.disabled = busy || selectedFiles.length === 0 || !latestPreview;
      browseButton.disabled = busy;
    }

    function toneInitial(kind) {
      if (kind === "MCP") return "MC";
      if (kind === "Command") return "/";
      return kind.slice(0, 2).toUpperCase();
    }

    function renderItems(items) {
      const entries = Array.isArray(items) && items.length ? items : [{ name: "Sales Inbound", kind: "Agent", meta: "v1.2.0", tone: "agent" }];
      includedList.innerHTML = entries.map((item) => {
        const tone = item.tone || "skill";
        return '<li class="included-item" data-tone="' + tone + '">' +
          '<div class="icon" aria-hidden="true">' + toneInitial(item.kind || "Item") + '</div>' +
          '<div class="item-copy">' +
            '<div class="item-title">' + escapeHtml(item.name || "Unnamed item") + '</div>' +
            '<p class="item-subtext">' + escapeHtml((item.kind || "Item") + ' · ' + (item.meta || "Ready to bundle")) + '</p>' +
          '</div>' +
          '<span class="pill-ok" aria-hidden="true">✓</span>' +
        '</li>';
      }).join("");
    }

    function renderWarnings(warnings) {
      if (!Array.isArray(warnings) || !warnings.length) {
        warningsList.innerHTML = '<li>No warnings. This package is ready to publish.</li>';
        return;
      }
      warningsList.innerHTML = warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join("");
    }

    function renderBundleType(preview) {
      if (!preview) {
        bundleTypeNode.textContent = "-";
        return;
      }
      bundleTypeNode.textContent = preview.bundleType || "workspace-profile";
    }

    function renderSummary(preview) {
      if (!preview) {
        fileSummary.textContent = "Nothing selected yet. Drop a worker folder or a few OpenWork files to preview the package.";
        return;
      }
      const summary = preview.summary || {};
      const parts = [];
      if (summary.skills) parts.push(summary.skills + ' skill' + (summary.skills === 1 ? '' : 's'));
      if (summary.agents) parts.push(summary.agents + ' agent' + (summary.agents === 1 ? '' : 's'));
      if (summary.mcpServers) parts.push(summary.mcpServers + ' MCP' + (summary.mcpServers === 1 ? '' : 's'));
      if (summary.commands) parts.push(summary.commands + ' command' + (summary.commands === 1 ? '' : 's'));
      fileSummary.textContent = parts.length ? ('Included ' + parts.join(', ') + '.') : 'Files are ready to publish.';
    }

    function setGeneratedUrl(url) {
      latestGeneratedUrl = url || "";
      if (!latestGeneratedUrl) {
        resultUrl.textContent = "No link yet.";
        openResult.hidden = true;
        copyResult.hidden = true;
        return;
      }
      resultUrl.textContent = latestGeneratedUrl;
      openResult.hidden = false;
      copyResult.hidden = false;
      openResult.href = latestGeneratedUrl;
    }

    async function copyGeneratedUrl() {
      if (!latestGeneratedUrl) return;
      try {
        await navigator.clipboard.writeText(latestGeneratedUrl);
        statusText.textContent = "Share link copied.";
      } catch {
        statusText.textContent = "Copy failed. You can copy the URL manually.";
      }
    }

    async function fileToPayload(file) {
      return {
        name: file.name,
        path: file.relativePath || file.webkitRelativePath || file.name,
        content: await file.text(),
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
            if (!entries.length) {
              resolve(files);
              return;
            }
            for (const child of entries) {
              const nestedFiles = await flattenEntries(child, prefix + entry.name + "/");
              files.push(...nestedFiles);
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
        const files = await flattenEntries(entry, "");
        collected.push(...files);
      }
      return collected;
    }

    async function requestPackage(previewOnly) {
      const payload = await Promise.all(selectedFiles.map(fileToPayload));
      const response = await fetch('/v1/package', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ files: payload, preview: previewOnly }),
      });

      let json = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      if (!response.ok) {
        throw new Error(json && typeof json.message === 'string' ? json.message : 'Packaging failed.');
      }

      return json;
    }

    async function refreshPreview() {
      if (!selectedFiles.length) {
        latestPreview = null;
        renderItems(null);
        renderWarnings(null);
        renderBundleType(null);
        renderSummary(null);
        setGeneratedUrl("");
        setBusy(false, 'Waiting for files.');
        return;
      }

      setBusy(true, 'Reading files and building a worker preview…');
      try {
        latestPreview = await requestPackage(true);
        renderItems(latestPreview.items);
        renderWarnings(latestPreview.warnings);
        renderBundleType(latestPreview);
        renderSummary(latestPreview);
        setBusy(false, 'Preview ready. Generate the share link when you are ready.');
      } catch (error) {
        latestPreview = null;
        renderWarnings([error instanceof Error ? error.message : 'Preview failed.']);
        renderBundleType(null);
        renderSummary(null);
        setBusy(false, error instanceof Error ? error.message : 'Preview failed.');
      }
    }

    async function publishBundle() {
      if (!selectedFiles.length) return;
      setBusy(true, 'Publishing your OpenWork package…');
      try {
        const result = await requestPackage(false);
        latestPreview = result;
        renderItems(result.items);
        renderWarnings(result.warnings);
        renderBundleType(result);
        renderSummary(result);
        setGeneratedUrl(result.url || '');
        setBusy(false, result.url ? 'Share link ready.' : 'Package published.');
      } catch (error) {
        setBusy(false, error instanceof Error ? error.message : 'Publish failed.');
      }
    }

    async function assignFiles(files) {
      selectedFiles = Array.from(files || []).filter(Boolean);
      setGeneratedUrl("");
      await refreshPreview();
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    browseButton.addEventListener('click', () => fileInput.click());
    generateButton.addEventListener('click', publishBundle);
    copyResult.addEventListener('click', copyGeneratedUrl);
    fileInput.addEventListener('change', async (event) => {
      await assignFiles(event.target.files);
    });

    dropZone.addEventListener('click', () => {
      if (browseButton.disabled) return;
      fileInput.click();
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (browseButton.disabled) return;
        fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach((eventName) => {
      dropZone.addEventListener(eventName, () => dropZone.classList.remove('is-dragover'));
    });

    dropZone.addEventListener('drop', async (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
      const files = await collectDroppedFiles(event.dataTransfer);
      await assignFiles(files);
    });

    renderItems(null);
    renderWarnings(null);
    setGeneratedUrl("");
  </script>
</body>
</html>`;
}
