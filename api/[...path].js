const { handleRequest } = require("../server");

function normalizeRewrittenUrl(req) {
  const path = req.query?.path;
  if (!path) return;

  const parts = Array.isArray(path) ? path : [path];
  const original = new URL(req.url, "https://cls.local");
  original.searchParams.delete("path");
  const query = original.searchParams.toString();
  req.url = `/api/${parts.map((part) => String(part).replace(/^\/+|\/+$/g, "")).join("/")}${query ? `?${query}` : ""}`;
}

module.exports = (req, res) => {
  normalizeRewrittenUrl(req);
  return handleRequest(req, res);
};
