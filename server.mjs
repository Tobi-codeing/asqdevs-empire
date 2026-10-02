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
 * Use this with `npm run dev` and `npm run start`. A host that cannot run a
 * custom server (for example Vercel) instead points at the standalone relay in
 * `relay.mjs` through `VOICE_RELAY_URL`; the shared implementation lives there,
 * so the two modes cannot drift apart.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import next from "next";
import { WebSocketServer } from "ws";
import { LIVE_PATH, loadDotEnv, pipeToGemini, verifyTicket } from "./relay.mjs";

loadDotEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

// One secret per boot, shared with the Next.js routes through the environment.
// A restart invalidates every outstanding ticket, so none can be replayed.
const TICKET_SECRET = process.env.GEMINI_TICKET_SECRET ?? randomUUID();
process.env.GEMINI_TICKET_SECRET = TICKET_SECRET;
// Tells the session route that a relay is present.
process.env.LIVE_RELAY_ENABLED = "1";

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

  if (pathname !== LIVE_PATH) {
    socket.destroy();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!verifyTicket(TICKET_SECRET, searchParams.get("ticket") ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    pipeToGemini(client, apiKey);
  });
});

server.listen(port, () => {
  console.log(`> ASQDEVS EMPIRE ready on http://${hostname}:${port}`);
  console.log(
    process.env.GEMINI_API_KEY
      ? "> Gemini Live relay active at /api/gemini/live"
      : "> GEMINI_API_KEY not set — the phone demo will offer the text call",
  );
});
