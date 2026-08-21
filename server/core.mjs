/**
 * The proxy's logic, with no HTTP server attached.
 *
 * Two hosts import this: `server/index.mjs` (a long-running Node server, for
 * local development) and `api/punch/[...route].js` (Vercel serverless). Keeping
 * the behaviour in one place is the point — a fix applied to one host and not
 * the other is a bug that only shows up in production.
 *
 * Why a proxy exists at all:
 *
 *   1. CORS. `api.hr.zilmoney.com` only ever answers with
 *      `Access-Control-Allow-Origin: https://hr.zilmoney.com`. A Vite dev server
 *      on :5173, or a Vercel domain, gets a preflight back with no allow-origin
 *      header, so fetch never runs.
 *   2. The credential. Sign-in returns no token in its body — the thing that
 *      authenticates the next call is a session cookie, and that must not be
 *      readable by the page.
 *
 * Zero dependencies: Node 18+ has `fetch`, and `node:crypto` seals the session.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * `??` alone is wrong here: it falls back on null and undefined but not on "",
 * and a variable added in a hosting dashboard with the value left blank arrives
 * as an empty string. That silently wiped the default and left fetch() with an
 * empty URL — "Failed to parse URL from" — rather than any hint at the cause.
 */
const env = (name, fallback) => {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value.trim();
};

export const UPSTREAM = env("PUNCH_API_BASE", "https://api.hr.zilmoney.com").replace(/\/+$/, "");

// An upstream that is not absolute cannot be fetched, and the failure surfaces
// far from its cause. Say so here instead.
if (!/^https?:\/\//i.test(UPSTREAM)) {
  throw new Error(
    `PUNCH_API_BASE must be an absolute http(s) URL — got "${UPSTREAM}". ` +
      "Either unset it to use the default, or give it a full URL.",
  );
}
export const LOGIN_PATH = env("PUNCH_LOGIN_PATH", "/api/auth/login");
export const SYNC_PATH = env("PUNCH_SYNC_PATH", "/api/attendance/my-sync");
export const SYNC_STATUS_PATH = env("PUNCH_SYNC_STATUS_PATH", "/api/attendance/my-sync-status");
export const TODAY_PATH = env("PUNCH_TODAY_PATH", "/api/attendance/my-today");

const TTL = Number(env("SESSION_TTL_HOURS", 8)) * 3600_000;
const SECURE = env("COOKIE_SECURE", "") === "1" || Boolean(process.env.VERCEL);
export const COOKIE = "punch_sid";

/* ------------------------------------------------------------------ sessions */

/**
 * The session travels in the cookie itself, sealed with AES-256-GCM.
 *
 * Serverless has no memory to share: a `Map` on one instance is absent from the
 * next, so a server-side store would drop sessions at random. Sealing the state
 * into the cookie makes every instance able to read it without any shared
 * storage — and it survives restarts, which the Map never did.
 *
 * The browser still cannot read any of it: the cookie is httpOnly, and its
 * contents are ciphertext that only PUNCH_SECRET opens. GCM's tag means a
 * tampered cookie fails to decrypt rather than being trusted.
 */
const SECRET = env("PUNCH_SECRET", "");

function key() {
  if (!SECRET) {
    throw new Error(
      "PUNCH_SECRET is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
        "and set it in the environment (Vercel: Project Settings -> Environment Variables).",
    );
  }
  // Any passphrase length becomes a 32-byte key; a hex secret is used as-is.
  return /^[0-9a-f]{64}$/i.test(SECRET)
    ? Buffer.from(SECRET, "hex")
    : createHash("sha256").update(SECRET).digest();
}

export function seal(session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(value) {
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const session = JSON.parse(json);
    // An expiry inside the sealed payload cannot be edited by the browser, so
    // it is the one that counts — the cookie's own Max-Age is only a hint.
    if (!session?.expires || session.expires <= Date.now()) return null;
    return session;
  } catch {
    // Wrong key, tampered ciphertext, or an old cookie shape. All mean "no session".
    return null;
  }
}

