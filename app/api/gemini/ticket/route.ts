import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived WebSocket connection ticket.
 *
 * The HMAC secret lives in the relay process and is shared with the Next.js
 * server through `GEMINI_TICKET_SECRET`, so neither side can be tricked into
 * issuing a ticket for the other. Callers never see the secret — only an opaque
 * ticket valid for one minute.
 *
 * This endpoint is called over loopback by `/api/gemini/session`. It is not
 * reachable with a valid ticket from the public internet, because the secret is
 * only ever set by the relay at boot.
 */
export async function POST() {
  const secret = process.env.GEMINI_TICKET_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        code: "no_secret",
        error: "The relay has not published a ticket secret.",
      },
      { status: 503 },
    );
  }

  const { createHmac, randomUUID } = await import("node:crypto");
  const ttl = 60_000;
  const payload = `${randomUUID()}|${Date.now() + ttl}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");

  return NextResponse.json({
    ticket: `${Buffer.from(payload).toString("base64url")}.${sig}`,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
  });
}
