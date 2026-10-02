import { describe, expect, it } from "vitest";
import {
  broadenSearchFor,
  canMatchLead,
  searchForLead,
} from "@/lib/leads/match";
import { applyExtraction } from "@/lib/leads/update";
import { findPropertyByName } from "@/lib/properties/search";
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

  it("drops a broad city once a locality within it is stated", () => {
    // "Delhi" then "Dwarka": keeping the bare city as a search area pulls in
    // every other Delhi locality, so a Dwarka buyer was shown Rohini.
    const first = qualify({
      intent: "Buy",
      location: "Delhi",
      bhk: "2",
      budget: 9_000_000,
    });
    const refined = applyExtraction(first, { location: "Dwarka" });
    const ids = searchForLead(refined).matches.map((property) => property.id);

    expect(refined.preferredLocations).toEqual(
      expect.arrayContaining(["Delhi", "Dwarka"]),
    );
    expect(ids).toContain("dwarka-heights");
    expect(ids).not.toContain("rohini-enclave");
  });

  it("refuses to search before the requirement is meaningful", () => {
    expect(canMatchLead(qualify({ location: "Dwarka", bhk: "2" }))).toBe(false);
    expect(
      canMatchLead(qualify({ intent: "Buy", location: "Dwarka", bhk: "2" })),
    ).toBe(false);
  });

  it("never reads a greeting as a property name", () => {
    // "hi" is a substring of "Rohini Enclave", so a substring test made a plain
    // hello look like a request for that listing — the assistant dropped a
    // property card on the customer before it knew anything about them.
    expect(findPropertyByName("hi")).toBeUndefined();
    expect(findPropertyByName("hello")).toBeUndefined();
    // A bare locality is qualification input, not a listing name — two Rohini
    // properties exist, so naming one from the word "Rohini" would be a guess.
    expect(findPropertyByName("Rohini")).toBeUndefined();
    expect(findPropertyByName("Delhi")).toBeUndefined();
  });

  it("still resolves a listing that is genuinely named", () => {
    expect(findPropertyByName("Rohini Enclave")?.id).toBe("rohini-enclave");
    expect(findPropertyByName("Dwarka Heights")?.id).toBe("dwarka-heights");
    expect(findPropertyByName("tell me more about Dwarka Heights")?.id).toBe(
      "dwarka-heights",
    );
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
