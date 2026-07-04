#!/usr/bin/env node
/**
 * Acme Glossary — a zero-dependency stdio MCP server used by the
 * search-routed-capabilities eval flow (and as a handy local fixture).
 *
 * Speaks newline-delimited JSON-RPC 2.0 per the MCP stdio transport and
 * exposes exactly one tool: lookup_glossary(term) with a deterministic
 * answer for "blue-forty" so proofs can assert on real output.
 */

const GLOSSARY = {
  "blue-forty": "Blue-forty is Acme's code word for the quarterly priority launch: all hands support it until it ships.",
};

const TOOL = {
  name: "lookup_glossary",
  description: "Look up an Acme team glossary term (for example blue-forty) and return its definition.",
  inputSchema: {
    type: "object",
    properties: {
      term: { type: "string", description: "Glossary term to look up, e.g. blue-forty." },
    },
    required: ["term"],
  },
};

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params && typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "acme-glossary", version: "1.0.0" },
    });
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: [TOOL] });
    return;
  }
  if (method === "tools/call") {
    const toolName = params && typeof params.name === "string" ? params.name : "";
    if (toolName !== TOOL.name) {
      replyError(id, -32602, `Unknown tool: ${toolName}`);
      return;
    }
    const term = params && params.arguments && typeof params.arguments.term === "string"
      ? params.arguments.term.trim().toLowerCase()
      : "";
    const definition = GLOSSARY[term];
    reply(id, {
      content: [
        {
          type: "text",
          text: definition ?? `No glossary entry for "${term}".`,
        },
      ],
      isError: false,
    });
    return;
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        handle(JSON.parse(line));
      } catch {
        // Ignore malformed lines.
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
