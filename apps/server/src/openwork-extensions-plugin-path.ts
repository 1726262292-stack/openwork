import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function pluginPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const extension = basename(here) === "dist" ? "js" : "ts";
  return join(here, "opencode-plugins", `${name}.${extension}`);
}

export const openworkExtensionsPreviewPluginPath = () => pluginPath("openwork-extensions-preview");
export const openworkCapabilitiesKnowledgePluginPath = () => pluginPath("openwork-capabilities-knowledge");
