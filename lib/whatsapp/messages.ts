import { formatPriceBand, type Property } from "@/lib/data/properties";
import { SITE_URL } from "@/lib/site";
import type { Lead } from "@/lib/leads/types";
import {
  formatBudgetDisplay,
  formatLeadSummary,
  formatLocation,
  formatTimeline,
} from "@/lib/leads/format";
import { getPropertiesByIds } from "@/lib/data/inventory";

/**
 * How many matches the assistant will send at once.
 * More than this is only ever sent when the customer explicitly asks.
 */
export const MAX_MATCHES = 3;
export const DEFAULT_SUGGESTED = 2;

/** A single property link recorded in the conversation, sent to the customer. */
export type SentLink = {
  propertyId: string;
  name: string;
  /** Absolute URL so the recorded link is exactly what the customer opens. */
  url: string;
  priceLabel: string;
  location: string;
  bhk: number;
  /** e.g. "View Dwarka Heights →" */
  label: string;
};

/** Absolute base for property links — the canonical origin, never a bare path. */
const linkBase = () => SITE_URL;

/** Build a SentLink straight from the structured property record. */
export function toSentLink(property: Property): SentLink {
  return {
    propertyId: property.id,
    name: property.name,
    url: `${linkBase()}${property.detailPageUrl}`,
    priceLabel: property.priceLabel,
    location: property.location,
    bhk: property.bhk,
    label: `View ${property.name} →`,
  };
}

/** "#. Name — 2 BHK — ₹92L\n   View full details: <url>" */
function matchBlock(
  property: Property,
  index: number,
  includeBhk = true,
): string {
  const spec = includeBhk ? `${property.bhk} BHK — ` : "";
  return [
    `${index}. ${property.name} — ${spec}${property.priceLabel}`,
    `   View full details: ${linkBase()}${property.detailPageUrl}`,
  ].join("\n");
}

/**
 * Sent the moment a customer names a specific property, so they never wait
 * until the end of the conversation for a link they asked for.
 */
export function propertyLinkMessage(property: Property): {
  text: string;
  link: SentLink;
} {
  const link = toSentLink(property);
  const text = [
    `Sure. Here's the complete listing for ${property.name}:`,
    "",
    `${property.name} — ${property.bhk} BHK ${property.kind.toLowerCase()} in ${property.location}, ${property.priceLabel}.`,
    property.summary,
    "",
    `${link.label} ${link.url}`,
  ].join("\n");

  return { text, link };
}

/** "Buying" / "Renting" / "Looking to sell" — readable, not mechanically derived. */
const intentPhrase: Record<string, string> = {
  Buy: "Buying",
  Rent: "Renting",
  Sell: "Looking to sell",
  Enquiry: "Enquiring",
};

/** Build the requirement recap line from structured lead state — never invented. */
export function requirementLines(lead: Lead): string[] {
  const spec =
    [lead.bhk, lead.propertyType].filter(Boolean).join(" ") || undefined;
  const lines: string[] = [];
  if (spec) lines.push(spec);
  if (lead.location) lines.push(formatLocation(lead.location));

  const budgetText = lead.budgetLabel
    ? `Around ${lead.budgetLabel}`
    : formatBudgetDisplay(lead.budgetMin, lead.budgetMax, lead.budget);
  if (budgetText) lines.push(budgetText);

  if (lead.intent) lines.push(intentPhrase[lead.intent] ?? lead.intent);
  if (lead.timeline) lines.push(formatTimeline(lead.timeline));
  if (lead.preferences.length)
    lines.push(`Preferences: ${lead.preferences.join(", ")}`);
  return lines;
}

/** One-line summary of the requirement, for the end-of-conversation message. */
export function summariseRequirement(lead: Lead): string {
  return formatLeadSummary(lead);
}

