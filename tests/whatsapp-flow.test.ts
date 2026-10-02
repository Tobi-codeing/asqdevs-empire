import { describe, expect, it } from "vitest";
import { runTurn } from "@/lib/whatsapp/turn";
import { emptyLead, type Lead } from "@/lib/leads/types";
import type { SentLink } from "@/lib/whatsapp/messages";
import { extractLeadFields, parseTimeline } from "@/lib/ai/extract";
import {
  conversationStage,
  isVisitTimePending,
  nextActionButtons,
  visitTimeSelection,
  withVisitTime,
} from "@/lib/whatsapp/engine";
import { reconcileReplies } from "@/lib/whatsapp/options";

/**
 * These tests drive the real server turn with no API key, which is exactly the
 * deterministic engine the deployment falls back to when Gemini is unavailable
 * or rate-limited. That is the path the reported loop came from.
 */

type Reply = {
  text: string;
  quickReplies?: string[];
  propertyIds?: string[];
  links?: SentLink[];
};
type Run = {
  lead: Lead;
  offeredPropertyIds: string[];
  sentLinks: SentLink[];
  replies: Reply[];
  history: { side: "user" | "assistant"; text: string }[];
  restarted?: boolean;
};

const fresh = (): Run => ({
  lead: emptyLead("WhatsApp"),
  offeredPropertyIds: [],
  sentLinks: [],
  replies: [],
  history: [],
});

async function step(run: Run, text: string): Promise<Run> {
  const res = await runTurn(
    {
      text,
      lead: run.lead,
      history: run.history,
      offeredPropertyIds: run.offeredPropertyIds,
      sentLinks: run.sentLinks,
    },
    "",
  );
  if (res.restarted) return { ...run, replies: [], restarted: true };
  return {
    lead: res.lead,
    offeredPropertyIds: res.offeredPropertyIds,
    sentLinks: res.sentLinks,
    replies: res.replies.map((r) => ({
      text: r.text,
      quickReplies: r.quickReplies,
      propertyIds: r.propertyIds,
      links: r.links,
    })),
    history: [
      ...run.history,
      { side: "user", text },
      ...res.replies.map((r) => ({ side: "assistant" as const, text: r.text })),
    ],
  };
}

async function play(turns: string[], start: Run = fresh()): Promise<Run> {
  let run = start;
  for (const text of turns) run = await step(run, text);
  return run;
}

const texts = (run: Run) => run.replies.map((r) => r.text).join("\n");
const buttons = (run: Run) => run.replies.flatMap((r) => r.quickReplies ?? []);

/** Complete the qualification so the conversation can reach the match stage. */
const qualified = () =>
  play(["hi", "Buy", "Rohini", "2 BHK", "Around ₹90L", "within 3 months"]);

describe("parseTimeline buckets", () => {
  it("does not misread '1–3 months' as '3–6 months'", () => {
    expect(parseTimeline("1–3 months")).toBe("1–3 months");
    expect(parseTimeline("1-3 months")).toBe("1–3 months");
    expect(parseTimeline("3–6 months")).toBe("3–6 months");
    expect(parseTimeline("3 months")).toBe("3–6 months");
    expect(extractLeadFields("1–3 months").timeline).toBe("1–3 months");
  });
});

