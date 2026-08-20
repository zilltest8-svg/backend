/**
 * Vercel serverless entry for the attendance proxy.
 *
 * One function serves every `/api/punch/*` route; the shared logic lives in
 * `server/core.mjs` so this host and the local Node server in
 * `server/index.mjs` can never drift apart.
 *
 * Note there is no in-memory state here on purpose — Vercel runs several
 * instances and discards them freely, so the session is sealed into the cookie
 * instead. See `seal()` in the core.
 */
import { handle } from "../../server/core.mjs";

export default async function punch(req, res) {
  // `[route].js` gives the last path segment; Vercel passes it in req.query.
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route;

  try {
    const result = await handle(route, req.method, req.headers.cookie, async () => {
      // Vercel parses JSON bodies already, but a string arrives when the
      // content-type was not JSON — accept both rather than throwing.
      if (typeof req.body === "string") {
        try {
          return JSON.parse(req.body || "{}");
        } catch {
          return {};
        }
      }
      return req.body ?? {};
    });

    if (!result) {
      res.status(404).json({ error: `No route for ${req.method} /api/punch/${route ?? ""}` });
      return;
    }

    if (result.cookie) res.setHeader("Set-Cookie", result.cookie);
    res.setHeader("Cache-Control", "no-store");
    res.status(result.status).json(result.body);
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    const message = err instanceof Error ? err.message : "Unexpected proxy error";
    res
      .status(timedOut ? 504 : 500)
      .json({ error: timedOut ? "The HR API did not respond in time." : message });
  }
}
