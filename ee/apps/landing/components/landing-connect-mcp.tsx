"use client";

import { useEffect, useRef, useState } from "react";

import { capturePosthogEvent } from "../lib/posthog-client";

const MCP_SERVER_URL = "https://api.openworklabs.com/mcp/agent";
const DOCS_URL = "https://openworklabs.com/docs/cloud/run-in-the-cloud/cloud-mcp";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(value: string) {
  let encoded = "";

  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const hasSecond = index + 1 < value.length;
    const hasThird = index + 2 < value.length;
    const second = hasSecond ? value.charCodeAt(index + 1) : 0;
    const third = hasThird ? value.charCodeAt(index + 2) : 0;
    const bits = (first << 16) | (second << 8) | third;

    encoded += BASE64_ALPHABET.charAt((bits >> 18) & 63);
    encoded += BASE64_ALPHABET.charAt((bits >> 12) & 63);
    encoded += hasSecond ? BASE64_ALPHABET.charAt((bits >> 6) & 63) : "=";
    encoded += hasThird ? BASE64_ALPHABET.charAt(bits & 63) : "=";
  }

  return encoded;
}

const CURSOR_CONFIG_JSON = JSON.stringify({ url: MCP_SERVER_URL });
const CURSOR_DEEPLINK = `https://cursor.com/en/install-mcp?name=openwork&config=${encodeURIComponent(
  encodeBase64(CURSOR_CONFIG_JSON)
)}`;
const CURSOR_SNIPPET = `{
  "mcpServers": {
    "openwork": {
      "url": "${MCP_SERVER_URL}"
    }
  }
}`;
const CLAUDE_CODE_COMMAND = `claude mcp add --transport http openwork ${MCP_SERVER_URL}`;
const OPENCODE_SNIPPET = `{
  "mcp": {
    "openwork": {
      "type": "remote",
      "enabled": true,
      "url": "${MCP_SERVER_URL}",
      "oauth": {}
    }
  }
}`;
const VS_CODE_COMMAND = `code --add-mcp '{"name":"openwork","type":"http","url":"${MCP_SERVER_URL}"}'`;
const ANY_CLIENT_COMMAND = `npx install-mcp ${MCP_SERVER_URL} --client <your-client>`;

const SEARCH_INPUT = `{
  "query": "meeting notes"
}`;
const SEARCH_RESULT = `{
  "matches": [
    {
      "name": "mcp:granola:query_meetings",
      "method": "POST",
      "path": "/mcp/granola",
      "score": 12,
      "summary": "Search your org's Granola meeting notes",
      "pathParams": [],
      "queryParams": [],
      "hasBody": true
    },
    {
      "name": "getOrg",
      "method": "GET",
      "path": "/v1/org",
      "score": 8,
      "summary": "Get active organization",
      "pathParams": [],
      "queryParams": [],
      "hasBody": false
    }
  ]
}`;
const EXECUTE_INPUT = `{
  "name": "mcp:granola:query_meetings"
}`;
const EXECUTE_RESULT = `{
  "meetings": [
    {
      "title": "Design review",
      "date": "2026-07-07"
    },
    {
      "title": "Customer onboarding",
      "date": "2026-07-02"
    }
  ]
}`;

type CopyMethod = "clipboard" | "execCommand" | "none";
type ClientId = "cursor" | "claude-code" | "opencode" | "vs-code" | "any-client";

type ClientInstall = {
  id: ClientId;
  label: string;
  eyebrow: string;
  copyText: string;
  helper: string;
};

const CLIENT_ORDER: ClientId[] = ["cursor", "claude-code", "opencode", "vs-code", "any-client"];