// Built from COOKIE rather than written out again: two copies of the name is
// one rename away from a proxy that sets a cookie it then cannot read.
const COOKIE_RE = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)");

export function readSession(cookieHeader) {
  const hit = COOKIE_RE.exec(cookieHeader ?? "");
  return hit ? unseal(decodeURIComponent(hit[1])) : null;
}

export const cookieFor = (value, maxAge) =>
  COOKIE +
  "=" +
  value +
  "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
  maxAge +
  (SECURE ? "; Secure" : "");

/* --------------------------------------------------------------- upstream io */

/**
 * Cookies the HR API set, as a plain object so it survives JSON round-tripping
 * through the sealed session. (A Map would serialise to `{}`.)
 */
export function jarFrom(headers, into = {}) {
  const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // An expiry in the past is the API clearing that cookie, not setting it.
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) delete into[name];
    else into[name] = value;
  }
  return into;
}

const jarToHeader = (jar) =>
  Object.entries(jar ?? {})
    .map(([name, value]) => name + "=" + value)
    .join("; ");

export async function upstream(path, { method = "POST", token, jar, body, query } = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20_000);
  const cookie = jar && Object.keys(jar).length ? jarToHeader(jar) : null;
  // Laravel pairs the XSRF-TOKEN cookie with an X-XSRF-TOKEN header on writes,
  // and rejects the request as a token mismatch when only the cookie is sent.
  const xsrf = jar?.["XSRF-TOKEN"];
  // my-today and my-sync-status are GET-only — a POST comes back 405 — so a
  // body and a Content-Type are only attached when there is one to send.
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

/* ------------------------------------------------------------------- helpers */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The token comes back under a different key depending on which Laravel starter
 * the HR app was built from, so accept any of the usual ones. This API happens
 * to send none, and authenticates by cookie instead.
 */
//added data
function pluckToken(payload) {
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return null;
    seen.add(node);
    for (const k of ["token", "access_token", "accessToken", "api_token", "plainTextToken", "bearer"]) {
      if (typeof node[k] === "string" && node[k].length > 8) return node[k];
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
  return { name: name ?? null, email: email ?? null, employeeId: employee_id ?? staff_id ?? id ?? null };
}

/** Names the keys that came back, so a shape mismatch says what to look for. */
const keyList = (payload) =>
  payload && typeof payload === "object" ? Object.keys(payload).join(", ") || "none" : typeof payload;

/* -------------------------------------------------------------------- routes */

/**
 * Every route returns the same shape — `{status, body, cookie?}` — so the two
 * hosts only have to translate it into their own response object.
 */

export async function login(body) {
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return { status: 400, body: { error: "Email and password are both required." } };
  }

  const out = await upstream(LOGIN_PATH, { body: { email, password } });
  if (out.status === 401 || out.status === 422) {
    return {
      status: 401,
      body: { error: out.json?.error ?? out.json?.message ?? "Incorrect email or password." },
    };
  }
  if (out.status >= 400) {
    return { status: 502, body: { error: "HR API rejected the sign-in (HTTP " + out.status + ")." } };
  }

  // Three places the credential can arrive: the body, the Authorization header,
  // or — as this API does it — a session cookie. Any one is enough.
  const header = out.headers?.get("authorization");
  const token = pluckToken(out.json) ?? (header ? header.replace(/^Bearer\s+/i, "") : null);
  const jar = jarFrom(out.headers);

  if (!token && Object.keys(jar).length === 0) {
    return {
      status: 502,
      body: {
        error:
          "Signed in, but the HR API returned no token and set no cookie, so there is nothing " +
          "to authenticate the next request with. Body keys: " + keyList(out.json) + ".",
      },
    };
  }

  // The credential's own lifetime wins when it is shorter than ours — holding a
  // session open past the point it works just produces a confusing 401.
  const expiresIn = Number(out.json?.expires_in);
  const life = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(TTL, expiresIn * 1000) : TTL;
  const user = pluckUser(out.json);

  return {
    status: 200,
    body: { authenticated: true, user },
    cookie: cookieFor(seal({ token, jar, user, expires: Date.now() + life }), Math.floor(life / 1000)),
  };
}

