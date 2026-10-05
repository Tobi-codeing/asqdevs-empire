import { NextResponse } from "next/server";
import type { Lead } from "@/lib/leads/types";
import type { SentLink } from "@/lib/whatsapp/messages";
import { runTurn } from "@/lib/whatsapp/turn";
// Importing the server store hydrates the shared inventory cache with the
// admin's latest properties before the turn runs.
import "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  text?: string;
  lead?: Partial<Lead>;
  history?: { side: "user" | "assistant"; text: string }[];
  offeredPropertyIds?: string[];
  sentLinks?: SentLink[];
};

/**
 * One WhatsApp turn.
 *
 * The route is a transport boundary and nothing more: it validates the shape of
 * the request, hands off to `lib/whatsapp/turn` and serialises the result. All
 * conversation logic, lead merging and inventory access live in that module, so
 * the same engine can be driven from a route, a test or a future channel
 * without touching request handling.
 */
export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  const result = await runTurn(
    {
      text,
      lead: body.lead,
      history: Array.isArray(body.history)
        ? body.history
            .filter(
              (item) =>
                item &&
                (item.side === "user" || item.side === "assistant") &&
                typeof item.text === "string",
            )
            .slice(-16)
            .map((item) => ({ side: item.side, text: item.text.slice(0, 500) }))
        : [],
      offeredPropertyIds: Array.isArray(body.offeredPropertyIds)
        ? body.offeredPropertyIds.filter((id): id is string => typeof id === "string")
        : [],
      sentLinks: Array.isArray(body.sentLinks) ? body.sentLinks : [],
    },
    process.env.GEMINI_API_KEY ?? "",
  );

  return NextResponse.json(result);
}
