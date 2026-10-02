import type { Lead } from "@/lib/leads/types";
import type { Property } from "@/lib/data/properties";
import type { TranscriptEntry } from "@/lib/calls/transcript";

/**
 * Builds the post-call summary shown in the admin overview.
 *
 * This is derived from the conversation that actually happened — the lead the
 * voice session populated and the transcript it produced — rather than from
 * hardcoded demo copy. `lib/ai/summarize.ts` remains the single source of truth
 * for how structured lead state is phrased.
 */

export type CallOutcome = {
  /** One-paragraph narrative for the admin summary. */
  summary: string;
  /** Who the lead is, as understood from the call. */
  customerName: string;
  /** Requirement line, e.g. "2 BHK apartment in Dwarka". */
  requirement: string;
  /** How many properties the assistant matched. */
  matchCount: number;
  /** True when the caller asked for a site visit. */
  siteVisit: boolean;
  /** True when a human hand-off was requested. */
  handoff: boolean;
  /** Number of spoken turns captured, for the recording panel. */
  spokenTurns: number;
};

/** Every area the caller accepted, so the summary matches the lead record. */
const areaPhrase = (lead: Lead): string | undefined => {
  const areas = lead.preferredLocations.length
    ? lead.preferredLocations
    : lead.location
      ? [lead.location]
      : [];
  if (!areas.length) return undefined;
  return areas.length > 1 ? areas.join(" or ") : areas[0];
};

const intentPhrase = (lead: Lead): string => {
  switch (lead.intent) {
    case "Buy":
      return "is looking to buy";
    case "Rent":
      return "is looking to rent";
    case "Sell":
      return "is looking to sell";
    default:
      return "enquired about a property";
  }
};

const timelinePhrase = (timeline?: string): string => {
  if (!timeline) return "";
  if (timeline === "Immediately")
    return " and wants to move forward immediately";
  if (timeline === "Just exploring")
    return " and is currently exploring options";
  return ` and intends to move forward within ${timeline}`;
};

/** Compose the requirement line from whatever the call actually established. */
export function requirementLine(lead: Lead): string {
  const where = areaPhrase(lead);
  const parts = [
    lead.bhk,
    lead.propertyType?.toLowerCase(),
    where ? `in ${where}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return parts || "Requirements still being gathered";
}

export function buildCallOutcome(
  lead: Lead,
  matches: Property[],
  transcript: TranscriptEntry[],
): CallOutcome {
  const spoken = transcript.filter((entry) => entry.role !== "system");
  const customerName = lead.name ?? "Unidentified caller";
  const where = areaPhrase(lead);

  const sentences: string[] = [];
  sentences.push(
    `${customerName} ${intentPhrase(lead)}${lead.bhk ? ` a ${lead.bhk}` : ""}${
      where ? ` in ${where}` : ""
    }${timelinePhrase(lead.timeline)}.`,
  );

  if (lead.budgetLabel)
    sentences.push(`Budget indicated: approximately ${lead.budgetLabel}.`);

  if (lead.preferences.length) {
    sentences.push(
      `Preferences noted on the call: ${lead.preferences.join(", ")}.`,
    );
  }

  if (matches.length) {
    sentences.push(
      `${matches.length} matching ${matches.length === 1 ? "property was" : "properties were"} identified from the demo inventory and offered to the caller.`,
    );
  } else if (lead.location || lead.bhk || lead.budget != null) {
    sentences.push(
      "No matching listings were available in the demo inventory.",
    );
  }

  if (lead.siteVisit) {
    sentences.push(`A site visit was requested for ${lead.siteVisit}.`);
  }
  if (lead.advisorRequested) {
    sentences.push("The caller asked to speak with a human advisor.");
  } else if (lead.callbackRequested) {
    sentences.push("The caller asked for a callback.");
  }

  // Only a real voice call can claim voice turns; the text call has none.
  sentences.push(
    spoken.length
      ? `Captured by the AI receptionist over a ${spoken.length}-turn voice conversation and scored ${lead.score}/100 (${lead.temperature}).`
      : `Captured by the AI receptionist and scored ${lead.score}/100 (${lead.temperature}).`,
  );

  return {
    summary: sentences.join(" "),
    customerName,
    requirement: requirementLine(lead),
    matchCount: matches.length,
    siteVisit: Boolean(lead.siteVisit),
    handoff: Boolean(lead.advisorRequested || lead.callbackRequested),
    spokenTurns: spoken.length,
  };
}
