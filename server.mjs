/**
 * Minimal custom server that adds the one capability `next start` cannot give
 * us: a WebSocket relay to the Gemini Live API.
 *
 * Why a relay
 * -----------
 * The browser must never hold the permanent Gemini API key. Google's documented
 * alternative — an ephemeral token from `auth_tokens` — is not accepted by the
 * Live WebSocket on this key: every documented form (query `access_token`,
 * `key`, or a `Token`/`Bearer` prefixed value) closes with code 1008 or 1007,
 * while the raw key completes the handshake. A browser WebSocket also cannot set
 * an Authorization header, so the credential would inevitably end up in a URL.
 *
 * The relay therefore holds the key, admits only our own page via a short-lived
 * HMAC ticket, and forwards frames unchanged. The browser speaks the ordinary
 * Live protocol to `/api/gemini/live` with no credential of its own.
 *
 * Use this with `npm run dev` and `npm run start`. On a host that cannot run a
 * custom server, the phone demo reports voice as unavailable and offers the text
 * call rather than breaking.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    // `.env.local` is read first and wins, matching the Next.js convention the
    // README and `.env.example` document; `.env` is the fallback. A variable the
    // host has already set is never overridden (see the loop below).
    const content = [".env.local", ".env"]
      .map((file) => {
        try {
          return readFileSync(path.join(__dirname, file), "utf8");
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
      const value = rawValue.trim();
      const unquoted = value.replace(/^['"]|['"]$/g, "");

      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = unquoted;
      }
    }
  } catch {
    // Missing env files are fine; the host may already supply every var.
  }
}

loadDotEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

const UPSTREAM_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// One secret per boot, shared with the Next.js routes through the environment.
// A restart invalidates every outstanding ticket, so none can be replayed.
const TICKET_SECRET = process.env.GEMINI_TICKET_SECRET ?? randomUUID();
process.env.GEMINI_TICKET_SECRET = TICKET_SECRET;
// Tells the session route that a relay is present.
process.env.LIVE_RELAY_ENABLED = "1";

function verifyTicket(ticket) {
  if (typeof ticket !== "string" || !ticket.includes(".")) return false;
  const [encoded, sig] = ticket.split(".");
  let payload;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", TICKET_SECRET)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [, expires] = payload.split("|");
  return Number(expires) > Date.now();
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  void handle(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname, searchParams } = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? `${hostname}:${port}`}`,
  );

  // Next.js dev-mode HMR also upgrades; hand those back to Next untouched.
  if (pathname.startsWith("/_next/")) {
    app.getUpgradeHandler()(req, socket, head);
    return;
  }

  if (pathname !== "/api/gemini/live") {
    socket.destroy();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!verifyTicket(searchParams.get("ticket") ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    relay(client, apiKey);
  });
});

/** Pipe one browser socket to one upstream Live socket, and back. */
function relay(client, apiKey) {
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
    finish(code === 1000 ? 1000 : 1011, reason?.toString().slice(0, 120) ?? "");
  });
  upstream.on("error", () => finish(1011, "upstream_error"));
}

server.listen(port, () => {
  console.log(`> ASQDEVS EMPIRE ready on http://${hostname}:${port}`);
  console.log(
    process.env.GEMINI_API_KEY
      ? "> Gemini Live relay active at /api/gemini/live"
      : "> GEMINI_API_KEY not set — the phone demo will offer the text call",
  );
});
