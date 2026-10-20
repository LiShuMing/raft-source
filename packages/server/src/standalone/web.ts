import express, { type Express } from "express";
import path from "node:path";
import { readFileSync } from "node:fs";

/** Mount after API routes and before JSON 404. Unknown API/assets never return the SPA. */
export function mountStandaloneWeb(app: Express, distDir: string): void {
  const html = readFileSync(path.join(distDir, "index.html"), "utf8")
    .replace(/<head(\s[^>]*)?>/i, '$&<meta name="raft-deployment-mode" content="standalone">');
  const serveIndex: express.RequestHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(html);
  };
  app.get("/index.html", serveIndex);
  app.use(express.static(distDir, { index: false }));
  app.get("/{*path}", (req, res, next) => {
    if (/^\/(api|internal|daemon|socket\.io)(\/|$)/.test(req.path)
      || path.extname(req.path) || !req.accepts("html")) {
      next();
      return;
    }
    serveIndex(req, res, next);
  });
}
