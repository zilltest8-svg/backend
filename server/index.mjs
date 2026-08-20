/**
 * Attendance proxy for the HR API.
 *
 * It exists for two reasons, both of which rule out calling the HR API straight
 * from the browser:
 *
 *   1. CORS. `api.hr.zilmoney.com` only ever answers with
 *      `Access-Control-Allow-Origin: https://hr.zilmoney.com`. A Vite dev server
 *      on :5173, or the single-file build opened over file:// (Origin `null`),
 *      gets a preflight back with no allow-origin header, so fetch never runs.
 *   2. The bearer token. Login is exchanged for a Sanctum token that must not
 *      live anywhere the page can read it. It is held here, in memory, keyed by
 *      an opaque httpOnly cookie — the browser only ever sees the cookie.
 *
 * Zero dependencies: Node 18+ has `fetch` and everything else this needs.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST = join(ROOT, "dist");

const UPSTREAM = (process.env.PUNCH_API_BASE ?? "https://api.hr.zilmoney.com").replace(/\/+$/, "");
const PORT = Number(process.env.PORT ?? 8787);
const TTL = Number(process.env.SESSION_TTL_HOURS ?? 8) * 3600_000;
/** Set to 1 behind an HTTPS terminator so the session cookie is marked Secure. */
const SECURE = process.env.COOKIE_SECURE === "1";

const COOKIE = "punch_sid";
const LOGIN_PATH = process.env.PUNCH_LOGIN_PATH ?? "/api/auth/login";
/**
 * Three upstream routes, and it matters which does what:
 *   my-sync         POST — pulls records off the punch devices into HR and
 *                   reports what it added. Not a source of attendance data.
 *   my-sync-status  GET  — where the last pull got to.
 *   my-today        GET  — today's punches. This is the one that has the data,
 *                   and it answers in the same shape the app already parses.
 */
const SYNC_PATH = process.env.PUNCH_SYNC_PATH ?? "/api/attendance/my-sync";
const SYNC_STATUS_PATH = process.env.PUNCH_SYNC_STATUS_PATH ?? "/api/attendance/my-sync-status";
const TODAY_PATH = process.env.PUNCH_TODAY_PATH ?? "/api/attendance/my-today";

/* ------------------------------------------------------------------ sessions */

/** sid -> { token, user, expires }. In memory on purpose: a restart signs everyone out. */
const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires <= now) sessions.delete(sid);
}, 600_000).unref();

// Built from COOKIE rather than written out again: two copies of the name is
// one rename away from a proxy that sets a cookie it then cannot read.
const COOKIE_RE = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)");

function readSession(req) {
  const hit = COOKIE_RE.exec(req.headers.cookie ?? "");
  if (!hit) return null;
  const sid = decodeURIComponent(hit[1]);
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expires <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

const cookieFor = (sid, maxAge) =>
  COOKIE + "=" + sid + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge + (SECURE ? "; Secure" : "");

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The token comes back under a different key depending on which Laravel starter
 * the HR app was built from, so accept any of the usual ones rather than
 * guessing one and failing at runtime.
 */
function pluckToken(payload) {
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return null;
    seen.add(node);
    for (const key of ["token", "access_token", "accessToken", "api_token", "plainTextToken", "bearer"]) {
      const value = node[key];
      if (typeof value === "string" && value.length > 8) return value;
    }
    for (const value of Object.values(node)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, 0);
}

function pluckUser(payload) {
  const candidate = payload?.user ?? payload?.data?.user ?? payload?.data ?? null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const { name, email, employee_id, staff_id, id } = candidate;
  if (!name && !email) return null;
  // Only what the header line displays — the avatar, roles and staff linkage the
  // HR API also returns have no business being copied to the browser.
  return {
    name: name ?? null,
    email: email ?? null,
    employeeId: employee_id ?? staff_id ?? id ?? null,
  };
}

/** Names the keys that came back, so a shape mismatch says what to look for. */
const keyList = (payload) =>
  payload && typeof payload === "object" ? Object.keys(payload).join(", ") || "none" : typeof payload;

/** One place that talks to the HR API, so timeouts and JSON parsing stay uniform. */
/**
 * Cookies the HR API set, as a `name -> value` map.
 *
 * The login response carries no token in its body — only `token_type`,
 * `expires_in` and `user` — so the credential it actually issues is a session
 * cookie. This is the same thing the browser was replaying when the request
 * "worked in DevTools": the HR portal had already been signed into.
 */
function jarFrom(headers, into = new Map()) {
  const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // An expiry in the past is the API clearing that cookie, not setting it.
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) into.delete(name);
    else into.set(name, value);
  }
  return into;
}

const jarToHeader = (jar) =>
  [...jar].map(([name, value]) => name + "=" + value).join("; ");

