import { getPropertyById } from "@/lib/data/inventory";
import type { Property } from "@/lib/data/properties";
import { budgetSummaryText, formatLocation } from "@/lib/leads/format";
import { formatPhone } from "@/lib/leads/normalise";
import { missingFields, type Lead } from "@/lib/leads/types";
import { searchForLead } from "@/lib/leads/match";

/**
 * The single admin projection of the canonical lead state.
 *
 * Both admin surfaces — the live panel beside the conversation and the
 * end-of-conversation overview — render from here. Before this existed the two
 * built their own field lists: one showed "2 BHK apartment", the other just
 * "2 BHK", and one printed the raw internal next-action key ("ask_size") where
 * the customer-facing view had always shown a sentence. Two interpretations of
 * the same conversation is exactly how an admin record ends up disagreeing with
 * the summary printed next to it.
 */

export type LeadField = {
  label: string;
  value?: string;
  /** Shown when the value is genuinely absent, so nothing reads as an error. */
  placeholder?: string;
};

/** The property the conversation centred on, if the customer named one. */
export function selectedProperty(lead: Lead): Property | undefined {
  if (!lead.selectedPropertyId) return undefined;
  return getPropertyById(lead.selectedPropertyId);
}

/** "2 BHK apartment" — size and format joined the one way everywhere. */
export function propertyLabel(lead: Lead): string | undefined {
  const spec = [lead.bhk, lead.propertyType?.toLowerCase()]
    .filter(Boolean)
    .join(" ")
    .trim();
  return spec || undefined;
}

/**
 * The canonical next-action key, derived from state rather than from whatever
 * any single channel happened to write onto the lead.
 */
export function nextActionKey(
  lead: Lead,
  options: { hasMatches?: boolean } = {},
): string {
  if (lead.optOut) return "opted_out";
  if (lead.advisorRequested) return "human_handoff";
  if (lead.callbackRequested) return "callback";
  if (lead.siteVisit) return "site_visit";
  if (lead.selectedPropertyId) return "property_question";
  if (options.hasMatches ?? searchForLead(lead).matches.length > 0)
    return "show_properties";
  const missing = missingFields(lead)[0];
  if (!missing) return "show_properties";
  return `ask_${missing === "bhk" ? "size" : missing}`;
}

const ASK_LABEL: Record<string, string> = {
  ask_intent: "Ask whether they are buying, renting or selling",
  ask_location: "Ask which area they are considering",
  ask_size: "Ask what size they need",
  ask_budget: "Ask what budget to work within",
  ask_timeline: "Ask when they want to move",
  show_properties: "Offer the matched properties and a site visit",
  explore_areas: "Help them shortlist an area before searching",
  property_question: "Send the full details of the property they asked about",
  site_visit: "Confirm the site visit",
  callback: "Call them back at the agreed time",
  human_handoff: "Assign to a property advisor",
  opted_out: "No follow-up — the customer opted out",
};

/**
 * A human sentence for the same decision the assistant is about to take.
 *
 * The internal key is still stored on the lead (other systems may switch on it),
 * but nothing read by a person is allowed to show it.
 */
export function nextActionLabel(
  lead: Lead,
  options: { hasMatches?: boolean } = {},
): string {
  const key = nextActionKey(lead, options);

  if (key === "site_visit") {
    const pending = /requested|to confirm|pending/i.test(lead.siteVisit ?? "");
    return pending
      ? `Confirm the requested site visit — ${lead.siteVisit}`
      : `Prepare for the site visit — ${lead.siteVisit}`;
  }
  if (key === "callback")
    return lead.callbackAt
      ? `Call back — ${lead.callbackAt}`
      : "Call back and confirm a time";
  if (key === "opted_out")
    return "No follow-up — the customer opted out";
  if (key === "property_question") {
    const property = selectedProperty(lead);
    return property
      ? `Send full details of ${property.name}`
      : "Send the full details of the property they asked about";
  }
  return ASK_LABEL[key] ?? "Continue the conversation";
}

/**
 * The exact rows the lead record shows, in a fixed order.
 *
 * Order is deliberate: the commercial basics first, then the decisions, then the
 * provenance. Every field the requirement lists is present, including the ones
 * the two older panels each omitted — lead temperature, the selected property,
 * the appointment and the callback.
 */
export function leadFieldsFor(lead: Lead): LeadField[] {
  const property = selectedProperty(lead);
  return [
    { label: "Name", value: lead.name, placeholder: "Not shared yet" },
    {
      label: "Phone",
      value: lead.phone ? formatPhone(lead.phone) : undefined,
      placeholder: "Not shared yet",
    },
    { label: "Intent", value: lead.intent },
    {
      label: "Location",
      value:
        lead.preferredLocations.length > 1
          ? lead.preferredLocations.map(formatLocation).join(" or ")
          : lead.location
            ? formatLocation(lead.location)
            : undefined,
    },
    { label: "Property", value: propertyLabel(lead) },
    { label: "Budget", value: budgetSummaryText(lead) },
    { label: "Timeline", value: lead.timeline },
    {
      label: "Preferences",
      value: lead.preferences.length
        ? lead.preferences.join(", ")
        : undefined,
      placeholder: "None stated yet",
    },
    {
      label: "Selected property",
      value: property ? `${property.name} — ${property.priceLabel}` : undefined,
      placeholder: "None yet",
    },
    {
      label: "Appointment",
      value: lead.siteVisit,
      placeholder: "Not scheduled",
    },
    {
      label: "Callback",
      value: lead.callbackRequested
        ? (lead.callbackAt ?? "Requested — time to confirm")
        : undefined,
      placeholder: "Not requested",
    },
    { label: "Lead source", value: lead.source },
    {
      label: "Lead temperature",
      value: `${lead.temperature} · ${lead.score}/100`,
    },
    { label: "Next action", value: nextActionLabel(lead) },
  ];
}
