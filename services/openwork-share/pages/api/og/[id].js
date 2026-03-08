import legacyHandler from "../../../server/og/[id].js";

export default async function handler(req, res) {
  return legacyHandler(req, res);
}
