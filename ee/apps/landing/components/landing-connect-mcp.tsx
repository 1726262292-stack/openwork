"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Link2, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { capturePosthogEvent } from "../lib/posthog-client";
import { LandingAgentGlyphs } from "./landing-agent-glyphs";

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

const SEARCH_INPUT = `{"query": "meeting notes"}`;
const SEARCH_RESULT = `{
  "matches": [
    { "name": "mcp:granola:query_meetings", "method": "POST", "path": "/mcp/granola", "score": 12, "summary": "Meeting notes your org connected via Granola", "pathParams": [], "queryParams": [], "hasBody": true },
    { "name": "plugin:meeting-brief:generate", "kind": "skill", "method": "POST", "path": "/v1/marketplace/run", "score": 9, "summary": "Teammate-shared skill: draft a meeting brief", "hasBody": true }
  ]
}`;
const EXECUTE_INPUT = `{"name": "plugin:meeting-brief:generate"}`;
const EXECUTE_RESULT = `{"brief": "Acme Corp call — deal history, latest notes, 3 talking points", "savedTo": "Meeting Brief — Acme Corp.md"}`;

type CopyMethod = "clipboard" | "execCommand" | "none";
type ClientId = "cursor" | "claude-code" | "opencode" | "vs-code" | "any-client";
type BringTone = "mcp" | "skill" | "command";

type ClientInstall = {
  id: ClientId;
  label: string;
  eyebrow: string;
  copyText: string;
  helper: string;
};

type BringItem = {
  name: string;
  type: string;
  tone: BringTone;
};

const CLIENT_ORDER: ClientId[] = ["cursor", "claude-code", "opencode", "vs-code", "any-client"];
const revealSteps = ["Sign in in the browser", "Pick your org", "Your team's tools appear"];

const bringItems: BringItem[] = [
  { name: "Granola", type: "MCP", tone: "mcp" },
  { name: "Meeting Brief Generator", type: "Skill", tone: "skill" },
  { name: "review-pr", type: "Command", tone: "command" },
  { name: "Linear", type: "MCP", tone: "mcp" }
];

const dotClass: Record<BringTone, string> = {
  mcp: "bg-gradient-to-br from-teal-400 to-cyan-500",
  skill: "bg-gradient-to-br from-amber-400 to-orange-400",
  command: "bg-gradient-to-br from-violet-400 to-purple-500"
};

