import { formatBudget, type Property } from "@/lib/data/properties";
import {
  canMatchLead,
  leadBudget,
  searchAreasFor,
  searchForLead,
} from "@/lib/leads/match";
import type { Lead } from "@/lib/leads/types";
import { findNearMisses } from "@/lib/properties/search";
import { toSentLink, type SentLink } from "@/lib/whatsapp/messages";

/** Never send more than this in one message unless the customer asks again. */
export const MAX_MATCHES = 3;

export { canMatchLead as canSearch, searchAreasFor, searchForLead };

/**
 * The compact inventory view handed to the model.
 *
 * Only real records, with only their real fields. When there is no exact match
 * the nearby alternatives are passed too — clearly labelled with which stated
 * requirement they miss, so the assistant can be honest instead of quietly
 * relaxing something the customer cares about.
 */
export function inventoryContext(
  lead: Lead,
  areas: string[],
  matches: Property[],
): { matches: unknown[]; nearMisses: unknown[]; ready: boolean } {
  const query = {
    bhk: lead.bhk,
    kind: lead.propertyType,
    budget: leadBudget(lead),
  };

  const nearMisses = matches.length
    ? []
    : areas
        .flatMap((location) =>
          findNearMisses(
            { ...query, location },
            { relax: ["budget", "location"], limit: 2 },
          ).map(({ property, mismatches }) => ({
            id: property.id,
            name: property.name,
            bhk: `${property.bhk} BHK`,
            kind: property.kind,
            location: property.location,
            priceLabel: property.priceLabel,
            summary: property.summary,
            doesNotMatch: mismatches,
          })),
        )
        .slice(0, 4);

  return {
    ready: matches.length > 0,
    matches: matches.slice(0, 5).map((property) => ({
      id: property.id,
      name: property.name,
      bhk: `${property.bhk} BHK`,
      kind: property.kind,
      location: property.location,
      priceLabel: property.priceLabel,
      availability: property.availability,
      furnishing: property.furnishing,
      amenities: property.amenities,
      summary: property.summary,
    })),
    nearMisses,
  };
}

/** Absolute detail-page link, built from the record so it can never be wrong. */
export function sentLinkFor(property: Property, origin: string): SentLink {
  return { ...toSentLink(property), url: `${origin}${property.detailPageUrl}` };
}

/** The canonical budget band a lead was matched against, for the recap. */
export function budgetBandFor(lead: Lead): string | undefined {
  const min = lead.budgetMin;
  const max = lead.budgetMax;
  if (min != null && max != null && min !== max) {
    return `${formatBudget(min)}–${formatBudget(max)}`;
  }
  const single = leadBudget(lead);
  return single != null ? formatBudget(single) : undefined;
}
