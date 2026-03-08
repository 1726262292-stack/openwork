import {
  OPENWORK_DOWNLOAD_URL,
  OPENWORK_SITE_URL,
  SHARE_EASE,
  buildBundleNarrative,
  buildBundleUrls,
  buildOgImageUrl,
  buildOpenInAppUrls,
  collectBundleItems,
  escapeHtml,
  escapeJsonForScript,
  getBundleCounts,
  humanizeType,
  parseBundle,
  prettyJson,
  truncate,
  wantsDownload,
  wantsJsonResponse,
} from "../_lib/share-utils.js";

export { buildBundleUrls, wantsDownload, wantsJsonResponse } from "../_lib/share-utils.js";

function toneInitial(tone, kind) {
  if (tone === "mcp") return "MC";
  if (tone === "command") return "/";
  if (kind === "Agent") return "AI";
  return kind.slice(0, 2).toUpperCase();
}

function renderItem(item) {
  return `
    <li class="included-item" data-tone="${escapeHtml(item.tone)}">
      <div class="item-icon" aria-hidden="true">${escapeHtml(toneInitial(item.tone, item.kind))}</div>
      <div class="item-copy">
        <div class="item-title">${escapeHtml(item.name)}</div>
        <p class="item-meta">${escapeHtml(item.kind)} · ${escapeHtml(item.meta)}</p>
      </div>
    </li>`;
}

function renderStat(label, value) {
  if (!value) return "";
  return `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(String(value))}</strong>
    </div>`;
}