const CLIENT_INSTALLS: Record<ClientId, ClientInstall> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    eyebrow: "One-click install or ~/.cursor/mcp.json",
    copyText: CURSOR_SNIPPET,
    helper: "Use the one-click button, or paste this into ~/.cursor/mcp.json."
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    eyebrow: "One terminal command",
    copyText: CLAUDE_CODE_COMMAND,
    helper: "Claude Code opens your browser for OAuth, then stores the remote MCP server."
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
  const [revealed, setRevealed] = useState(false);
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
    if (copied) setRevealed(true);
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
    <section id="connect-mcp" className="landing-shell rounded-[2.5rem] p-8 md:p-12 scroll-mt-24">
      <div className="mb-10">
        <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          <Plug size={18} />
          OpenWork Connect
        </div>
        <h2 className="max-w-3xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl lg:text-5xl">
          Already doing it in your agent?<br />Add it to OpenWork. Share it with everyone.
        </h2>
        <p className="mt-5 max-w-3xl text-[16px] leading-7 text-gray-600 md:text-lg md:leading-8">
          Skills and MCPs move in as-is — same SKILL.md format, same server URLs. Share once on
          OpenWork, and every teammate&apos;s agent can use them through
          <span className="font-mono text-[#011627]"> search_capabilities</span> and
          <span className="font-mono text-[#011627]"> execute_capability</span>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <div
          data-testid="connect-mcp-bring"
          className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-4 py-2.5">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            </div>
            <div className="text-[12px] font-medium text-gray-500">OpenWork</div>
          </div>

          <div className="flex flex-1 flex-col gap-3 p-4 text-left md:p-5">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                From your agents
              </div>
              <h3 className="text-lg font-medium tracking-tight text-[#011627]">
                Your setup, moved in as-is
              </h3>
            </div>

            <div className="flex flex-col gap-1.5">
              {bringItems.map((item, index) => (
                <div
                  key={item.name}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-all ${
                    index === 0 ? "border-blue-300 bg-blue-50/60 shadow-sm" : "border-gray-100 bg-white"
                  }`}
                >
                  <span className={`h-6 w-6 shrink-0 rounded-full ${dotClass[item.tone]}`} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#011627]">
                    {item.name}
                  </span>
                  <span className="shrink-0 rounded-full border border-gray-100 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                    {item.type}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[13px] leading-6 text-gray-600">
              Already in Claude Code or Cursor? OpenWork speaks the same SKILL.md and remote MCP URLs — add them unchanged, then share your setup in one link.
            </p>

            <div className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg bg-[#011627] py-2 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(17,24,39,0.12)]">
              <Link2 size={16} />
              Share with your org
            </div>
          </div>
        </div>

        <div
          data-testid="connect-mcp-example"
          className="landing-shell relative flex h-full flex-col overflow-hidden rounded-2xl"
        >
          <div className="relative z-20 flex h-10 w-full shrink-0 items-center border-b border-white/50 bg-gradient-to-b from-white/90 to-white/60 px-4">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full border border-[#e0443e]/20 bg-[#ff5f56]/90 shadow-sm" />
              <div className="h-3 w-3 rounded-full border border-[#dea123]/20 bg-[#ffbd2e]/90 shadow-sm" />
              <div className="h-3 w-3 rounded-full border border-[#1aab29]/20 bg-[#27c93f]/90 shadow-sm" />
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] font-medium tracking-wide text-gray-500">
              What your teammate&apos;s agent sees
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 bg-[#07192C] p-4 font-mono text-[11px] leading-5 text-slate-100 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                Example
              </span>
              <span className="text-[11px] text-slate-500">shared once, consumed anywhere</span>
            </div>
            <div>
              <div className="mb-1.5 text-slate-400">agent → search_capabilities</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{SEARCH_INPUT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-1.5 text-slate-400">openwork → matches</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{SEARCH_RESULT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-1.5 text-slate-400">agent → execute_capability</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{EXECUTE_INPUT}</code>
              </pre>
            </div>
            <div>
              <div className="mb-1.5 text-slate-400">openwork → result</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-slate-100">
                <code>{EXECUTE_RESULT}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="connect-mcp-install"
        className="mt-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="group mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-[13px] text-gray-500">
            Already use an AI agent? Point it at your org — one click or one command connects it.
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2 text-gray-400">
            <LandingAgentGlyphs />
            <span className="text-xs text-gray-400">
              Works with Claude Code, Cursor, VS Code — any MCP agent
            </span>
          </div>
        </div>

        <div className="min-w-0">
            <div
              role="tablist"
              aria-label="OpenWork MCP client install options"
              className="landing-chip mb-4 flex flex-nowrap gap-2 overflow-x-auto rounded-full p-1"
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
                    className={`relative shrink-0 cursor-pointer whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                      selected ? "text-[#011627]" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {selected ? (
                      <motion.div
                        layoutId="connect-mcp-pill"
                        className="absolute inset-0 rounded-full border border-gray-100 bg-white shadow-sm"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    ) : null}
                    <span className="relative z-10">{client.label}</span>
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
                >
                  <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
                    <div className="border-b border-gray-100 p-4">
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

                    <div className="p-4">
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
                          className="inline-flex min-w-[110px] items-center justify-center gap-1.5 rounded-lg bg-[#011627] px-4 py-2 text-xs font-medium text-white shadow-[0_1px_2px_rgba(17,24,39,0.12)] transition-colors hover:bg-black"
                        >
                          {installFeedback ? (
                            copyError ? (
                              "Couldn't copy"
                            ) : (
                              <>
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                                Copied
                              </>
                            )
                          ) : (
                            "Copy"
                          )}
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {revealed && selected ? (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 border-t border-gray-100 pt-3">
                              <div className="flex items-center gap-2 text-[13px] font-medium text-[#011627]">
                                <svg
                                  className="h-4 w-4 shrink-0 text-green-600"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                                Copied — now run it:
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2">
                                {revealSteps.map((label, index) => (
                                  <div key={label} className="flex items-center gap-2">
                                    {index > 0 ? <ChevronRight size={12} className="text-gray-300" /> : null}
                                    <span className="step-circle">{index + 1}</span>
                                    <span className="text-[13px] text-gray-600">{label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                  <span aria-live="polite" className="sr-only">
                    {installFeedback ? (copyError ? "Install command could not be copied" : "Install command copied") : ""}
                  </span>
                </div>
              );
            })}
          </div>

        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            Server URL
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="min-w-0 whitespace-normal break-all rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-[#011627] ring-1 ring-gray-100">
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
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 border-t border-gray-100 pt-5 text-[13px] leading-6 text-gray-600 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Works with any MCP client that supports remote servers with OAuth — your agent signs in with your
          OpenWork account and only sees what your org shares with them.
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
