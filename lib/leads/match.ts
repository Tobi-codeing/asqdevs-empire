import { getActiveProperties, getKnownLocations } from "@/lib/data/inventory";
import type { Property } from "@/lib/data/properties";
import type { Lead } from "@/lib/leads/types";
import { searchProperties } from "@/lib/properties/search";

/**
 * Matching is a lead concern, not a channel concern.
 *
 * Both the WhatsApp assistant and the phone receptionist run the same
 * qualification and the same search, so the rules live here rather than being
 * re-implemented per channel.
 */

/** Same locality name, allowing for casing and the city/locality overlap. */
const sameText = (a: string, b: string) =>
  a.toLowerCase().includes(b.toLowerCase()) ||
  b.toLowerCase().includes(a.toLowerCase());

/**
 * The areas worth searching for a lead.
 *
 * A lead with a stated locality searches only there. A lead that has said it is
 * flexible — or genuinely does not know the area — searches the whole known
 * inventory, which is the only way "I don't know where" can ever produce
 * results.
 *
 * Two ordering rules matter here. The most recently stated area is the primary
 * one, so it is searched first — a customer who refined "Delhi" to "Dwarka"
 * must see Dwarka results before anything else. And a broad city is not a
 * locality: once a stated locality belongs to it (Dwarka is in Delhi), the bare
 * city is dropped, because keeping it silently pulls in every other locality in
 * the city — the buyer asked for Dwarka and gets Rohini. A city stated on its
 * own survives, since then it is the whole requirement.
 */
export function searchAreasFor(lead: Lead): string[] {
  const stated = Array.from(
    new Set([...(lead.location ? [lead.location] : []), ...lead.preferredLocations]),
  ).filter(Boolean);

  const known = getKnownLocations();

  if (!stated.length) {
    return lead.budgetFlexible === true ? known.slice(0, 5) : [];
  }

  // An exact locality name, not a substring: "South Delhi" contains "Delhi",
  // but "Delhi" is still a broad city rather than a locality in its own right.
  const isLocality = (area: string) =>
    known.some(
      (location) => location.toLowerCase() === area.trim().toLowerCase(),
    );
  const citiesOfStated = new Set(
    getActiveProperties()
      .filter((property) =>
        stated.some((area) => sameText(area, property.location)),
      )
      .map((property) => property.city.toLowerCase()),
  );
  const narrowed = stated.filter(
    (area) => isLocality(area) || !citiesOfStated.has(area.toLowerCase()),
  );

  return (narrowed.length ? narrowed : stated).slice(0, 5);
}

/**
 * Is there enough on the lead to search with?
 *
 * Deliberately strict. Recommendation without a real intent, a size and a
 * budget produces confident nonsense, and a customer shown a "closest match"
 * they never asked for reads as a sales script rather than an assistant.
 */
export function canMatchLead(lead: Lead, areas: string[] = searchAreasFor(lead)): boolean {
  if (lead.intent !== "Buy" && lead.intent !== "Rent") return false;
  if (!areas.length) return false;
  if (!lead.bhk && !lead.propertyType) return false;
  return lead.budget != null || lead.budgetMin != null || lead.budgetMax != null;
}

/** The single budget figure matching is run against. */
export function leadBudget(lead: Lead): number | undefined {
  return lead.budgetMax ?? lead.budget ?? lead.budgetMin;
}

/**
 * Widen the search when nothing matched exactly.
 *
 * This is what the "Broaden search" button actually does — it is not a canned
 * acknowledgement. Each step drops one more of the customer's stated constraints
 * and reports exactly which ones it dropped, so the assistant can say what it
 * relaxed instead of quietly presenting a listing that ignores what was asked
 * for. If a step finds nothing it falls through to the next.
 */
export type BroadenedSearch = {
  properties: Property[];
  /** The stated requirements this result set does NOT honour. */
  relaxed: string[];
};

export function broadenSearchFor(lead: Lead, limit = 3): BroadenedSearch {
  const dedupe = (properties: Property[]) =>
    Array.from(new Map(properties.map((p) => [p.id, p])).values());

  const strict = searchForLead(lead);
  if (strict.matches.length)
    return { properties: strict.matches.slice(0, limit), relaxed: [] };

  // Keep the area and the size, drop the budget ceiling.
  const sameArea = dedupe(
    searchAreasFor(lead).flatMap((location) =>
      searchProperties({ location, bhk: lead.bhk, kind: lead.propertyType }),
    ),
  );
  if (sameArea.length)
    return { properties: sameArea.slice(0, limit), relaxed: ["budget"] };

  // Keep the size, allow any locality the inventory covers.
  const sameSize = dedupe(
    searchProperties({ bhk: lead.bhk, kind: lead.propertyType }),
  );
  if (sameSize.length)
    return { properties: sameSize.slice(0, limit), relaxed: ["budget", "location"] };

  // Last resort: the nearest thing we hold, whatever it is.
  return {
    properties: getActiveProperties().slice(0, limit),
    relaxed: ["budget", "location", "size"],
  };
}

/**
 * Run the controlled search for a lead, or return nothing when the lead is not
 * yet qualified. The inventory is the only source of truth here — the assistant
 * can never recommend from anything else.
 */
export function searchForLead(lead: Lead) {
  const areas = searchAreasFor(lead);
  if (!canMatchLead(lead, areas)) return { areas, matches: [], ready: false };

  const budget = leadBudget(lead);
  const matches = Array.from(
    new Map(
      areas
        .flatMap((location) =>
          searchProperties({
            location,
            bhk: lead.bhk,
            kind: lead.propertyType,
            budget,
          }),
        )
        .map((property) => [property.id, property]),
    ).values(),
  );

  return { areas, matches, ready: true };
}
