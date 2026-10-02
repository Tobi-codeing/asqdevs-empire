/**
 * Gemini Live voice relay.
 *
 * The browser must never hold the permanent Gemini API key, and a browser
 * WebSocket cannot send an Authorization header. This process therefore holds
 * the key, admits only our own page via a short-lived HMAC ticket, and forwards
 * frames between the browser and the Live API unchanged.
 *
 * Two ways to run it:
 *
 *  1. Embedded — `server.mjs` attaches the same logic to the Next.js HTTP
 *     server, so the relay lives on the app's own origin (`npm run dev` /
 *     `npm run start`). Nothing to configure.
 *
 *  2. Standalone — `node relay.mjs` on a WebSocket-capable host (Railway,
 *     Render, Fly.io). This exists because serverless platforms such as Vercel
 *     cannot hold a WebSocket, so a Vercel deployment points at this service
 *     with `VOICE_RELAY_URL`.
 *
 * The shared functions below are the single implementation used by both modes.
 */

import { createServer } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path the browser opens for the Live socket. */
export const LIVE_PATH = "/api/gemini/live";
/** Path the app calls (server-to-server) to mint a connection ticket. */
export const TICKET_PATH = "/ticket";

const UPSTREAM_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Tickets are valid for one minute — long enough to open a socket, no longer. */
export const TICKET_TTL_MS = 60_000;

/**
 * Read `.env.local` then `.env` into `process.env`.
 *
 * `.env.local` wins, matching the Next.js convention. A variable the host has
 * already set is never overridden, so a platform's own env vars take priority.
 */
export function loadDotEnv(dir = __dirname) {
  try {
    const content = [".env.local", ".env"]
      .map((file) => {
        try {
          return readFileSync(path.join(dir, file), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match =
        trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) ??
        trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Missing env files are fine; the host may already supply every var.
  }
}

/** Mint one short-lived ticket bound to this boot's secret. */
export function createTicket(secret, ttlMs = TICKET_TTL_MS) {
  const payload = `${randomUUID()}|${Date.now() + ttlMs}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return {
    ticket: `${Buffer.from(payload).toString("base64url")}.${signature}`,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/** Verify a ticket's signature and expiry in constant time. */
export function verifyTicket(secret, ticket) {
  if (typeof ticket !== "string" || !ticket.includes(".")) return false;
  const [encoded, sig] = ticket.split(".");
  let payload;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [, expires] = payload.split("|");
  return Number(expires) > Date.now();
}

/**
 * Classify why the upstream Live socket closed, so the relay's logs distinguish
 * an exhausted quota from a bad key or a genuine network fault instead of
 * printing one opaque close code for every case.
 */
function classifyUpstreamClose(code, reason) {
  const text = String(reason ?? "");
  if (code === 429 || /quota|resource.?exhausted|rate.?limit/i.test(text))
    return "rate_limited";
  if (
    code === 1008 ||
    code === 1007 ||
    /api key|permission|unauthor/i.test(text)
  )
    return "auth_rejected";
  if (code === 1011 || /internal|unavailable|overload/i.test(text))
    return "upstream_error";
  return "upstream_closed";
}

/**
 * Pipe one browser socket to one upstream Live socket, and back.
 *
 * A close is logged with a classified reason. There is deliberately no
 * automatic reconnect here: a failed turn must surface to the caller, and a
 * tight relay-level retry loop is exactly what turns a quota error into a storm
 * of requests.
 */
export function pipeToGemini(client, apiKey, label = "voice-relay") {
  const upstream = new WebSocket(
    `${UPSTREAM_URL}?key=${encodeURIComponent(apiKey)}`,
  );
  const pending = [];
  let closed = false;

  const finish = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };

  upstream.on("open", () => {
    // Flush anything the browser sent while we were still connecting.
    for (const message of pending.splice(0)) {
      upstream.send(message.data, { binary: message.binary });
    }
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push({ data, binary: isBinary });
    }
  });

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on("close", () => finish());
  client.on("error", () => finish(1011, "client_error"));
  upstream.on("close", (code, reason) => {
    const text = reason?.toString().slice(0, 120) ?? "";
    console.warn(
      `[${label}] upstream closed — ${classifyUpstreamClose(code, text)} (code ${code}${text ? `, ${text}` : ""})`,
    );
    finish(code === 1000 ? 1000 : 1011, text);
  });
  upstream.on("error", (error) => {
    console.warn(`[${label}] upstream error — ${error?.message ?? "unknown"}`);
    finish(1011, "upstream_error");
  });
}

/** Answer an HTTP upgrade with a bare status line, then close. */
function rejectUpgrade(socket, status) {
  try {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  } catch {
    /* socket already gone */
  }
  socket.destroy();
}

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
};

/**
 * Standalone relay server.
 *
 * Endpoints:
 *   GET  /health    → { ok, voice }
 *   POST /ticket    → { ticket, expiresAt }   (requires VOICE_RELAY_TOKEN when set)
 *   WS   /api/gemini/live?ticket=…            (the Live bridge)
 */
export function startStandaloneRelay(options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const port = Number(
    options.port ?? process.env.RELAY_PORT ?? process.env.PORT ?? 8080,
  );
  const hostname = options.hostname ?? "0.0.0.0";
  const secret =
    options.secret ?? process.env.GEMINI_TICKET_SECRET ?? randomUUID();
  const token = (options.token ?? process.env.VOICE_RELAY_TOKEN ?? "").trim();
  const allowedOrigin = (
    options.allowedOrigin ??
    process.env.VOICE_ALLOWED_ORIGIN ??
    ""
  ).trim();

  const server = createServer((req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, voice: Boolean(apiKey) });
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === TICKET_PATH || url.pathname === "/api/gemini/ticket")
    ) {
      if (!apiKey) {
        sendJson(res, 503, {
          code: "not_configured",
          error: "GEMINI_API_KEY is not set on the relay.",
        });
        return;
      }
      if (token) {
        const header = req.headers.authorization ?? "";
        const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
        const a = Buffer.from(provided);
        const b = Buffer.from(token);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          sendJson(res, 401, {
            code: "unauthorized",
            error: "Missing or invalid relay token.",
          });
          return;
        }
      }
      sendJson(res, 200, createTicket(secret));
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, searchParams } = new URL(
      req.url ?? "/",
      "http://localhost",
    );

    if (pathname !== LIVE_PATH) {
      socket.destroy();
      return;
    }
    if (!apiKey) {
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    // The socket is not a CORS request, so an explicit origin check is what
    // stops another site from driving the relay with a stolen ticket.
    const origin = req.headers.origin;
    if (allowedOrigin && origin && origin !== allowedOrigin) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }
    if (!verifyTicket(secret, searchParams.get("ticket") ?? "")) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) =>
      pipeToGemini(client, apiKey),
    );
  });

  server.listen(port, hostname, () => {
    console.log(`> Voice relay listening on http://${hostname}:${port}`);
    console.log(
      apiKey
        ? `> Gemini Live relay active at ${LIVE_PATH}`
        : "> GEMINI_API_KEY not set — the relay will refuse connections",
    );
    if (!token) {
      console.warn(
        "> VOICE_RELAY_TOKEN not set — /ticket is open to anyone who can reach this host",
      );
    }
  });

  return { server, secret };
}

// Run as a program only when executed directly, never when imported.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadDotEnv();
  startStandaloneRelay();
}
