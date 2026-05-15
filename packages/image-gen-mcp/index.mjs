#!/usr/bin/env node

/**
 * openwork-image-gen-mcp
 *
 * MCP server that exposes AI image generation as MCP tools.
 * Routes to OpenAI, xAI/Grok, or Google Imagen based on available
 * API keys in the environment.
 *
 * Environment variables (at least one required):
 *   OPENAI_API_KEY   — enables OpenAI gpt-image-1 / dall-e-3
 *   XAI_API_KEY      — enables xAI Grok image generation
 *   GOOGLE_API_KEY   — enables Google Imagen
 *
 * Usage:
 *   npx openwork-image-gen-mcp
 *
 * MCP config (opencode.json):
 *   {
 *     "mcp": {
 *       "openwork-image-gen": {
 *         "type": "local",
 *         "command": ["npx", "-y", "openwork-image-gen-mcp"],
 *         "env": { "OPENAI_API_KEY": "sk-..." }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Backend discovery ──

function discoverBackends() {
  const backends = [];

  if (process.env.OPENAI_API_KEY) {
    backends.push({
      id: "openai",
      name: "OpenAI (gpt-image-1)",
      models: ["gpt-image-1", "dall-e-3"],
      defaultModel: "gpt-image-1",
    });
  }

  if (process.env.XAI_API_KEY) {
    backends.push({
      id: "xai",
      name: "xAI (Grok)",
      models: ["grok-2-image"],
      defaultModel: "grok-2-image",
    });
  }

  if (process.env.GOOGLE_API_KEY) {
    backends.push({
      id: "google",
      name: "Google (Imagen)",
      models: ["imagen-4"],
      defaultModel: "imagen-4",
    });
  }

  return backends;
}

// ── OpenAI image generation ──

async function generateOpenAI(prompt, options = {}) {
  const model = options.model || "gpt-image-1";
  const body = {
    model,
    prompt,
    n: 1,
    size: options.size || "auto",
    quality: options.quality || "auto",
  };

  if (model === "gpt-image-1") {
    body.output_format = options.outputFormat || "png";
    if (options.background) body.background = options.background;
  } else {
    // dall-e-3 uses response_format
    body.response_format = "b64_json";
    if (options.style) body.style = options.style;
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  const imageData = result.data?.[0];
  if (!imageData) throw new Error("No image data in OpenAI response");

  const mime = `image/${body.output_format || "png"}`;
  return {
    data: imageData.b64_json,
    mimeType: mime,
    revisedPrompt: imageData.revised_prompt,
  };
}

// ── xAI image generation ──

async function generateXAI(prompt, options = {}) {
  const model = options.model || "grok-2-image";

  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      response_format: "b64_json",
      size: options.size || "1024x1024",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  const imageData = result.data?.[0];
  if (!imageData) throw new Error("No image data in xAI response");

  return {
    data: imageData.b64_json,
    mimeType: "image/png",
    revisedPrompt: imageData.revised_prompt,
  };
}

// ── Google Imagen generation ──

async function generateGoogle(prompt, options = {}) {
  const model = options.model || "imagen-4";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${process.env.GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: options.size === "1024x1536" ? "2:3" : options.size === "1536x1024" ? "3:2" : "1:1",
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  const prediction = result.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) throw new Error("No image data in Google response");

  return {
    data: prediction.bytesBase64Encoded,
    mimeType: prediction.mimeType || "image/png",
    revisedPrompt: undefined,
  };
}

// ── Dispatch ──

const generators = {
  openai: generateOpenAI,
  xai: generateXAI,
  google: generateGoogle,
};

// ── MCP Server ──

const backends = discoverBackends();
const backendIds = backends.map((b) => b.id);

const server = new McpServer({
  name: "openwork-image-gen",
  version: "0.1.0",
});

// ── generate_image ──

server.tool(
  "generate_image",
  [
    "Generate an image from a text prompt.",
    backends.length > 0
      ? `Available providers: ${backends.map((b) => b.name).join(", ")}.`
      : "No providers configured. Set OPENAI_API_KEY, XAI_API_KEY, or GOOGLE_API_KEY.",
  ].join(" "),
  {
    prompt: z.string().describe("Detailed description of the image to generate"),
    provider: z
      .enum(backendIds.length > 0 ? backendIds : ["none"])
      .optional()
      .describe("Image provider to use. Defaults to the first available."),
    size: z
      .enum(["1024x1024", "1024x1536", "1536x1024", "auto"])
      .optional()
      .describe("Image dimensions. Default: auto"),
    quality: z
      .enum(["auto", "low", "medium", "high"])
      .optional()
      .describe("Image quality. Default: auto"),
    background: z
      .enum(["auto", "opaque", "transparent"])
      .optional()
      .describe("Background type (OpenAI gpt-image-1 only). Default: auto"),
    outputFormat: z
      .enum(["png", "jpeg", "webp"])
      .optional()
      .describe("Output format (OpenAI gpt-image-1 only). Default: png"),
  },
  async (args) => {
    if (backends.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No image generation providers configured. Set OPENAI_API_KEY, XAI_API_KEY, or GOOGLE_API_KEY in the MCP server environment.",
          },
        ],
        isError: true,
      };
    }

    const providerId = args.provider || backends[0].id;
    const generator = generators[providerId];
    if (!generator) {
      return {
        content: [{ type: "text", text: `Unknown provider: ${providerId}` }],
        isError: true,
      };
    }

    try {
      const result = await generator(args.prompt, {
        size: args.size,
        quality: args.quality,
        background: args.background,
        outputFormat: args.outputFormat,
      });

      const content = [
        { type: "image", data: result.data, mimeType: result.mimeType },
      ];
      if (result.revisedPrompt) {
        content.push({ type: "text", text: `Revised prompt: ${result.revisedPrompt}` });
      }

      return { content };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Image generation failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ── list_providers ──

server.tool(
  "list_image_providers",
  "List available image generation providers and their configuration status.",
  {},
  async () => {
    if (backends.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              "No image generation providers configured.",
              "",
              "Set one or more environment variables:",
              "  OPENAI_API_KEY  — OpenAI gpt-image-1 / DALL-E 3",
              "  XAI_API_KEY     — xAI Grok image generation",
              "  GOOGLE_API_KEY  — Google Imagen",
            ].join("\n"),
          },
        ],
      };
    }

    const lines = backends.map(
      (b) => `${b.name}\n  id: ${b.id}\n  models: ${b.models.join(", ")}\n  default: ${b.defaultModel}`
    );
    return {
      content: [{ type: "text", text: `${backends.length} provider(s) available:\n\n${lines.join("\n\n")}` }],
    };
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
