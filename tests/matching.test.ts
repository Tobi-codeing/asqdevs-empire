import { describe, expect, it } from "vitest";
import {
  broadenSearchFor,
  canMatchLead,
  searchForLead,
} from "@/lib/leads/match";
import { applyExtraction } from "@/lib/leads/update";
import { emptyLead, type Lead } from "@/lib/leads/types";

const qualify = (patch: Parameters<typeof applyExtraction>[1]): Lead =>
  applyExtraction(emptyLead("WhatsApp"), patch);

describe("property matching", () => {
  it("finds only listings that meet a stated requirement", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 9_500_000,
    });
    const result = searchForLead(lead);
    const ids = result.matches.map((property) => property.id);

    expect(result.ready).toBe(true);
    expect(ids).toContain("dwarka-heights");
    expect(ids).toContain("sky-residency");
    // A 3 BHK is not a 2 BHK, and another locality is not Dwarka.
    expect(ids).not.toContain("green-valley-estate");
    expect(ids).not.toContain("rohini-enclave");
  });

  it("refuses to search before the requirement is meaningful", () => {
    expect(canMatchLead(qualify({ location: "Dwarka", bhk: "2" }))).toBe(false);
    expect(
      canMatchLead(qualify({ intent: "Buy", location: "Dwarka", bhk: "2" })),
    ).toBe(false);
  });

  it("broadens honestly when nothing matches, naming what it relaxed", () => {
    const lead = qualify({
      intent: "Buy",
      location: "Dwarka",
      bhk: "2",
      budget: 3_000_000, // below anything in the inventory
    });
    const widened = broadenSearchFor(lead);
    expect(widened.properties.length).toBeGreaterThan(0);
    expect(widened.relaxed).toContain("budget");
  });
});