export function renderBundlePage({ id, rawJson, req }) {
  const bundle = parseBundle(rawJson);
  const urls = buildBundleUrls(req, id);
  const ogImageUrl = buildOgImageUrl(req, id);
  const { openInAppDeepLink, openInWebAppUrl } = buildOpenInAppUrls(urls.shareUrl, {
    label: bundle.name || "Shared worker package",
  });

  const counts = getBundleCounts(bundle);
  const prettyBundleJson = prettyJson(rawJson);
  const schemaVersion = bundle.schemaVersion == null ? "unknown" : String(bundle.schemaVersion);
  const typeLabel = humanizeType(bundle.type);
  const title = bundle.name || `OpenWork ${typeLabel}`;
  const description = bundle.description || buildBundleNarrative(bundle);
  const items = collectBundleItems(bundle, 8);
  const installHint =
    bundle.type === "skill"
      ? "Open in app to create a new worker and install this skill in one step."
      : bundle.type === "skills-set"
        ? "Open in app to create a new worker with this entire skills set already attached."
        : "Open in app to create a new worker with these skills, agents, MCPs, and config already bundled.";
  const previewLabel = bundle.type === "skill" ? "Skill content" : "Bundle payload";
  const previewContent = bundle.type === "skill" && bundle.content.trim() ? truncate(bundle.content.trim()) : truncate(prettyBundleJson);

  const metadataRows = [
    `<div class="meta-pair"><dt>ID</dt><dd>${escapeHtml(id)}</dd></div>`,
    `<div class="meta-pair"><dt>Type</dt><dd>${escapeHtml(bundle.type || "unknown")}</dd></div>`,
    `<div class="meta-pair"><dt>Schema</dt><dd>${escapeHtml(schemaVersion)}</dd></div>`,
    counts.skillCount ? `<div class="meta-pair"><dt>Skills</dt><dd>${escapeHtml(String(counts.skillCount))}</dd></div>` : "",
    counts.agentCount ? `<div class="meta-pair"><dt>Agents</dt><dd>${escapeHtml(String(counts.agentCount))}</dd></div>` : "",
    counts.mcpCount ? `<div class="meta-pair"><dt>MCPs</dt><dd>${escapeHtml(String(counts.mcpCount))}</dd></div>` : "",
    counts.commandCount ? `<div class="meta-pair"><dt>Commands</dt><dd>${escapeHtml(String(counts.commandCount))}</dd></div>` : "",
    counts.hasConfig ? `<div class="meta-pair"><dt>Config</dt><dd>yes</dd></div>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - OpenWork Share</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="openwork:bundle-id" content="${escapeHtml(id)}" />
  <meta name="openwork:bundle-type" content="${escapeHtml(bundle.type || "unknown")}" />
  <meta name="openwork:schema-version" content="${escapeHtml(schemaVersion)}" />
  <meta name="openwork:open-in-app-url" content="${escapeHtml(openInAppDeepLink)}" />
  <link rel="canonical" href="${escapeHtml(urls.shareUrl)}" />
  <link rel="alternate" type="application/json" href="${escapeHtml(urls.jsonUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(urls.shareUrl)}" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  <style>
    :root {
      color-scheme: light;
      --ow-bg: #f6f9fc;
      --ow-ink: #011627;
      --ow-muted: #5f6b7a;
      --ow-card: rgba(255, 255, 255, 0.8);
      --ow-card-strong: rgba(255, 255, 255, 0.92);
      --ow-border: rgba(255, 255, 255, 0.74);
      --ow-shadow: 0 26px 72px -30px rgba(15, 23, 42, 0.2);
      --ow-primary: #011627;
      --ow-ease: ${SHARE_EASE};
      --ow-skill: linear-gradient(135deg, #f97316, #facc15);
      --ow-agent: linear-gradient(135deg, #1d4ed8, #60a5fa);
      --ow-mcp: linear-gradient(135deg, #0f766e, #2dd4bf);
      --ow-command: linear-gradient(135deg, #7c3aed, #c084fc);
      --ow-sans: Inter, "Segoe UI", "Helvetica Neue", sans-serif;
      --ow-accent: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: var(--ow-sans);
      color: var(--ow-ink);
      background:
        radial-gradient(circle at top left, rgba(251, 191, 36, 0.32), transparent 32%),
        radial-gradient(circle at right, rgba(96, 165, 250, 0.24), transparent 30%),
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
      opacity: 0.32;
      mix-blend-mode: multiply;
    }

    a, button { font: inherit; }

    .shell {
      position: relative;
      z-index: 1;
      width: min(100%, 1180px);
      margin: 0 auto;
      padding: 28px 18px 54px;
    }

    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
    }

    .brand,
    .nav-link,
    .button-secondary,
    .button-copy,
    .button-primary {
      transition:
        background-color 300ms var(--ow-ease),
        border-color 300ms var(--ow-ease),
        box-shadow 300ms var(--ow-ease),
        color 300ms var(--ow-ease),
        transform 300ms var(--ow-ease);
    }

    .brand,
    .nav-link,
    .button-secondary,
    .button-copy {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 18px;
      border-radius: 999px;
      text-decoration: none;
      background: rgba(255, 255, 255, 0.66);
      border: 1px solid rgba(255, 255, 255, 0.82);
      box-shadow: 0 18px 44px -34px rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(12px);
      color: var(--ow-ink);
    }

    .brand:hover,
    .nav-link:hover,
    .button-secondary:hover,
    .button-copy:hover {
      background: rgb(242, 242, 242);
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.04) 0px 1px 2px 0px,
        rgba(0, 0, 0, 0.04) 0px 2px 4px 0px;
    }

    .button-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 48px;
      padding: 0 22px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      color: #fff;
      background: var(--ow-primary);
      box-shadow: 0 22px 46px -28px rgba(1, 22, 39, 0.7);
      font-weight: 600;
    }

    .button-primary:hover {
      background: #0d2336;
      transform: translateY(-1px);
    }

    .brand-mark {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, #011627, #1d4ed8 60%, #60a5fa);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.9);
    }

    .hero {
      position: relative;
      overflow: hidden;
      border-radius: 40px;
      border: 1px solid var(--ow-border);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.72));
      box-shadow: var(--ow-shadow);
      backdrop-filter: blur(22px);
      padding: clamp(24px, 4vw, 40px);
      margin-bottom: 20px;
    }

    .hero::before,
    .hero::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      pointer-events: none;
    }

    .hero::before {
      top: -72px;
      right: -42px;
      width: 240px;
      height: 240px;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.3), rgba(251, 191, 36, 0));
    }

    .hero::after {
      left: -28px;
      bottom: -96px;
      width: 280px;
      height: 280px;
      background: radial-gradient(circle, rgba(96, 165, 250, 0.24), rgba(96, 165, 250, 0));
    }

    .hero-layout {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 20px;
      grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
      align-items: start;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.95);
      box-shadow: 0 14px 34px -28px rgba(15, 23, 42, 0.28);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #526172;
    }

    h1 {
      margin: 16px 0 12px;
      max-width: 12ch;
      font-size: clamp(3rem, 7vw, 5.2rem);
      line-height: 0.92;
      letter-spacing: -0.08em;
      font-weight: 700;
    }

    h1 em {
      font-style: normal;
      font-family: var(--ow-accent);
      font-weight: 600;
      letter-spacing: -0.06em;
    }

    .hero-copy p,
    .hero-note,
    .helper-text,
    .preview-card p,
    .panel-title p,
    .preview-box summary,
    .preview-box pre,
    .item-meta,
    .json-link {
      color: var(--ow-muted);
      line-height: 1.7;
    }

    .hero-copy p { margin: 0; max-width: 52ch; font-size: 17px; }
    .hero-note {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 13px;
    }

    .hero-note span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.9);
    }

    .hero-actions,
    .action-grid,
    .helper-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }

    .preview-card,
    .panel,
    .preview-box {
      border-radius: 30px;
      padding: 22px;
      border: 1px solid rgba(255, 255, 255, 0.86);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.72));
      box-shadow: 0 22px 56px -40px rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(16px);
    }

    .panel-grid {
      display: grid;
      gap: 18px;
      grid-template-columns: 1.1fr 0.9fr;
      margin-top: 18px;
    }

    .panel-title { display: grid; gap: 6px; margin-bottom: 14px; }
    .panel-title h2,
    .panel-title h3,
    .preview-card h2 {
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.05em;
    }

    .helper-text { margin: 0 0 16px; font-size: 14px; }
    .stats-row {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 18px;
    }

    .stat-card {
      display: grid;
      gap: 8px;
      min-height: 104px;
      padding: 16px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 18px 42px -36px rgba(15, 23, 42, 0.28);
    }

    .stat-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #738193;
    }

    .stat-value {
      font-size: 30px;
      line-height: 1;
      letter-spacing: -0.08em;
      font-weight: 700;
    }

    .included-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }

    .included-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px;
      border-radius: 22px;
      border: 1px solid rgba(255, 255, 255, 0.88);
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 18px 46px -36px rgba(15, 23, 42, 0.28);
    }

    .item-icon {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      color: white;
      font-size: 13px;
      font-weight: 700;
      flex: 0 0 auto;
      background: var(--ow-agent);
    }

    .included-item[data-tone="skill"] .item-icon { background: var(--ow-skill); }
    .included-item[data-tone="agent"] .item-icon { background: var(--ow-agent); }
    .included-item[data-tone="mcp"] .item-icon { background: var(--ow-mcp); }
    .included-item[data-tone="command"] .item-icon { background: var(--ow-command); }

    .item-copy { min-width: 0; display: grid; gap: 4px; }
    .item-title {
      font-size: 15px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metadata {
      display: grid;
      gap: 12px;
      margin: 0;
    }

    .meta-pair {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.84);
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 18px 42px -38px rgba(15, 23, 42, 0.28);
    }

    .meta-pair dt {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #738193;
    }

    .meta-pair dd {
      margin: 0;
      font-size: 13px;
      color: var(--ow-ink);
      font-weight: 600;
      word-break: break-word;
    }

    .preview-box { margin-top: 18px; }

    .preview-box summary {
      cursor: pointer;
      list-style: none;
      font-weight: 600;
    }

    .preview-box summary::-webkit-details-marker { display: none; }

    .preview-box pre {
      margin: 14px 0 0;
      padding: 16px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.94);
      box-shadow: 0 18px 44px -40px rgba(15, 23, 42, 0.24);
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.65;
      color: #3a4b5b;
    }

    .json-link { margin-top: 14px; font-size: 14px; }
    .json-link a { color: var(--ow-ink); font-weight: 600; }

    @media (max-width: 960px) {
      .hero-layout,
      .panel-grid,
      .stats-row { grid-template-columns: 1fr; }
      h1 { max-width: none; }
    }

    @media (max-width: 640px) {
      .shell { padding: 18px 14px 40px; }
      .nav { flex-direction: column; align-items: stretch; }
      .nav > * { width: 100%; }
      .hero,
      .preview-card,
      .panel,
      .preview-box { border-radius: 28px; padding: 20px; }
      h1 { font-size: 3.4rem; }
      .hero-actions > *,
      .action-grid > *,
      .helper-actions > * { width: 100%; }
    }
  </style>
</head>
<body
  data-openwork-share="true"
  data-openwork-bundle-id="${escapeHtml(id)}"
  data-openwork-bundle-type="${escapeHtml(bundle.type || "unknown")}"
  data-openwork-schema-version="${escapeHtml(schemaVersion)}"
>
  <main class="shell">
    <nav class="nav">
      <a class="brand" href="/" aria-label="Package another worker">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>OpenWork Share</span>
      </a>
      <div class="helper-actions">
        <a class="nav-link" href="${escapeHtml(OPENWORK_SITE_URL)}" target="_blank" rel="noreferrer">OpenWork</a>
        <a class="nav-link" href="${escapeHtml(OPENWORK_DOWNLOAD_URL)}" target="_blank" rel="noreferrer">Download app</a>
      </div>
    </nav>

    <section class="hero">
      <div class="hero-layout">
        <div class="hero-copy">
          <span class="eyebrow">${escapeHtml(typeLabel)} · ${escapeHtml(id.slice(-8))}</span>
          <h1>${escapeHtml(title)} <em>ready</em></h1>
          <p>${escapeHtml(description)}</p>
          <div class="hero-actions">
            <a class="button-primary" href="${escapeHtml(openInAppDeepLink)}">Open in app</a>
            <a class="button-secondary" href="${escapeHtml(openInWebAppUrl)}" target="_blank" rel="noreferrer">Open in web app</a>
            <button class="button-copy" type="button" id="copy-link">Copy share link</button>
          </div>
          <div class="hero-note">
            <span>${escapeHtml(installHint)}</span>
            <span>Machine readable JSON stays available at <a href="${escapeHtml(urls.jsonUrl)}">${escapeHtml(urls.jsonUrl)}</a>.</span>
          </div>
          <div class="stats-row">
            ${renderStat("Skills", counts.skillCount)}
            ${renderStat("Agents", counts.agentCount)}
            ${renderStat("MCPs", counts.mcpCount)}
            ${renderStat("Commands", counts.commandCount)}
          </div>
        </div>

        <aside class="preview-card">
          <h2>Included</h2>
          <p>${escapeHtml(buildBundleNarrative(bundle))}</p>
          <ul class="included-list">
            ${items.length ? items.map(renderItem).join("") : `<li class="included-item" data-tone="skill"><div class="item-icon" aria-hidden="true">PK</div><div class="item-copy"><div class="item-title">OpenWork bundle</div><p class="item-meta">Bundle · Shared config</p></div></li>`}
          </ul>
        </aside>
      </div>
    </section>

    <section class="panel-grid">
      <section class="panel">
        <div class="panel-title">
          <h3>Bundle details</h3>
          <p>Stable metadata for parsing, sharing, and direct OpenWork import.</p>
        </div>
        <dl class="metadata">
          ${metadataRows}
        </dl>
        <details class="preview-box">
          <summary>${escapeHtml(previewLabel)} preview</summary>
          <pre>${escapeHtml(previewContent)}</pre>
        </details>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h3>Raw endpoints</h3>
          <p>Keep the human page and machine payload side by side.</p>
        </div>
        <p class="helper-text">Use the JSON endpoint for programmatic imports, or download the exact payload as a file.</p>
        <div class="action-grid">
          <a class="button-secondary" href="${escapeHtml(urls.jsonUrl)}">Open JSON</a>
          <a class="button-secondary" href="${escapeHtml(urls.downloadUrl)}">Download JSON</a>
        </div>
        <p class="json-link">Share page: <a href="${escapeHtml(urls.shareUrl)}">${escapeHtml(urls.shareUrl)}</a></p>
        <p class="json-link">JSON payload: <a href="${escapeHtml(urls.jsonUrl)}">${escapeHtml(urls.jsonUrl)}</a></p>
      </section>
    </section>
  </main>

  <script id="openwork-bundle-json" type="application/json">${escapeJsonForScript(rawJson)}</script>
  <script>
    const shareUrl = ${JSON.stringify(urls.shareUrl)};
    const copyButton = document.getElementById("copy-link");
    copyButton?.addEventListener("click", async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          copyButton.textContent = "Copied";
          window.setTimeout(() => {
            copyButton.textContent = "Copy share link";
          }, 1600);
          return;
        }
      } catch {
        // fall through
      }

      const input = document.createElement("textarea");
      input.value = shareUrl;
      input.style.position = "fixed";
      input.style.left = "-99999px";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy share link";
      }, 1600);
    });
  </script>
</body>
</html>`;
}
