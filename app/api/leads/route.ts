import { NextResponse } from "next/server";
import { deliverLead } from "@/lib/leads/delivery";
import { recordLead, syncLeadToRelay } from "@/lib/leads/store";
import { getPropertiesByIds } from "@/lib/data/inventory";
import "@/lib/data/store";
import { safeLead } from "@/lib/whatsapp/lead-guard";
import type { Lead } from "@/lib/leads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands a finished lead to the configured destination.
 *
 * The WhatsApp path delivers server-side, inside the turn. The phone path
 * finishes in the browser, so it posts the completed lead here instead — both
 * end up in the same `deliverLead`, so the record cannot differ between the two
 * channels.
 *
 * This route is a transport boundary: it rehydrates the lead through `safeLead`
 * (nothing untrusted reaches the payload), resolves the property ids against the
 * real inventory and returns what happened. It never throws: an unconfigured or
 * unreachable destination is reported, not treated as a failed request.
 */
type RequestBody = {
  id?: string;
  lead?: Partial<Lead>;
  propertyIds?: string[];
  transcript?: { role?: string; text?: string }[];
  optOut?: boolean;
  recordingUrl?: string;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const rawLead = {
    ...body.lead,
    recordingUrl: body.recordingUrl || body.lead?.recordingUrl,
  };
  const lead = safeLead(rawLead);

  const ids = Array.isArray(body.propertyIds)
    ? body.propertyIds.filter((id): id is string => typeof id === "string")
    : lead.matchedPropertyIds;

  const transcript = (Array.isArray(body.transcript) ? body.transcript : [])
    .filter((turn) => turn && typeof turn.text === "string")
    .slice(-40)
    .map((turn) => ({
      role:
        turn.role === "assistant"
          ? "assistant"
          : turn.role === "user"
            ? "user"
            : "system",
      text: String(turn.text).slice(0, 800),
    }));

  const input = {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined,
    lead,
    matches: getPropertiesByIds(ids),
    transcript,
    optOut: body.optOut,
    recordingUrl: body.recordingUrl || lead.recordingUrl,
  };
  // The phone call ends in the browser, so its record is written here.
  const record = recordLead(input);

  // Both delivery and persistent relay sync MUST be awaited before Vercel serverless freezes
  const [deliveryResult] = await Promise.allSettled([
    deliverLead(input),
    syncLeadToRelay(record),
  ]);

  const result =
    deliveryResult.status === "fulfilled"
      ? deliveryResult.value
      : { ok: false, error: "delivery_failed" };

  return NextResponse.json({
    delivered: result.ok,
    reason: result.ok ? undefined : "skipped" in result ? "not_configured" : result.error,
  });
}

