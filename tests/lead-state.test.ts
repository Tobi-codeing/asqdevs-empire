import { describe, expect, it } from "vitest";
import { applyExtraction, changedFields, recompute } from "@/lib/leads/update";
import { emptyLead, missingFields, type Lead } from "@/lib/leads/types";
import { scoreLead, temperatureFor } from "@/lib/leads/score";
import {
  formatBudget,
  formatBudgetRange,
} from "@/lib/data/properties";
import { formatTimeline } from "@/lib/leads/format";
import { normaliseIntent } from "@/lib/leads/normalise";

const lead = (patch: Partial<Lead> = {}): Lead => ({
  ...emptyLead("WhatsApp"),
  ...patch,
});

describe("budget formatting", () => {
  it("renders lakh and crore labels", () => {
    expect(formatBudget(9_200_000)).toBe("₹92L");
    expect(formatBudget(10_000_000)).toBe("₹1Cr");
    expect(formatBudget(13_500_000)).toBe("₹1.35Cr");
    expect(formatBudgetRange(9_000_000, 10_000_000)).toBe("₹90L–₹1Cr");
  });
});

describe("timeline formatting", () => {
  it("turns canonical buckets into spoken phrases", () => {
    expect(formatTimeline("1–3 months")).toBe("within 1–3 months");
    expect(formatTimeline("12 months")).toBe("within 1 year");
    expect(formatTimeline("Just exploring")).toBe("just exploring");
  });
});

describe("intent vocabulary", () => {
  it("collapses aliases and Hinglish into one canonical intent", () => {
    expect(normaliseIntent("buying")).toBe("Buy");
    expect(normaliseIntent("buy karna")).toBe("Buy");
    expect(normaliseIntent("kiraya")).toBe("Rent");
    expect(normaliseIntent("bechna")).toBe("Sell");
  });
});

describe("applyExtraction — the one merge path", () => {
  it("normalises a raw patch into canonical fields", () => {
    const next = applyExtraction(lead(), {
      intent: "Buy",
      location: "dwarka",
      bhk: "2",
      budget: 9_000_000,
    });
    expect(next.intent).toBe("Buy");
    expect(next.bhk).toBe("2 BHK");
    expect(next.location).toBe("Dwarka");
    expect(next.budgetLabel).toBe("₹90L");
  });

  it("widens the accepted locations without resetting anything", () => {
    const first = applyExtraction(lead(), {
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
      timeline: "12 months",
    });
    const second = applyExtraction(first, { location: "Gurgaon" });

    expect(second.location).toBe("Gurugram");
    expect(second.preferredLocations).toEqual(
      expect.arrayContaining(["Dwarka", "Gurugram"]),
    );
    // Everything already known survives the update.
    expect(second.bhk).toBe("2 BHK");
    expect(second.budget).toBe(9_500_000);
    expect(second.timeline).toBe("12 months");
  });

  it("never erases a field the customer did not mention", () => {
    const first = applyExtraction(lead(), { intent: "Buy", bhk: "2" });
    const second = applyExtraction(first, { timeline: "Immediately" });
    expect(second.intent).toBe("Buy");
    expect(second.bhk).toBe("2 BHK");
  });

  it("keeps the preferences the customer stated", () => {
    // The reported bug: a caller listing a gym and a school reached the admin
    // as "Preferences: None stated yet" because this merge was missing.
    const next = applyExtraction(lead(), {
      preferences: ["Gym", "Near school", "Market nearby"],
    });
    expect(next.preferences).toEqual(["Gym", "Near school", "Market nearby"]);
  });

  it("adds new preferences without dropping earlier ones", () => {
    const first = applyExtraction(lead(), { preferences: ["Gym"] });
    const second = applyExtraction(first, { preferences: ["Near school"] });
    expect(second.preferences).toEqual(["Gym", "Near school"]);
  });

  it("reports only what is genuinely new", () => {
    const before = applyExtraction(lead(), { intent: "Buy" });
    const after = applyExtraction(before, {
      location: "Dwarka",
      bhk: "2",
    });
    const learned = changedFields(before, after);
    expect(learned).toEqual(expect.arrayContaining(["Dwarka", "2 BHK"]));
    expect(learned).not.toContain("buy");
  });
});

describe("scoring and temperature come from collected signals", () => {
  const complete = lead({
    intent: "Buy",
    location: "Dwarka",
    bhk: "2 BHK",
    budget: 9_500_000,
    budgetMin: 9_500_000,
    budgetMax: 9_500_000,
    budgetLabel: "₹95L",
    timeline: "1–3 months",
  });

  it("does not mark a long, complete-but-uncommitted call HOT", () => {
    const score = scoreLead(complete);
    expect(temperatureFor(score, complete)).not.toBe("HOT");
  });

  it("marks a committed, serviceable lead HOT", () => {
    const committed = recompute({ ...complete, siteVisit: "Saturday 3 October, 11:00 AM" });
    expect(committed.temperature).toBe("HOT");
    expect(committed.score).toBeGreaterThan(scoreLead(complete));
  });

  it("penalises a budget the inventory cannot serve", () => {
    const hopeless = lead({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2 BHK",
      budget: 1_000_000,
      budgetMin: 1_000_000,
      budgetMax: 1_000_000,
    });
    expect(scoreLead(hopeless)).toBeLessThan(scoreLead(complete));
  });
});

describe("missingFields", () => {
  it("asks only for what is genuinely absent", () => {
    const partial = applyExtraction(lead(), {
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_000_000,
    });
    expect(missingFields(partial)).toEqual(["timeline"]);
  });
});
