import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Admin authentication for the showcase deployment.
 *
 * There is no user database, so this is deliberately small and secure enough
 * for a demo: an `ADMIN_PASSWORD` env var gates entry, and a successful login
 * sets an httpOnly, HMAC-signed, expiring session cookie. Every admin mutation
 * API verifies that cookie server-side — there is no unprotected CRUD endpoint
 * and no credential ever reaches the browser.
 *
 * Server-only (`node:crypto`).
 */

export const ADMIN_COOKIE = "asqdevs_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ADMIN_COOKIE_MAX_AGE = Math.floor(TTL_MS / 1000);

function password(): string | undefined {
  return process.env.ADMIN_PASSWORD?.trim() || undefined;
}

/** The HMAC key. A dedicated secret is preferred; fall back to the password. */
function secret(): string | undefined {
  return process.env.ADMIN_SESSION_SECRET?.trim() || password();
}

/** True when an admin password has been configured for this deployment. */
export function adminConfigured(): boolean {
  return Boolean(password());
}

function sign(value: string): string | undefined {
  const key = secret();
  if (!key) return undefined;
  return createHmac("sha256", key).update(value).digest("base64url");
}

/** Mint a signed session token, or undefined when auth is not configured. */
export function issueSession(): string | undefined {
  if (!secret()) return undefined;
  const payload = `${randomUUID()}.${Date.now() + TTL_MS}`;
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  const signature = sign(encoded);
  if (!signature) return undefined;
  return `${encoded}.${signature}`;
}

/** Verify a session token's signature and expiry. */
export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  const expected = sign(encoded);
  if (!expected) return false;

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;

  try {
    const [id, expiry] = Buffer.from(encoded, "base64url")
      .toString("utf-8")
      .split(".");
    return Boolean(id) && Number(expiry) > Date.now();
  } catch {
    return false;
  }
}

/** Constant-time password check. */
export function checkPassword(candidate: unknown): boolean {
  const expected = password();
  if (!expected || typeof candidate !== "string") return false;
  const given = Buffer.from(candidate);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** Read one cookie value from a raw `Cookie` header. */
export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** True when the request carries a valid admin session. */
export function isAdminRequest(request: Request): boolean {
  return verifySession(readCookie(request.headers.get("cookie"), ADMIN_COOKIE));
}
