import type { ReloadReason } from "./types";

export type OpenWorkExtensionSourceFormat =
  | "openwork-builtin"
  | "openwork-extension-manifest"
  | "claude-plugin"
  | "opencode-plugin"
  | "mcp-directory"
  | "manual";

export type OpenWorkExtensionSource = {
  format: OpenWorkExtensionSourceFormat;
  trusted: boolean;
  origin?: "builtin" | "den" | "workspace" | "local";
  reference?: string;
};

export type OpenWorkExtensionResourceType =
  | "skill"
  | "agent"
  | "command"
  | "tool"
  | "mcp"
  | "opencode-plugin"
  | "provider"
  | "hook"
  | "context"
  | "secret"
  | "file"
  | "local-service"
  | "native-binary";

export type OpenWorkExtensionResource = {
  type: OpenWorkExtensionResourceType;
  id: string;
  label?: string;
  description?: string;
  path?: string;
  command?: string[];
  envKey?: string;
  packageName?: string;
  providerId?: string;
  mcpServerName?: string;
  required?: boolean;
};

export type OpenWorkExtensionContributionType =
  | "settings-panel"
  | "setup-instructions"
  | "composer-prompt"
  | "session-side-panel"
  | "session-rail-item"
  | "control-actions"
  | "server-route"
  | "native-capability"
  | "test-action";

export type OpenWorkExtensionContribution = {
  type: OpenWorkExtensionContributionType;
  ref?: string;
  label?: string;
  description?: string;
  prompt?: string;
  location?: "settings-detail" | "composer" | "session-right-pane" | "session-rail" | "server" | "native";
};

export type OpenWorkExtensionSetup = {
  instructions?: string;
  primaryCta?: string;
  secondaryCta?: string;
  requiredEnv?: string[];
  testActionRef?: string;
};

export type OpenWorkExtensionLifecycle = {
  reload?: ReloadReason[];
  detection?: string[];
};

export type OpenWorkExtensionManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  source: OpenWorkExtensionSource;
  icon?: {
    src?: string;
    simpleIconSlug?: string;
  };
  composer?: {
    prompt: string;
  };
  setup?: OpenWorkExtensionSetup;
  resources: OpenWorkExtensionResource[];
  contributions?: OpenWorkExtensionContribution[];
  lifecycle?: OpenWorkExtensionLifecycle;
  defaultEnabled?: boolean;
  platform?: Array<"darwin" | "linux" | "windows" | "web">;
};

export function extensionContribution(
  manifest: OpenWorkExtensionManifest | undefined,
  type: OpenWorkExtensionContributionType,
): OpenWorkExtensionContribution | undefined {
  return manifest?.contributions?.find((contribution) => contribution.type === type);
}

export function isTrustedBuiltInExtension(manifest: OpenWorkExtensionManifest | undefined): boolean {
  return manifest?.source.origin === "builtin" && manifest.source.trusted;
}

export const BUILT_IN_OPENWORK_EXTENSION_MANIFESTS: OpenWorkExtensionManifest[] = [
  {
    schemaVersion: 1,
    id: "openwork-browser",
    name: "OpenWork Browser",
    description: "Automate the built-in browser panel that stays visible inside OpenWork.",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/openwork-mark.svg" },
    composer: { prompt: "Use the OpenWork Browser extension to " },
    setup: {
      instructions: "OpenWork Browser is ready by default in desktop workspaces.",
      primaryCta: "Enable browser automation",
    },
    resources: [
      {
        type: "opencode-plugin",
        id: "opencode-chrome-devtools",
        packageName: "opencode-chrome-devtools",
        required: true,
      },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.browser.settings", location: "settings-detail" },
      { type: "session-side-panel", ref: "openwork.browser.panel", location: "session-right-pane" },
      { type: "composer-prompt", prompt: "Use the OpenWork Browser extension to ", location: "composer" },
    ],
    lifecycle: { reload: ["plugins", "agents"], detection: ["plugin:opencode-chrome-devtools"] },
    defaultEnabled: true,
  },
  {
    schemaVersion: 1,
    id: "openai-image-gen",
    name: "OpenAI Image Gen",
    description: "Generate image artifacts with gpt-image-2.",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/ext-openai.svg" },
    composer: { prompt: "Use the OpenAI Image Gen extension to " },
    setup: {
      instructions: "Add an OpenAI API key, then OpenWork installs an OpenCode plugin that exposes image_generate.",
      primaryCta: "Enable image generation",
      secondaryCta: "Generate test image",
      requiredEnv: ["OPENAI_API_KEY"],
      testActionRef: "openwork.imageGen.testGenerate",
    },
    resources: [
      { type: "opencode-plugin", id: "openwork-image-generation", path: ".opencode/plugins/openwork-image-generation.ts", required: true },
      { type: "secret", id: "openai-api-key", envKey: "OPENAI_API_KEY", required: true },
      { type: "file", id: "openai-image-config", path: ".opencode/openwork-extensions/openai-image-generation.json", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.imageGen.settings", location: "settings-detail" },
      { type: "test-action", ref: "openwork.imageGen.testGenerate", label: "Generate test image" },
      { type: "composer-prompt", prompt: "Use the OpenAI Image Gen extension to ", location: "composer" },
    ],
    lifecycle: { reload: ["plugins"], detection: ["plugin:openwork-image-generation"] },
  },
  {
    schemaVersion: 1,
    id: "ollama",
    name: "Ollama",
    description: "Local model provider at http://localhost:11434.",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/ext-ollama.svg" },
    composer: { prompt: "Use the Ollama extension to " },
    setup: {
      instructions: "Run Ollama locally, choose or pull a model, then add it as an OpenCode provider.",
      primaryCta: "Add Ollama model",
      secondaryCta: "Pull model",
    },
    resources: [
      { type: "local-service", id: "ollama-api", label: "Ollama API", description: "http://localhost:11434", required: true },
      { type: "provider", id: "ollama", providerId: "ollama", packageName: "@ai-sdk/openai-compatible", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.ollama.settings", location: "settings-detail" },
      { type: "test-action", ref: "openwork.ollama.listModels", label: "Check local models" },
      { type: "composer-prompt", prompt: "Use the Ollama extension to ", location: "composer" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:ollama"] },
  },
];
