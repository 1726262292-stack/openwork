import legacyHandler from "../../../server/v1/bundles.js";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  return legacyHandler(req, res);
}
