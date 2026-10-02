import { NextResponse } from "next/server";
import { DEFAULT_LIVE_MODEL, DEFAULT_VOICE } from "@/lib/gemini/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether real voice is available, and how the client should connect.
 *
 * `relay` is true only when the custom server is running. On a host without
 * custom-server support the UI offers the text call instead of failing at the
 * microphone prompt.
 */
export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.GEMINI_API_KEY),
    relay: process.env.LIVE_RELAY_ENABLED === "1",
    provider: "gemini-live",
    model: process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL,
    voice: process.env.GEMINI_LIVE_VOICE ?? DEFAULT_VOICE,
  });
}

/**
 * Issues a short-lived connection ticket for the WebSocket relay.
 *
 * The relay signs tickets with a per-boot HMAC secret, so this route cannot mint
 * one itself — it asks the relay over loopback and passes the opaque ticket back
 * to the browser. No secret is ever returned to the client.
 *
 * Why a relay rather than an ephemeral token: Google's `auth_tokens` endpoint
 * returns a value the Live WebSocket rejects on this key (close code 1008 for
 * every documented form), and a browser WebSocket cannot send an Authorization
 * header. The relay keeps the permanent key server-side, which is the actual
 * requirement.
 */
export async function POST() {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        code: "not_configured",
        error: "Gemini Live voice is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  if (process.env.LIVE_RELAY_ENABLED !== "1") {
    return NextResponse.json(
      {
        code: "relay_unavailable",
        error:
          "The voice relay is not running. Start the app with `npm run dev` or `npm run build && npm run start`.",
      },
      { status: 503 },
    );
  }

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
    path: "/api/gemini/live",
    model: process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL,
    voice: process.env.GEMINI_LIVE_VOICE ?? DEFAULT_VOICE,
  });
}


