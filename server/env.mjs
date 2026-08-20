/**
 * Loads `.env` into `process.env` for local development.
 *
 * Node does not read `.env` on its own, so without this the file is inert and
 * PUNCH_SECRET looks unset however carefully it was written.
 *
 * Imported for its side effect, and it must come BEFORE `core.mjs` — that
 * module reads its configuration at import time, and ES modules execute in the
 * order they are written.
 *
 * Hosted environments (Vercel and friends) inject real environment variables
 * and ship no `.env`, so a missing file is the normal case there, not an error.
 * Anything already in the environment wins: `PORT=8788 npm run server` should
 * not be silently overridden by a stale line in a file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = resolve(fileURLToPath(new URL("../", import.meta.url)), ".env");

try {
  for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;

    const eq = text.indexOf("=");
    if (eq <= 0) continue;

    const name = text.slice(0, eq).trim();
    // Strip one layer of matching quotes, so `X="value"` and `X=value` agree.
    const value = text
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");

    if (!(name in process.env)) process.env[name] = value;
  }
} catch (err) {
  // ENOENT is expected in production; anything else is worth knowing about.
  if (err.code !== "ENOENT") console.warn("Could not read .env:", err.message);
}
