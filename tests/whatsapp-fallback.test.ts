import { describe, expect, it } from "vitest";
import {
  createEngineState,
  respond,
  type ChatMessage,
} from "@/lib/whatsapp/engine";
import { emptyLead } from "@/lib/leads/types";
import { runTurn } from "@/lib/whatsapp/turn";
import { classifyError } from "@/lib/realtime/live-events";
import { PRODUCTION_SITE_URL, absoluteUrl } from "@/lib/site";
import { finalRecapMessage } from "@/lib/whatsapp/messages";
import { PROPERTIES } from "@/lib/data/properties";

const assistantMessages = (messages: ChatMessage[]) =>
  messages.filter((message) => message.side === "assistant");

/**
 * The fallback conversation engine. This is the path taken when Gemini is
 * unavailable or out of quota, so it must still hold a real conversation over
 * the same lead state — never a fixed linear script.
 */
describe("deterministic fallback engine", () => {
  it("captures several facts, then asks only for the missing one", () => {
    const state = createEngineState("WhatsApp");
    const turn = respond(
      state,
      "Hi, I need a 2BHK in Dwarka around 90 lakh.",
    );

    expect(turn.state.lead.intent).toBe("Buy");
    expect(turn.state.lead.bhk).toBe("2 BHK");
    expect(turn.state.lead.location).toBe("Dwarka");
    expect(turn.state.lead.budget).toBe(9_000_000);
    // Timeline was never mentioned — that is the only thing worth asking for.
    expect(turn.state.lead.timeline).toBeUndefined();

    const assistant = assistantMessages(turn.messages);
    const reply = assistant.map((message) => message.text).join(" ");
    // The homes go out on the turn the requirement becomes searchable, and the
    // one open field is asked for alongside them rather than a turn later.
    expect(assistant[0]?.propertyIds).toContain("dwarka-heights");
    expect(reply).toMatch(/when are you hoping/i);
    // It must not re-ask for anything already given.
    expect(reply.toLowerCase()).not.toMatch(/which area|how many bedroom|budget/);
  });

  it("shows real matches as soon as the requirement can be searched", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(state, "I want to buy a 2BHK in Dwarka around 90 lakh.");

    const ids = first.messages.flatMap((message) => message.propertyIds ?? []);
    expect(ids).toContain("dwarka-heights");

    // The timeline is still collected afterwards, so the lead completes.
    const second = respond(first.state, "Probably next year.");
    expect(second.state.lead.timeline).toBe("12 months");
  });

  it("sends real detail links when asked to see something after matches", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(
      state,
      "I want to buy a 2BHK in Dwarka around 90 lakh.",
    );
    const second = respond(first.state, "Probably next year.");
    const third = respond(second.state, "Show me something suitable.");

    const links = third.messages.flatMap((message) => message.links ?? []);
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((link) => link.propertyId)).toContain("dwarka-heights");
    expect(links[0].url).toContain("/demo/properties/");
  });

  it("adds a second acceptable location without resetting the lead", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(state, "I want to buy a 2BHK in Dwarka around 90 lakh.");
    const second = respond(first.state, "Gurgaon also works.");

    expect(second.state.lead.preferredLocations).toEqual(
      expect.arrayContaining(["Dwarka", "Gurugram"]),
    );
    expect(second.state.lead.bhk).toBe("2 BHK");
    expect(second.state.lead.budget).toBe(9_000_000);
  });

  it("asks the customer to confirm once they are done", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(
      state,
      "I want to buy a 2bhk in Dwarka around 90 lakh, next year.",
    );
    const second = respond(first.state, "thanks, that's all");

    const review = assistantMessages(second.messages).find(
      (message) => message.kind === "review",
    );
    expect(review).toBeTruthy();
    expect(review?.text).toMatch(/confirm I have it right/i);
    // The requirement is read back, not sent on — the recap waits for consent.
    expect(review?.text).toMatch(/2 BHK/);
    expect(second.state.lead.confirmation).toBe("review");
  });

  it("does not replay the exploratory question after 'I don't know the area'", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(state, "just exploring");
    const second = respond(first.state, "I don't know the area");

    const text = assistantMessages(second.messages)
      .map((message) => message.text)
      .join(" ");
    expect(text).not.toMatch(/no pressure at all/i);
    expect(text).toMatch(/buy or rent/i);
  });

  it("stays honest when nothing in the inventory matches", () => {
    const state = createEngineState("WhatsApp");
    const turn = respond(
      state,
      "I need a 2BHK in Dwarka for 20 lakh, show me options",
    );
    const text = assistantMessages(turn.messages)
      .map((message) => message.text)
      .join(" ");
    // It either reports the widened search or says plainly there is no match —
    // but it never claims a listing that meets the stated budget.
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/perfect match/i);
  });
});

describe("Gemini-unavailable WhatsApp turn", () => {
  it("still produces a working conversation over the same state", async () => {
    const result = await runTurn(
      {
        text: "I need a 2bhk in Dwarka around 90 lakh.",
        lead: emptyLead("WhatsApp"),
        history: [],
        offeredPropertyIds: [],
        sentLinks: [],
      },
      "", // no API key — the deterministic path
    );

    expect(result.replies.length).toBeGreaterThan(0);
    expect(result.lead.bhk).toBe("2 BHK");
    expect(result.lead.location).toBe("Dwarka");
    expect(result.lead.budget).toBe(9_000_000);
  });
});

/**
 * Every link the customer receives has to be an absolute URL on the real
 * domain. A missing `NEXT_PUBLIC_SITE_URL` used to produce `localhost:3000`
 * links (and, before that, bare paths) in messages sent to actual customers.
 */
describe("customer-facing property links", () => {
  it("uses the canonical production origin, never localhost", () => {
    const recap = finalRecapMessage(
      { ...emptyLead("WhatsApp"), matchedPropertyIds: [PROPERTIES[0].id] },
      [PROPERTIES[0]],
    );

    expect(recap.text).toContain(PRODUCTION_SITE_URL);
    expect(recap.text).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(recap.links[0]?.url.startsWith(PRODUCTION_SITE_URL)).toBe(true);
    expect(recap.links[0]?.url).toBe(
      absoluteUrl(PROPERTIES[0].detailPageUrl),
    );
  });

  it("always yields an absolute URL from a site-relative path", () => {
    expect(absoluteUrl("/demo/properties/dwarka-heights")).toBe(
      `${PRODUCTION_SITE_URL}/demo/properties/dwarka-heights`,
    );
  });
});

describe("provider failure classification", () => {
  it("maps 429 / quota errors to a friendly rate-limit state", () => {
    expect(
      classifyError("gemini_request_failed(429): RESOURCE_EXHAUSTED quota"),
    ).toBe("rate_limited");
    expect(classifyError("RESOURCE_EXHAUSTED")).toBe("rate_limited");
  });

  it("maps microphone and connection failures distinctly", () => {
    expect(classifyError("mic permission denied")).toBe("mic_denied");
    expect(classifyError("connection closed unexpectedly")).toBe(
      "connection_failed",
    );
  });
});