/** Human label for the decided next action, shared with the admin panel. */
export function nextStepLabel(lead: Lead): string {
  if (lead.advisorRequested) return "Talk to a property advisor";
  if (lead.callbackRequested) return "A callback from an advisor";
  if (lead.siteVisit) return `Site visit — ${lead.siteVisit}`;
  if (lead.status === "Qualified")
    return "Choose a site visit or an advisor call";
  return "Talk to an advisor";
}

/**
 * The concise recap sent once the conversation reaches a natural completion.
 * Links are generated from the matched property records passed in.
 */
export function finalRecapMessage(
  lead: Lead,
  properties: Property[],
): { text: string; links: SentLink[] } {
  const shown = properties.slice(0, MAX_MATCHES);
  const links = shown.map(toSentLink);
  const lines = requirementLines(lead);

  /*
   * Written the way a person closes a WhatsApp conversation: the requirement on
   * one line, then the homes, then the single thing that happens next. No bullet
   * points and no repeated sign-off — the older version read as a report and
   * said the same closing sentence twice.
   */
  const blocks = ["Perfect — here's what I have for your requirement."];

  if (lines.length) blocks.push(lines.join(" · "));

  if (shown.length) {
    blocks.push(
      ["Closest matches:", ...shown.map((p, i) => matchBlock(p, i + 1))].join(
        "\n",
      ),
    );
  } else {
    blocks.push(
      "Nothing in my current inventory matches this closely, so I've noted your requirement for our property advisor.",
    );
  }

  blocks.push(`Next step: ${nextStepLabel(lead)}`);

  return { text: blocks.join("\n\n"), links };
}

/**
 * Send additional matches only when the customer explicitly asks for more —
 * paginated so they receive a small, relevant batch rather than the full set.
 */
export function additionalMatchesMessage(
  ordered: Property[],
  alreadySentIds: string[],
): { text: string; links: SentLink[] } | undefined {
  const remaining = ordered
    .filter((property) => !alreadySentIds.includes(property.id))
    .slice(0, MAX_MATCHES);

  if (!remaining.length) return undefined;

  const links = remaining.map(toSentLink);
  const text = [
    "Sure — here are a few more that fit what you shared:",
    "",
    remaining.map((p, i) => matchBlock(p, i + 1)).join("\n\n"),
  ].join("\n");

  return { text, links };
}

/**
 * The honest way out of a no-match, and the message shown when a broadened
 * search does find something. Both name exactly which stated requirement was
 * relaxed, so nothing is presented as a match when it is not one.
 */
export const NO_EXACT_MATCH = [
  "I couldn't find an exact match in the current listings.",
  "We can broaden the search, or I can bring in an advisor.",
].join(" ");

const RELAX_LABEL: Record<string, string> = {
  budget: "budget",
  location: "location",
  size: "size",
  kind: "property type",
};

export function broadenedMessage(
  properties: Property[],
  relaxed: string[],
): { text: string; links: SentLink[] } | undefined {
  const shown = properties.slice(0, MAX_MATCHES);
  if (!shown.length) return undefined;

  const relaxedLabels = relaxed
    .map((field) => RELAX_LABEL[field] ?? field)
    .filter(Boolean);

  const caveat = relaxedLabels.length
    ? `I widened the search and relaxed your ${relaxedLabels.join(" and ")} to find these — they are close, but not an exact match:`
    : "These are the closest I have to what you asked for:";

  return {
    text: [caveat, "", shown.map((p, i) => matchBlock(p, i + 1)).join("\n\n")].join(
      "\n",
    ),
    links: shown.map(toSentLink),
  };
}

/** The matched properties for a lead, most relevant first, capped. */
export function matchedProperties(lead: Lead, limit = MAX_MATCHES): Property[] {
  return getPropertiesByIds(lead.matchedPropertyIds).slice(0, limit);
}

/** Compact price-band label, e.g. "₹90L–₹1Cr", derived from the matched set. */
export function matchedPriceBand(properties: Property[]): string | undefined {
  return formatPriceBand(properties.map((p) => p.price));
}
