/**
 * Minimal Den API stub for the onboarding-feedback-fixes flow: a signed-in
 * member of an org with one managed LLM provider. Import { startDenStub }
 * from the flow, or run standalone next to the app under test:
 *
 *   node evals/flows/lib/den-onboarding-stub.mjs   # listens on 127.0.0.1:18975
 */
import { createServer } from "node:http";

export const DEN_STUB_PORT = 18975;
export const DEN_STUB_ORG_NAME = "Eval Org";
export const DEN_STUB_PROVIDER_NAME = "Acme AI Gateway";
export const DEN_STUB_PROVIDER_ID = "lpr_evalorg";
/** models[0] — the one "Use as default" picks. */
export const DEN_STUB_FIRST_MODEL_ID = "glm-5.2-turbo";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept, x-openwork-legacy-org-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const PROVIDER = {
  id: DEN_STUB_PROVIDER_ID,
  source: "custom",
  providerId: "zai",
  name: DEN_STUB_PROVIDER_NAME,
  providerConfig: {},
  hasApiKey: true,
  models: [
    { id: DEN_STUB_FIRST_MODEL_ID, name: "GLM 5.2 Turbo", config: {} },
    { id: "glm-5.2", name: "GLM 5.2", config: {} },
    { id: "glm-5.2-air", name: "GLM 5.2 Air", config: {} },
  ],
  createdAt: null,
  updatedAt: null,
};

export function startDenStub(port = DEN_STUB_PORT) {
  const server = createServer((req, res) => {
    const respond = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    // The den client requests API routes under the `/api/den` proxy prefix.
    const rawPathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const pathname = rawPathname.replace(/^\/api\/den(?=\/)/, "");
    if (req.method === "GET" && pathname === "/v1/me") {
      respond(200, { user: { id: "usr_eval", email: "jonas@example.com", name: "Jonas Nielsen" } });
      return;
    }
    if (req.method === "GET" && pathname === "/v1/llm-providers") {
      respond(200, { llmProviders: [PROVIDER] });
      return;
    }
    if (req.method === "GET" && pathname === "/v1/marketplaces") {
      respond(200, { items: [] });
      return;
    }
    respond(404, { error: "not_found", message: `no stub for ${req.method} ${pathname}` });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startDenStub();
  console.log(`den onboarding stub listening on http://127.0.0.1:${DEN_STUB_PORT}`);
}
