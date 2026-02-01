import http from "node:http";

import type { Logger } from "pino";

export type HealthSnapshot = {
  ok: boolean;
  opencode: {
    url: string;
    healthy: boolean;
    version?: string;
  };
  channels: {
    telegram: boolean;
    whatsapp: boolean;
  };
};

export type TelegramTokenResult = {
  configured: boolean;
  enabled: boolean;
};

export type HealthHandlers = {
  setTelegramToken?: (token: string) => Promise<TelegramTokenResult>;
};

export function startHealthServer(
  port: number,
  getStatus: () => HealthSnapshot,
  logger: Logger,
  handlers: HealthHandlers = {},
) {
  const server = http.createServer((req, res) => {
    void (async () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!req.url || req.url === "/health") {
        const snapshot = getStatus();
        res.writeHead(snapshot.ok ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(snapshot));
        return;
      }

      if (req.url === "/config/telegram-token" && req.method === "POST") {
        if (!handlers.setTelegramToken) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Not supported" }));
          return;
        }

        let raw = "";
        for await (const chunk of req) {
          raw += chunk.toString();
          if (raw.length > 1024 * 1024) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Payload too large" }));
            return;
          }
        }

        try {
          const payload = JSON.parse(raw || "{}");
          const token = typeof payload.token === "string" ? payload.token.trim() : "";
          if (!token) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Token is required" }));
            return;
          }

          const result = await handlers.setTelegramToken(token);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, telegram: result }));
          return;
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(error) }));
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    })().catch((error) => {
      logger.error({ error }, "health server request failed");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Internal error" }));
    });
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "health server listening");
  });

  return () => {
    server.close();
  };
}