async function upstream(path, { method = "POST", token, jar, body, query }) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20_000);
  const cookie = jar && jar.size ? jarToHeader(jar) : null;
  // Laravel pairs the XSRF-TOKEN cookie with an X-XSRF-TOKEN header on writes,
  // and rejects the request as a token mismatch when only the cookie is sent.
  const xsrf = jar?.get("XSRF-TOKEN");
  // my-sync-status is GET-only — a POST to it comes back 405 — so a body and a
  // Content-Type are only attached when there is actually one to send.
  const sends = method !== "GET" && method !== "HEAD";
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";

  try {
    const res = await fetch(UPSTREAM + path + qs, {
      method,
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(sends ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {}),
      },
      ...(sends ? { body: JSON.stringify(body) } : {}),
      signal: control.signal,
      redirect: "manual",
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* upstream sent HTML — surface the status rather than crashing on parse */
    }
    return { status: res.status, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- routing */

async function handleLogin(req, res) {
  const body = await readJson(req);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return send(res, 400, { error: "Email and password are both required." });

  const out = await upstream(LOGIN_PATH, { body: { email, password } });
  if (out.status === 401 || out.status === 422) {
    return send(res, 401, { error: out.json?.error ?? out.json?.message ?? "Incorrect email or password." });
  }
  if (out.status >= 400) {
    return send(res, 502, { error: "HR API rejected the sign-in (HTTP " + out.status + ")." });
  }

  // Three places the credential can arrive, in order of preference: the body,
  // the Authorization header, or — as this API actually does it — a session
  // cookie. Any one of them is enough to call my-sync afterwards.
  const header = out.headers?.get("authorization");
  const token = pluckToken(out.json) ?? (header ? header.replace(/^Bearer\s+/i, "") : null);
  const jar = jarFrom(out.headers);

  if (!token && jar.size === 0) {
    return send(res, 502, {
      error:
        "Signed in, but the HR API returned no token and set no cookie, so there is " +
        "nothing to authenticate the next request with. Body keys: " +
        keyList(out.json) +
        ".",
    });
  }

  // The token's own lifetime wins when it is shorter than ours — holding a
  // session open past the point the token works just produces a confusing 401.
  const expiresIn = Number(out.json?.expires_in);
  const life = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(TTL, expiresIn * 1000) : TTL;

  const sid = randomBytes(32).toString("base64url");
  const user = pluckUser(out.json);
  // Both the token and the cookie jar stay here. Neither is ever serialised into
  // a response, so the page has no way to read either one.
  sessions.set(sid, { token, jar, user, expires: Date.now() + life });
  // The token stays in `sessions`; the response carries only the cookie and,
  // at most, a display name.
  send(res, 200, { authenticated: true, user }, { "Set-Cookie": cookieFor(sid, Math.floor(life / 1000)) });
}

/** Runs a device pull for a date range. Returns the sync report, not punches. */
async function handleSync(req, res) {
  const session = readSession(req);
  if (!session) return send(res, 401, { error: "Not signed in." });

  const body = await readJson(req);
  const start = String(body.start_date ?? "");
  const end = String(body.end_date ?? "");
  if (!DATE.test(start) || !DATE.test(end)) {
    return send(res, 400, { error: "start_date and end_date must both be YYYY-MM-DD." });
  }
  if (start > end) return send(res, 400, { error: "start_date must not be after end_date." });

  const out = await relay(res, session, SYNC_PATH, {
    body: { start_date: start, end_date: end },
  });
  if (out) send(res, 200, { data: out.json, range: { start_date: start, end_date: end } });
}

async function handleSyncStatus(req, res) {
  const session = readSession(req);
  if (!session) return send(res, 401, { error: "Not signed in." });

  // GET-only upstream, and it takes no parameters — it reports where the last
  // sync got to rather than returning punches for a range.
  const out = await relay(res, session, SYNC_STATUS_PATH, { method: "GET" });
  if (out) send(res, 200, { data: out.json });
}

/** Today's punches — GET-only, and the only one of the three that has data. */
async function handleToday(req, res) {
  const session = readSession(req);
  if (!session) return send(res, 401, { error: "Not signed in." });

  const out = await relay(res, session, TODAY_PATH, { method: "GET" });
  if (out) send(res, 200, { data: out.json });
}

/**
 * Calls the HR API on a session's behalf and answers the failures the same way
 * everywhere. Returns null once it has already written a response, so callers
 * only have to handle the success case.
 */
async function relay(res, session, path, options) {
  const out = await upstream(path, { token: session.token, jar: session.jar, ...options });

  // Laravel rotates its session cookie, so fold whatever came back into the jar
  // rather than replaying the login's copy until it goes stale.
  if (session.jar) jarFrom(out.headers, session.jar);

  if (out.status === 401 || out.status === 419) {
    sessions.delete(session.sid);
    send(res, 401, { error: "Session expired — sign in again." }, { "Set-Cookie": cookieFor("", 0) });
    return null;
  }
  if (out.status >= 400) {
    send(res, 502, {
      error: out.json?.message ?? "HR API returned HTTP " + out.status + ".",
      status: out.status,
    });
    return null;
  }
  return out;
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
    if (path === "/api/punch/login" && req.method === "POST") return await handleLogin(req, res);
    if (path === "/api/punch/sync" && req.method === "POST") return await handleSync(req, res);
    if (path === "/api/punch/sync-status" && req.method === "GET") return await handleSyncStatus(req, res);
    if (path === "/api/punch/today" && req.method === "GET") return await handleToday(req, res);

    if (path === "/api/punch/session" && req.method === "GET") {
      const session = readSession(req);
      return send(res, 200, { authenticated: Boolean(session), user: session?.user ?? null });
    }

    if (path === "/api/punch/logout" && req.method === "POST") {
      const session = readSession(req);
      if (session) sessions.delete(session.sid);
      return send(res, 200, { authenticated: false }, { "Set-Cookie": cookieFor("", 0) });
    }

    if (path.startsWith("/api/")) return send(res, 404, { error: "No route for " + req.method + " " + path });
    return await serveStatic(req, res);
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    const message = err instanceof Error ? err.message : "Unexpected proxy error";
    send(res, timedOut ? 504 : 500, { error: timedOut ? "The HR API did not respond in time." : message });
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
});
