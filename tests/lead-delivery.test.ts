import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLeadPayload,
  deliverLead,
  leadDeliveryConfigured,
} from "@/lib/leads/delivery";
import { detectAction } from "@/lib/ai/extract";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { recompute } from "@/lib/leads/update";
import { PROPERTIES } from "@/lib/data/properties";
import { createEngineState, respond } from "@/lib/whatsapp/engine";

const completeLead = (): Lead =>
  recompute({
    ...emptyLead("WhatsApp"),
    name: "Rahul",
    intent: "Buy",
    location: "Dwarka",
    bhk: "2 BHK",
    budget: 9_000_000,
    budgetLabel: "₹90L",
    timeline: "3–6 months",
    matchedPropertyIds: ["dwarka-heights"],
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opt-out detection", () => {
  it("reads the standard stop words", () => {
    expect(detectAction("stop")).toBe("optOut");
    expect(detectAction("STOP")).toBe("optOut");
    expect(detectAction("unsubscribe")).toBe("optOut");
    expect(detectAction("stop messaging me")).toBe("optOut");
    expect(detectAction("mat bhejo")).toBe("optOut");
  });

  it("does not mistake an ordinary sentence for an opt-out", () => {
    // A bare "stop" is the WhatsApp keyword; "stop by" in a normal sentence is
    // not, and treating it as one would cut off a live customer.
    expect(detectAction("can I stop by on Saturday?")).not.toBe("optOut");
    expect(detectAction("where is the nearest bus stop")).not.toBe("optOut");
  });
});

describe("lead delivery payload", () => {
  it("carries the requirement, score and the matches the customer saw", () => {
    const payload = buildLeadPayload({
      lead: completeLead(),
      matches: PROPERTIES.filter((property) => property.id === "dwarka-heights"),
      transcript: [{ role: "assistant", text: "Hello" }],
    });

    expect(payload.source).toBe("WhatsApp");
    expect(payload.temperature).toBe(completeLead().temperature);
    expect(payload.budgetValue).toBe(9_000_000);
    expect(payload.requirement).toMatch(/2 BHK/i);
    expect(payload.matches[0]?.name).toBe("Dwarka Heights");
    expect(payload.matches[0]?.url).toMatch(/^https:\/\//);
    expect(payload.optedOutFollowUps).toBe(false);
    expect(payload.summary).toMatch(/looking to buy/i);
  });

  it("marks an opted-out lead so follow-ups can respect it", () => {
    const payload = buildLeadPayload({ lead: { ...completeLead(), optOut: true } });
    expect(payload.optedOutFollowUps).toBe(true);
    expect(payload.nextAction).toMatch(/opted out/i);
  });
});

describe("delivery is optional and never breaks the conversation", () => {
  it("skips silently when no destination is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("LEAD_WEBHOOK_URL", "");

    expect(leadDeliveryConfigured()).toBe(false);
    const result = await deliverLead({ lead: completeLead() });

    expect(result).toEqual({ ok: false, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the payload to the configured webhook", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("LEAD_WEBHOOK_URL", "https://example.com/hook");

    const result = await deliverLead({ lead: completeLead() });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
  });

  it("swallows a destination failure instead of failing the turn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    vi.stubEnv("LEAD_WEBHOOK_URL", "https://example.com/hook");

    const result = await deliverLead({ lead: completeLead() });
    expect(result).toEqual({ ok: false, error: "network" });
  });
});

describe("opt-out closes the conversation", () => {
  it("confirms once, sends no recap, and stops asking", () => {
    const state = createEngineState("WhatsApp");
    const first = respond(state, "I want to buy a 2bhk in Dwarka, next year");
    const second = respond(first.state, "stop");

    expect(second.state.lead.optOut).toBe(true);
    expect(second.state.finished).toBe(true);

    const text = second.messages
      .filter((message) => message.side === "assistant")
      .map((message) => message.text)
      .join(" ");

    expect(text).toMatch(/won't send you any follow-up/i);
    expect(text).not.toMatch(/closest matches/i);
  });
});