describe("visit time is not a loop", () => {
  it("asks for a time after a visit request, then records it", async () => {
    let run = await qualified();
    run = await step(run, "Schedule a site visit");

    expect(texts(run)).toMatch(/what time works better/i);
    expect(buttons(run)).toEqual(["Morning", "Afternoon", "Evening"]);
    expect(isVisitTimePending(run.lead)).toBe(true);

    run = await step(run, "Afternoon");

    // The reported bug: this used to re-ask "arrange a site visit / advisor?".
    expect(texts(run)).not.toMatch(/arrange a site visit/i);
    expect(texts(run)).toMatch(/afternoon/i);
    expect(run.lead.siteVisit).toMatch(/afternoon/i);

    // Everything was captured and the visit time was given, so the conversation
    // closes with the recap instead of looping on the same options again.
    expect(run.lead.recapSent).toBe(true);
    expect(texts(run)).toMatch(/here's what I have/i);
    expect(buttons(run)).toEqual([]);
  });

  it("records an explicit visit date and time as one request", async () => {
    const run = await step(await qualified(), "Can I visit tomorrow at 5pm?");
    expect(run.lead.siteVisit).toMatch(/requested/i);
    expect(isVisitTimePending(run.lead)).toBe(false);
    expect(buttons(run)).not.toContain("Schedule a site visit");
  });

  it("keeps a date already given when the time is chosen later", async () => {
    expect(withVisitTime({ ...emptyLead("WhatsApp"), siteVisit: "Friday 3 October — time to confirm" }, "Afternoon").siteVisit).toBe(
      "Friday 3 October, Afternoon — requested",
    );
  });
});

describe("advisor handoff is terminal", () => {
  it("confirms once and closes with the recap, offering nothing again", async () => {
    let run = await qualified();

    run = await step(run, "Talk to an advisor");

    expect(run.lead.advisorRequested).toBe(true);
    expect(texts(run)).toMatch(/property advisor/i);
    // The requirement is captured and the hand-off is agreed, so the recap goes
    // out once and the enquiry is finished instead of looping.
    expect(run.lead.recapSent).toBe(true);
    expect(texts(run)).toMatch(/here's what I have/i);
    // Nothing already done is offered again.
    expect(buttons(run)).not.toContain("Talk to an advisor");
    expect(buttons(run)).not.toContain("Schedule a site visit");
  });

  it("stays closed when the customer keeps chatting after a hand-off", async () => {
    let run = await step(await qualified(), "Talk to an advisor");
    expect(run.lead.recapSent).toBe(true);

    run = await step(run, "Amenities");

    // No second recap, and the old option loop is never rebuilt.
    expect(texts(run)).not.toMatch(/here's what I have/i);
    expect(buttons(run)).not.toContain("Show more options");
    expect(buttons(run)).not.toContain("Amenities");
  });

  it("hands over early, with the partial requirement, when a person is asked for", async () => {
    let run = await step(fresh(), "hi");
    run = await step(run, "Talk to an advisor");

    // A person was asked for, so the assistant stops qualifying immediately —
    // it does not keep interrogating the customer to fill the form first.
    expect(run.lead.advisorRequested).toBe(true);
    expect(run.lead.recapSent).toBe(true);
    expect(texts(run)).toMatch(/property advisor/i);
  });

  it("does not make the same hand-off twice", async () => {
    let run = await step(await qualified(), "Talk to an advisor");
    expect(run.lead.advisorRequested).toBe(true);

    run = await step(run, "Talk to an advisor");
    expect(texts(run)).toMatch(/already connected/i);
    expect(texts(run)).not.toMatch(/here's what I have/i);
  });

  it("shows the recap exactly once, on a genuine wrap-up", async () => {
    let run = await qualified();
    run = await step(run, "thanks, that's all");
    expect(texts(run)).toMatch(/here's what I have/i);
    expect(run.lead.recapSent).toBe(true);

    run = await step(run, "thanks again");
    expect(texts(run)).not.toMatch(/here's what I have/i);
  });
});

describe("no backward loops after completion", () => {
  it("stays closed on an unrecognised message after a completed visit", async () => {
    let run = await qualified();
    run = await step(run, "Schedule a site visit");
    run = await step(run, "Afternoon");
    run = await step(run, "Done");
    expect(run.lead.recapSent).toBe(true);

    run = await step(run, "ok");
    expect(texts(run)).not.toMatch(/arrange a site visit/i);
    expect(buttons(run)).not.toContain("Schedule a site visit");
  });
});

describe("requirements and free text", () => {
  it("captures several facts from one message and skips the questions", async () => {
    const run = await step(
      fresh(),
      "I need a 2 BHK in Rohini around 90 lakh, probably in 1–3 months.",
    );
    expect(run.lead.intent).toBe("Buy");
    expect(run.lead.location).toBe("Rohini");
    expect(run.lead.bhk).toBe("2 BHK");
    expect(run.lead.budget).toBe(9_000_000);
    expect(run.lead.timeline).toBe("1–3 months");
  });

  it("reads a free-text budget and timeline", async () => {
    let run = await step(fresh(), "buy");
    run = await step(run, "Rohini");
    run = await step(run, "2 bhk");
    run = await step(run, "around 80 lakh");
    expect(run.lead.budget).toBe(8_000_000);
    run = await step(run, "maybe next year");
    expect(run.lead.timeline).toBe("12 months");
  });

  it("edits one field for 'change my requirements' without resetting", async () => {
    let run = await qualified();
    run = await step(run, "change my requirements");

    expect(texts(run)).toMatch(/what's changed/i);
    // Nothing was wiped.
    expect(run.lead.intent).toBe("Buy");
    expect(run.lead.bhk).toBe("2 BHK");
    expect(run.lead.budget).toBe(9_000_000);

    run = await step(run, "actually Gurgaon also works");
    expect(run.lead.location).toBe("Gurugram");
    // The other answers survive the change.
    expect(run.lead.intent).toBe("Buy");
    expect(run.lead.bhk).toBe("2 BHK");
    expect(run.lead.budget).toBe(9_000_000);
  });

  it("restarts only on an explicit restart", async () => {
    const run = await step(await qualified(), "restart");
    expect(run.restarted).toBe(true);
  });
});

describe("matches and more options", () => {
  it("offers matches once and never duplicates property cards", async () => {
    let run = await qualified();
    const first = run.offeredPropertyIds;
    expect(first.length).toBeGreaterThan(0);

    run = await step(run, "Show me something suitable");
    expect(run.offeredPropertyIds).toEqual(first);
  });

  it("pages 'show more options' onto listings not already shown", async () => {
    const before = await qualified();
    const shown = new Set(before.offeredPropertyIds);

    const run = await step(before, "Show more options");
    const advertised = run.replies.flatMap((r) => r.propertyIds ?? []);

    // Anything new it advertises must be something not shown before; and if
    // there is nothing new it says so honestly instead of repeating a card.
    for (const id of advertised) expect(shown.has(id)).toBe(false);
    if (!advertised.length) expect(texts(run)).toMatch(/everything I have/i);
  });
});

describe("a complete requirement is acted on, not interrogated", () => {
  it("shows matching homes as soon as the requirement can be searched", async () => {
    // The reported example: the customer states a full requirement in one line,
    // without ever saying "buy". The homes must come back with the link — not
    // another question — while the one open field is still asked alongside them.
    const run = await step(fresh(), "2 BHK chahiye Rohini mein, budget 90L");

    expect(run.lead.intent).toBe("Buy");
    const advertised = run.replies.flatMap((r) => r.propertyIds ?? []);
    expect(advertised).toContain("rohini-enclave");
    expect(
      run.sentLinks.some((link) => link.propertyId === "rohini-enclave"),
    ).toBe(true);
    // …and the timeline is still collected, so the lead still completes.
    expect(texts(run)).toMatch(/when are you hoping/i);
    const withTimeline = await step(run, "within 3 months");
    expect(withTimeline.lead.timeline).toBe("3–6 months");
  });
});

describe("buttons during qualification", () => {
  it("never offers two buttons for the same action", () => {
    // The reported bug: the matches message offered both "Let's schedule a
    // visit" (the model's wording) and "Schedule a site visit" (the canonical
    // one) — two buttons leading to the same place.
    const lead: Lead = {
      ...emptyLead("WhatsApp"),
      intent: "Buy",
      location: "Dwarka",
      bhk: "2 BHK",
      matchedPropertyIds: ["dwarka-heights"],
    };

    const replies = reconcileReplies(
      ["Show me Sky Residency", "Let's schedule a visit"],
      lead,
      { hasMatches: true, hasSelectedProperty: false },
    );

    expect(replies.filter((reply) => /visit/i.test(reply))).toHaveLength(1);
    expect(new Set(replies.map((reply) => reply.toLowerCase())).size).toBe(
      replies.length,
    );
  });

  it("does not offer a button for the property already on screen", () => {
    const lead: Lead = {
      ...emptyLead("WhatsApp"),
      intent: "Buy",
      location: "Dwarka",
      bhk: "2 BHK",
      selectedPropertyId: "dwarka-heights",
    };

    const replies = reconcileReplies(["Dwarka Heights"], lead, {
      hasMatches: false,
      hasSelectedProperty: true,
    });

    expect(replies).not.toContain("Dwarka Heights");
  });

  it("offers the canonical answers instead of the model's passing guesses", () => {
    // A greeting once shipped with "Dwarka" and "Rohini" as buttons while the
    // one answer being asked for — Sell — was pushed off the end of the row.
    expect(
      reconcileReplies(["Buy", "Dwarka", "Rohini"], emptyLead("WhatsApp"), {
        hasMatches: false,
        hasSelectedProperty: false,
      }),
    ).toEqual(["Buy", "Rent", "Sell"]);
  });
});

describe("conversation stage", () => {
  it("is derived from the lead, not from memory", async () => {
    expect(conversationStage(emptyLead("WhatsApp"), [])).toBe("QUALIFYING");
    expect(conversationStage({ ...emptyLead("WhatsApp"), advisorRequested: true }, [])).toBe(
      "ADVISOR_REQUESTED",
    );
    expect(
      conversationStage({ ...emptyLead("WhatsApp"), siteVisit: "Visit requested — time to confirm" }, []),
    ).toBe("CHOOSING_VISIT_TIME");
    expect(conversationStage({ ...emptyLead("WhatsApp"), siteVisit: "Afternoon — requested" }, [])).toBe(
      "VISIT_REQUESTED",
    );
  });

  it("never rebuilds a button for a completed action", () => {
    expect(nextActionButtons({ siteVisit: false, advisor: false, callback: false })).toEqual([
      "Schedule a site visit",
      "Talk to an advisor",
      "Done",
    ]);
    expect(nextActionButtons({ siteVisit: true, advisor: false, callback: false })).toEqual([
      "Talk to an advisor",
      "Done",
    ]);
    expect(nextActionButtons({ siteVisit: true, advisor: true, callback: false })).toEqual(["Done"]);
  });

  it("only reads a bare time-of-day as a visit answer", () => {
    expect(visitTimeSelection("Afternoon")).toBe("Afternoon");
    expect(visitTimeSelection("  evening ")).toBe("Evening");
    expect(visitTimeSelection("I'll think about it in the morning, maybe next week")).toBeUndefined();
  });
});