export const session = (cookieHeader) => {
  const s = readSession(cookieHeader);
  return { status: 200, body: { authenticated: Boolean(s), user: s?.user ?? null } };
};

export const logout = () => ({
  status: 200,
  body: { authenticated: false },
  cookie: cookieFor("", 0),
});

/**
 * Calls the HR API on a session's behalf. Returns `{status, body, cookie?}`
 * either way, re-sealing the session when the upstream rotated its cookies.
 */
async function relay(cookieHeader, path, options) {
  const current = readSession(cookieHeader);
  if (!current) return { status: 401, body: { error: "Not signed in." } };

  const out = await upstream(path, { token: current.token, jar: current.jar, ...options });

  // Laravel rotates its session cookie, so fold whatever came back into the jar
  // rather than replaying the login's copy until it goes stale.
  const jar = jarFrom(out.headers, { ...current.jar });
  const rotated = JSON.stringify(jar) !== JSON.stringify(current.jar);

  if (out.status === 401 || out.status === 419) {
    return {
      status: 401,
      body: { error: "Session expired — sign in again." },
      cookie: cookieFor("", 0),
    };
  }
  if (out.status >= 400) {
    return {
      status: 502,
      body: { error: out.json?.message ?? "HR API returned HTTP " + out.status + ".", status: out.status },
    };
  }

  const remaining = Math.floor((current.expires - Date.now()) / 1000);
  return {
    out,
    ...(rotated && remaining > 0
      ? { cookie: cookieFor(seal({ ...current, jar }), remaining) }
      : {}),
  };
}

/** Pulls records off the punch devices for a range. Returns a report, not punches. */
export async function sync(cookieHeader, body) {
  const start = String(body.start_date ?? "");
  const end = String(body.end_date ?? "");
  if (!DATE.test(start) || !DATE.test(end)) {
    return { status: 400, body: { error: "start_date and end_date must both be YYYY-MM-DD." } };
  }
  if (start > end) return { status: 400, body: { error: "start_date must not be after end_date." } };

  const r = await relay(cookieHeader, SYNC_PATH, { body: { start_date: start, end_date: end } });
  if (!r.out) return r;
  return { status: 200, body: { data: r.out.json, range: { start_date: start, end_date: end } }, cookie: r.cookie };
}

export async function syncStatus(cookieHeader) {
  const r = await relay(cookieHeader, SYNC_STATUS_PATH, { method: "GET" });
  if (!r.out) return r;
  return { status: 200, body: { data: r.out.json }, cookie: r.cookie };
}

/** Today's punches — the only one of the three that carries attendance data. */
export async function today(cookieHeader) {
  const r = await relay(cookieHeader, TODAY_PATH, { method: "GET" });
  if (!r.out) return r;
  return { status: 200, body: { data: r.out.json }, cookie: r.cookie };
}

/**
 * Dispatches one request. `route` is the part after `/api/punch/`.
 * Returns `{status, body, cookie?}`; `null` when nothing matches.
 */
export async function handle(route, method, cookieHeader, readBody) {
  if (route === "login" && method === "POST") return login(await readBody());
  if (route === "session" && method === "GET") return session(cookieHeader);
  if (route === "logout" && method === "POST") return logout();
  if (route === "today" && method === "GET") return today(cookieHeader);
  if (route === "sync" && method === "POST") return sync(cookieHeader, await readBody());
  if (route === "sync-status" && method === "GET") return syncStatus(cookieHeader);
  return null;
}
