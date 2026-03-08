import legacyHandler from "../../server/health.js";

export default async function handler(req, res) {
  return legacyHandler(req, res);
}
