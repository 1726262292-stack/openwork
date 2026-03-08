import legacyHandler from "../../../server/v1/package.js";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  return legacyHandler(req, res);
}
