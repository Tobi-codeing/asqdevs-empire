import { NextResponse } from "next/server";
import { DEFAULT_LIVE_MODEL, DEFAULT_VOICE } from "@/lib/gemini/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Path the browser opens for the Live socket (mirrors `relay.mjs`). */
const LIVE_PATH = "/api/gemini/live";
/** Path that mints a ticket on the relay (mirrors `relay.mjs`). */
const TICKET_PATH = "/ticket";

/**
 * How this deployment reaches the voice relay.
 *
 *  - `external`    — a standalone relay (`relay.mjs`) runs on a WebSocket-capable
 *                    host and is addressed by `VOICE_RELAY_URL`. This is the
 *                    Vercel path: serverless functions cannot hold a socket.
 *  - `same-origin` — `server.mjs` embeds the relay on the app's own origin
 *                    (`npm run dev` / `npm run start`).
 *  - `none`        — no relay anywhere; voice is genuinely unavailable.
 */
type RelayMode = "external" | "same-origin" | "none";

function externalRelayUrl(): string | undefined {
  const value = process.env.VOICE_RELAY_URL?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

function relayMode(): RelayMode {
  if (externalRelayUrl()) return "external";
  if (process.env.LIVE_RELAY_ENABLED === "1") return "same-origin";
  return "none";
}

/**
 * Reports whether real voice is available, and how the client should connect.
 *
 * The `reason` is what lets the UI name the actual missing piece instead of
 * showing one vague "voice isn't available" line for every cause.
 */
export async function GET() {
  const mode = relayMode();
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const hasExternal = Boolean(externalRelayUrl());
  // Voice can start only when a relay exists AND something can authorise it: a
  // key here (same-origin) or a keyed relay we can reach (external).
  const ready = mode !== "none" && (hasKey || hasExternal);

  return NextResponse.json({
    configured: hasKey || hasExternal,
    relay: mode !== "none",
    mode,
    reason: ready
      ? undefined
      : hasKey || hasExternal
        ? "relay_unavailable"
        : "not_configured",
    provider: "gemini-live",
    model: process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL,
    voice: process.env.GEMINI_LIVE_VOICE ?? DEFAULT_VOICE,
  });
}

/**
 * Issues a short-lived connection ticket for the WebSocket relay.
 *
 * The permanent API key never reaches the browser. The relay signs tickets with
 * a per-boot HMAC secret, so this route only brokers an opaque ticket: either
 * from the standalone relay over HTTPS (`VOICE_RELAY_URL`), or from the embedded
 * relay over loopback.
 */
export async function POST() {
  const mode = relayMode();
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const hasExternal = Boolean(externalRelayUrl());

  // Neither an API key nor a relay: nothing can authorise a call.
  if (!hasKey && !hasExternal) {
    return NextResponse.json(
      {
        code: "not_configured",
        error: "Gemini Live voice is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  // A key exists but no relay can hold it (Vercel without VOICE_RELAY_URL).
  if (mode === "none") {
    return NextResponse.json(
      {
        code: "relay_unavailable",
        error:
          "No voice relay is reachable. Set VOICE_RELAY_URL to a running relay, or start the app with `npm run dev` / `npm run start`.",
      },
      { status: 503 },
    );
  }

  const model = process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL;
  const voice = process.env.GEMINI_LIVE_VOICE ?? DEFAULT_VOICE;

  if (mode === "external") {
    const relayUrl = externalRelayUrl() as string;
    const token = process.env.VOICE_RELAY_TOKEN?.trim();

    const ticketRes = await fetch(`${relayUrl}${TICKET_PATH}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store",
    }).catch(() => null);

    if (!ticketRes?.ok) {
      console.error(
        `[voice] ticket request to relay failed (${ticketRes?.status ?? "network"}) at ${relayUrl}${TICKET_PATH}`,
      );
      return NextResponse.json(
        {
          code: "ticket_failed",
          error:
            "Could not reach the voice relay. Check that VOICE_RELAY_URL is correct and the relay is running.",
        },
        { status: 502 },
      );
    }

    const data = (await ticketRes.json()) as { ticket?: string };
    if (!data.ticket) {
      return NextResponse.json(
        { code: "ticket_failed", error: "The relay returned no ticket." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ticket: data.ticket,
      path: LIVE_PATH,
      relayUrl,
      model,
      voice,
    });
  }

  // same-origin: the embedded relay published a secret at boot, so the ticket is
  // minted over loopback where only this process can reach it.
  const port = process.env.PORT ?? "3000";
  const ticketRes = await fetch(`http://127.0.0.1:${port}/api/gemini/ticket`, {
    method: "POST",
  }).catch(() => null);

  if (!ticketRes?.ok) {
    return NextResponse.json(
      {
        code: "ticket_failed",
        error: "Could not issue a voice connection ticket.",
      },
      { status: 502 },
    );
  }

  const data = (await ticketRes.json()) as { ticket?: string };
  if (!data.ticket) {
    return NextResponse.json(
      { code: "ticket_failed", error: "The relay returned no ticket." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ticket: data.ticket,
    path: LIVE_PATH,
    model,
    voice,
  });
}
