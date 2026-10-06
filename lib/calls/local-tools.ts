import {
  findNearMisses,
  getPropertyDetails,
  searchProperties,
} from "@/lib/properties/search";
import { bookingLabel } from "@/lib/ai/dates";
import { checkSlot } from "@/lib/demo/slots";
import type { Property } from "@/lib/data/properties";

const brief = (property: Property) => ({
  id: property.id,
  name: property.name,
  bhk: `${property.bhk} BHK`,
  kind: property.kind,
  location: property.location,
  priceLabel: property.priceLabel,
  price: property.price,
  availability: property.availability,
  furnishing: property.furnishing,
});

/**
 * Execute tool calls instantaneously in-memory (0ms latency).
 * Eliminates HTTP network round-trips and cold starts during live phone calls.
 */
export function executeToolLocally(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "searchProperties": {
      const query = {
        location: typeof args.location === "string" ? args.location : undefined,
        bhk: typeof args.bhk === "string" ? args.bhk : undefined,
        kind: typeof args.kind === "string" ? args.kind : undefined,
        budget: typeof args.budget === "number" ? args.budget : undefined,
      };

      const hasCriteria =
        Boolean(query.location) ||
        Boolean(query.bhk) ||
        Boolean(query.kind) ||
        Boolean(query.budget && query.budget > 0);

      if (!hasCriteria) {
        return {
          ok: false,
          error: "insufficient_criteria",
          note: "Acknowledge the caller warmly in Hindi Devanagari. Mention that we have great options across Delhi (Dwarka, Rohini, Saket) and ask what BHK size or budget they have in mind.",
        };
      }

      const results = searchProperties(query);
      if (results.length) {
        return {
          ok: true,
          count: results.length,
          properties: results.map(brief),
          note: "These are matching listings from Delhi Homes inventory. Recommend 1 or 2 options warmly in Hindi (Devanagari) and ask if they would like to book a site visit.",
        };
      }

      const nearMisses = findNearMisses(query, { relax: ["budget"] });
      return {
        ok: true,
        count: 0,
        properties: [],
        nearMisses: nearMisses.map(({ property, mismatches }) => ({
          ...brief(property),
          doesNotMatch: mismatches,
        })),
        note: nearMisses.length
          ? "No exact match in that exact range, but nearby options exist. Suggest the closest option warmly in Hindi (Devanagari)."
          : "No direct match in that range. Suggest exploring nearby areas like Dwarka or Rohini.",
      };
    }

    case "getPropertyDetails": {
      const id = typeof args.id === "string" ? args.id : "";
      const property = getPropertyDetails(id);
      if (!property) return { ok: false, error: "not_found" };
      return {
        ok: true,
        property,
        note: `Full property details for ${property.name}: ${property.bhk} BHK in ${property.location}, ${property.priceLabel}. Mention key highlights warmly in Hindi (Devanagari).`,
      };
    }

    case "createLead": {
      return {
        ok: true,
        leadId: `LD-${Date.now().toString(36)}`,
        captured: args,
        note: "Lead details noted. Continue the conversation warmly and smoothly.",
      };
    }

    case "scheduleVisit": {
      const date = typeof args.date === "string" ? args.date.trim() : "";
      const time = typeof args.time === "string" ? args.time.trim() : "";
      if (!date || !time) {
        return {
          ok: false,
          error: "missing_date_or_time",
          note: "Ask for whichever is missing — date or time — in one short sentence in Hindi (Devanagari).",
        };
      }
      const slot = checkSlot(date, time);
      const requestedLabel = bookingLabel(date, time);
      if (!slot.available) {
        return {
          ok: false,
          error: "slot_unavailable",
          requested: requestedLabel,
          alternatives: slot.alternatives,
          note: `That slot is outside visiting hours. Suggest ${slot.alternatives.join(" or ")} warmly in Hindi (Devanagari).`,
        };
      }
      return {
        ok: true,
        booked: true,
        slot: requestedLabel,
        note: `Visit scheduled for ${requestedLabel}. If you do not have their contact number, ask for it in Hindi: "बहुत बढ़िया! कृपया अपना मोबाइल नंबर बता दीजिए ताकि हमारी टीम आपसे संपर्क कर सके।" If you already have their number, proceed to the final confirmation.`,
      };
    }

    case "requestCallback": {
      const date = typeof args.date === "string" ? args.date.trim() : undefined;
      const time = typeof args.time === "string" ? args.time.trim() : undefined;
      return {
        ok: true,
        requested: true,
        callback: date || time ? bookingLabel(date, time) : undefined,
        note: "Callback requested. Confirm warmly in Hindi that an advisor will call them back.",
      };
    }

    case "transferToHuman": {
      return {
        ok: true,
        transferred: true,
        note: "Transferring to human advisor with full context. Inform the caller warmly in Hindi (Devanagari).",
      };
    }

    default:
      return { ok: false, error: "unknown_tool" };
  }
}