const CLIENT_INSTALLS: Record<ClientId, ClientInstall> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    eyebrow: "One-click install or ~/.cursor/mcp.json",
    copyText: CURSOR_SNIPPET,
    helper: "Paste this into ~/.cursor/mcp.json if you prefer manual setup."
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    eyebrow: "One terminal command",
    copyText: CLAUDE_CODE_COMMAND,
    helper: "Claude Code opens the browser for OAuth, then stores the remote MCP server."
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    eyebrow: "opencode.json MCP config",
    copyText: OPENCODE_SNIPPET,
    helper: "Add this remote MCP server entry to your OpenCode config."
  },
  "vs-code": {
    id: "vs-code",
    label: "VS Code",
    eyebrow: "VS Code MCP command",
    copyText: VS_CODE_COMMAND,
    helper: "Run this from a shell with the VS Code CLI on your path."
  },
  "any-client": {
    id: "any-client",
    label: "Any client",
    eyebrow: "Universal installer",
    copyText: ANY_CLIENT_COMMAND,
    helper: "Use install-mcp for another client, or paste the remote server URL directly."
  }
};

async function writeClipboardText(text: string): Promise<{ copied: boolean; method: CopyMethod }> {
  let copied = false;
  let method: CopyMethod = "none";

  try {
    await navigator.clipboard.writeText(text);
    copied = true;
    method = "clipboard";
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      copied = document.execCommand("copy");
      if (copied) method = "execCommand";
    } catch {}
    textarea.remove();
  }

  return { copied, method };
}

