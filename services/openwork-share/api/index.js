import { renderHomePage } from "./_lib/render-home-page.js";
import { setCors } from "./_lib/share-utils.js";

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

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderHomePage(req));
}
