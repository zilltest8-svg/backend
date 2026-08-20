/**
 * Local development server for the attendance proxy.
 *
 * Serves `/api/punch/*` and, in production, the built `dist/` alongside it on
 * one origin. All the actual logic is in `core.mjs`, which the Vercel functions
 * in `api/punch/` import too — this file is only the HTTP plumbing.
 *
 * Zero dependencies: Node 18+ has everything this needs.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Side-effect import, and it has to precede core.mjs — that module reads its
// configuration at import time, and ES modules execute in written order.
import "./env.mjs";
import { handle, UPSTREAM } from "./core.mjs";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8787);

/* --------------------------------------------------------------------- utils */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** Reject oversized bodies rather than buffering whatever arrives. */
function readJson(req, limit = 64 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        fail(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return ok({});
      try {
        ok(JSON.parse(text));
      } catch {
        fail(new Error("Body is not valid JSON"));
      }
    });
    req.on("error", fail);
  });
}

/* --------------------------------------------------- static files (production) */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  // normalize() collapses any `..`, and the prefix check rejects what escapes dist.
  const target = join(DIST, normalize(decodeURIComponent(url.pathname)));
  let path = target.startsWith(DIST) ? target : DIST;

  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
  } catch {
    path = join(DIST, "index.html"); // single-page fallback
  }

  try {
    const buf = await readFile(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    send(res, 404, { error: "Not found. Run `npm run build` first." });
  }
}

/* -------------------------------------------------------------------- server */

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  try {
    if (path.startsWith("/api/punch/")) {
      const route = path.slice("/api/punch/".length);
      const result = await handle(route, req.method, req.headers.cookie, () => readJson(req));
      if (!result) return send(res, 404, { error: `No route for ${req.method} ${path}` });
      return send(res, result.status, result.body, result.cookie ? { "Set-Cookie": result.cookie } : {});
    }

    if (path.startsWith("/api/")) return send(res, 404, { error: `No route for ${req.method} ${path}` });
    return await serveStatic(req, res);
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    const message = err instanceof Error ? err.message : "Unexpected proxy error";
    send(res, timedOut ? 504 : 500, {
      error: timedOut ? "The HR API did not respond in time." : message,
    });
  }
});

// Starting it twice is an ordinary thing to do — say so in one line rather than
// dumping a stack trace that reads like a crash.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      "Port " + PORT + " is already in use — the attendance proxy is most likely " +
        "already running.\nUse it as it is, or stop the other one and retry. " +
        "To run alongside it: PORT=8788 npm run server",
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log("attendance proxy  ->  http://localhost:" + PORT + "  (upstream " + UPSTREAM + ")");
  if (!process.env.PUNCH_SECRET) {
    console.warn(
      "\n  PUNCH_SECRET is not set — sign-in will fail.\n" +
        "  Generate one:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        "  Then:          PUNCH_SECRET=<value> npm run server   (or put it in .env)\n",
    );
  }
});