export function LandingConnectMcp() {
  const [activeClient, setActiveClient] = useState<ClientId>("cursor");
  const [feedbackClient, setFeedbackClient] = useState<ClientId | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const installResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (installResetTimer.current) clearTimeout(installResetTimer.current);
      if (urlResetTimer.current) clearTimeout(urlResetTimer.current);
    };
  }, []);

  const copyInstall = async (install: ClientInstall) => {
    const { copied, method } = await writeClipboardText(install.copyText);

    setCopyError(!copied);
    setFeedbackClient(install.id);
    capturePosthogEvent("landing_connect_mcp_copy_clicked", {
      client: install.id,
      copied,
      method
    });

    if (installResetTimer.current) clearTimeout(installResetTimer.current);
    installResetTimer.current = setTimeout(() => {
      setFeedbackClient(null);
      installResetTimer.current = null;
    }, 2500);
  };

  const copyServerUrl = async () => {
    const { copied } = await writeClipboardText(MCP_SERVER_URL);
    setUrlCopied(copied);

    if (urlResetTimer.current) clearTimeout(urlResetTimer.current);
    urlResetTimer.current = setTimeout(() => {
      setUrlCopied(false);
      urlResetTimer.current = null;
    }, 2500);
  };

  return (
    <section id="connect-mcp" className="relative scroll-mt-24">
      <div className="mb-6 max-w-3xl">
        <div className="landing-chip mb-4 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
          OpenWork Connect MCP
        </div>
        <h2 className="text-3xl font-medium leading-[1.12] tracking-tight text-[#011627] md:text-4xl lg:text-5xl">
          Connect any agent
        </h2>
        <p className="mt-4 text-[16px] leading-7 text-gray-600 md:text-lg md:leading-8">
          Your org&apos;s capabilities, connections, and marketplace are two MCP tools away:
          <span className="font-mono text-[#011627]"> search_capabilities</span> finds the
          right operation, and <span className="font-mono text-[#011627]">execute_capability</span> runs it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Server URL
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-[#011627] ring-1 ring-gray-100">
                {MCP_SERVER_URL}
              </code>
              <button
                type="button"
                aria-label="Copy the OpenWork MCP server URL"
                onClick={() => {
                  void copyServerUrl();
                }}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-[#011627] transition-colors hover:bg-gray-50"
              >
                {urlCopied ? "Copied" : "Copy URL"}
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-gray-500">
              Remote streamable HTTP with OAuth 2.0, dynamic client registration, and PKCE.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="OpenWork MCP client install options"
            className="landing-chip mb-4 flex gap-1 overflow-x-auto rounded-full p-1"
          >
            {CLIENT_ORDER.map((clientId) => {
              const client = CLIENT_INSTALLS[clientId];
              const selected = client.id === activeClient;

              return (
                <button
                  key={client.id}
                  id={`connect-mcp-tab-${client.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`connect-mcp-panel-${client.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveClient(client.id)}
                  className={`shrink-0 rounded-full px-3 py-2 text-[13px] font-medium transition-colors md:px-4 ${
                    selected
                      ? "bg-[#011627] text-white shadow-sm"
                      : "text-gray-600 hover:bg-white hover:text-[#011627]"
                  }`}
                >
                  {client.label}
                </button>
              );
            })}
          </div>

          {CLIENT_ORDER.map((clientId) => {
            const install = CLIENT_INSTALLS[clientId];
            const selected = install.id === activeClient;
            const installFeedback = feedbackClient === install.id;

            return (
              <div
                key={install.id}
                id={`connect-mcp-panel-${install.id}`}
                role="tabpanel"
                aria-labelledby={`connect-mcp-tab-${install.id}`}
                hidden={!selected}
                data-feedback={installFeedback ? "true" : "false"}
                data-copy-error={copyError ? "true" : "false"}
                className="rounded-xl border border-gray-100 bg-white shadow-sm"
              >
                <div className="border-b border-gray-100 p-4 md:p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                    {install.eyebrow}
                  </div>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-xl font-medium text-[#011627]">{install.label}</h3>
                      <p className="mt-1 text-[13px] leading-5 text-gray-500">{install.helper}</p>
                    </div>
                    {install.id === "cursor" ? (
                      <a
                        href={CURSOR_DEEPLINK}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[42px] shrink-0 items-center justify-center rounded-full bg-[#011627] px-5 text-sm font-medium text-white shadow-[0_14px_32px_-16px_rgba(1,22,39,0.55)] transition-colors hover:bg-black"
                      >
                        Add to Cursor
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="p-4 md:p-5">
                  <pre className="max-h-[300px] overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#011627] p-4 font-mono text-[12px] leading-6 text-white shadow-inner">
                    <code>{install.copyText}</code>
                  </pre>
                  {install.id === "any-client" ? (
                    <p className="mt-3 text-[13px] leading-6 text-gray-500">
                      You can also paste the URL into any MCP client that supports remote servers with OAuth.
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12px] leading-5 text-gray-500">
                      OAuth opens in your browser, asks you to pick your org, then returns the token to the client.
                    </p>
                    <button
                      type="button"
                      aria-label="Copy the OpenWork MCP install command"
                      onClick={() => {
                        void copyInstall(install);
                      }}
                      className="inline-flex min-w-[116px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#011627] shadow-sm transition-colors hover:bg-gray-50"
                    >
                      {installFeedback ? (copyError ? "Couldn't copy" : "Copied") : "Copy"}
                    </button>
                  </div>
                </div>
                <span aria-live="polite" className="sr-only">
                  {installFeedback ? (copyError ? "Install command could not be copied" : "Install command copied") : ""}
                </span>
              </div>
            );
          })}
        </div>

        <div
          data-testid="connect-mcp-example"
          className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Example
              </div>
              <div className="mt-1 text-sm font-medium text-[#011627]">Search, then execute</div>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
            </div>
          </div>
          <div className="space-y-4 bg-[#07192C] p-4 font-mono text-[12px] leading-6 text-slate-100 md:p-5">
            <div>
              <div className="mb-2 text-slate-400">agent → search_capabilities</div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{SEARCH_INPUT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-2 text-slate-400">openwork → matches</div>
              <pre className="max-h-[320px] overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{SEARCH_RESULT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-2 text-slate-400">agent → execute_capability</div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{EXECUTE_INPUT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-2 text-slate-400">openwork → result</div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{EXECUTE_RESULT}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-gray-100 bg-white/80 p-4 text-[13px] leading-6 text-gray-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          Works with any MCP client that supports remote servers with OAuth — your agent signs in with your
          OpenWork account and only sees what your org allows.
        </p>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium text-[#011627] underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-[#011627]"
        >
          Read the docs
        </a>
      </div>
    </section>
  );
}
