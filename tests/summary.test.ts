import { describe, expect, it } from "vitest";
import { buildSummary } from "@/lib/ai/summarize";
import { buildCallOutcome } from "@/lib/gemini/summary";
import { PROPERTIES } from "@/lib/data/properties";
import { applyExtraction, recompute } from "@/lib/leads/update";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { leadFieldsFor, nextActionLabel } from "@/lib/leads/view";

const qualify = (patch: Parameters<typeof applyExtraction>[1]): Lead =>
  applyExtraction(emptyLead("WhatsApp"), patch);

describe("summary generation", () => {
  it("is built from lead state and never invents detail", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
      timeline: "12 months",
    });
    const matches = PROPERTIES.filter((p) => p.location === "Dwarka" && p.bhk === 2);
    const summary = buildSummary(lead, matches, "WhatsApp");

    expect(summary).toContain("2 BHK");
    expect(summary).toContain("Dwarka");
    expect(summary).toContain("₹95L");
    // Nothing beyond the data actually collected.
    expect(summary).not.toMatch(/parking|gym|sea view/i);
  });

  it("names every accepted area, matching the lead record", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
    });
    const widened = applyExtraction(lead, { location: "Gurgaon" });
    const summary = buildSummary(widened, [], "WhatsApp");
    expect(summary).toContain("Dwarka or Gurugram");
  });
});

describe("call outcome summary", () => {
  it("is well-formed prose, with no run-on sentences", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
      timeline: "12 months",
    });
    const outcome = buildCallOutcome(lead, [], []);

    expect(outcome.summary).toMatch(
      /in Dwarka and intends to move forward within 12 months\./,
    );
    expect(outcome.summary).toContain("Budget indicated: approximately ₹95L.");
    expect(outcome.summary).not.toContain("Dwarka Budget");
  });

  it("does not claim voice turns for a text conversation", () => {
    const lead = qualify({ intent: "Buy", location: "Dwarka", bhk: "2" });
    expect(buildCallOutcome(lead, [], []).summary).not.toMatch(/0-turn/);
  });
});

describe("canonical admin projection", () => {
  it("renders a human next action, never the internal key", () => {
    const lead = qualify({ intent: "Buy", location: "Dwarka" });
    const label = nextActionLabel(lead);
    expect(label).not.toMatch(/^ask_/);
    expect(label).not.toContain("ask_size");
    expect(label.length).toBeGreaterThan(0);
  });

  it("lists the fields the lead record must show", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
    });
    const labels = leadFieldsFor(lead).map((field) => field.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Lead source",
        "Lead temperature",
        "Selected property",
        "Appointment",
        "Callback",
        "Next action",
      ]),
    );
  });

  it("shows the appointment once a visit is captured", () => {
    // A visit is an action outcome, not an extracted fact — exactly as the
    // phone tool path writes it.
    const lead = recompute({
      ...qualify({
        intent: "Buy",
        location: "Dwarka",
        bhk: "2",
        budget: 9_500_000,
      }),
      siteVisit: "Saturday 3 October, 11:00 AM",
    });
    const appointment = leadFieldsFor(lead).find(
      (field) => field.label === "Appointment",
    );
    expect(appointment?.value).toContain("Saturday 3 October");
    expect(nextActionLabel(lead)).toMatch(/site visit/i);
  });
});
