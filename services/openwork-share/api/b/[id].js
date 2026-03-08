import { fetchBundleJsonById } from "../_lib/blob-store.js";
import { buildStatusMarkup, setCors } from "../_lib/share-utils.js";
import { renderBundlePage, wantsDownload, wantsJsonResponse } from "./render-bundle-page.js";

function sendNotFound(req, res) {
  if (wantsJsonResponse(req)) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(404).send(
    buildStatusMarkup({
      title: "Bundle not found",
      description: "This share link does not exist anymore, or the bundle id is invalid.",
      actionHref: "/",
      actionLabel: "Package another worker",
    }),
  );
}

export default async function handler(req, res) {
  setCors(res, { methods: "GET,OPTIONS", headers: "Content-Type,Accept" });
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const id = String(req.query?.id ?? "").trim();
  if (!id) {
    res.status(400).json({ message: "id is required" });
    return;
  }

  try {
    const { blob, rawBuffer, rawJson } = await fetchBundleJsonById(id);

    const serveJson = wantsJsonResponse(req);
    res.setHeader("Vary", "Accept");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (serveJson) {
      res.setHeader("Content-Type", blob.contentType || "application/json");
      if (wantsDownload(req)) {
        res.setHeader("Content-Disposition", `attachment; filename="openwork-bundle-${id}.json"`);
      }
      res.status(200).send(rawBuffer);
      return;
    }

    const html = renderBundlePage({ id, rawJson, req });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch {
    sendNotFound(req, res);
  }
}
