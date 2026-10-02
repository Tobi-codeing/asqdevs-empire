import { KNOWN_LOCATIONS, formatBudget } from "@/lib/data/properties";
import { budgetForMatching } from "@/lib/leads/score";
import { CORE_FIELDS, missingFields, type CoreField, type Lead } from "@/lib/leads/types";

/**
 * The canonical option sets behind the quick-reply buttons.
 *
 * These are the application-owned vocabulary for a qualification question. The
 * model is allowed to phrase a button in its own words, but the set of answers
 * the assistant can actually act on is defined here, so a typed answer and a
 * tapped answer are understood identically.
 */
export const OPTIONS: Record<CoreField, string[]> = {
  intent: ["Buy", "Rent", "Sell"],
  location: KNOWN_LOCATIONS.slice(0, 5),
  bhk: ["1 BHK", "2 BHK", "3 BHK", "4+ BHK"],
  budget: ["Around ₹60L", "Around ₹90L", "Around ₹1.2Cr", "Above ₹1.5Cr"],
  timeline: ["Immediately", "1–3 months", "3–6 months", "Just exploring"],
};

/** What to offer once the requirement is complete enough to act on. */
export const MATCH_FOLLOWUPS = [
  "Schedule a site visit",
  "Talk to an advisor",
  "Show more options",
];

export const AFTER_HANDOFF = ["Schedule a site visit", "Talk to an advisor"];
export const RESTART_REPLIES = ["Restart demo"];

/**
 * The honest ways out of a no-match. These are the only buttons that make sense
 * once everything is known but nothing in the inventory fits, so they replace
 * the usual "show more options" set rather than sitting alongside it.
 */
export const NO_MATCH_ACTIONS = [
  "Broaden search",
  "Adjust budget",
  "Talk to an advisor",
];


const nextCoreField = (lead: Lead): CoreField | undefined =>
  missingFields(lead)[0];

/** Budget options centred on what the customer can actually afford. */
function budgetOptions(lead: Lead): string[] {
  const anchor = budgetForMatching(lead);
  if (anchor == null) return OPTIONS.budget;
  const bands = [0.6, 0.9, 1.2, 1.6].map((multiple) =>
    formatBudget(Math.round((anchor * multiple) / 100_000) * 100_000),
  );
  return Array.from(new Set([formatBudget(anchor), ...bands]));
}

/**
 * Build the buttons for the current state of the conversation.
 *
 * Two rules drive this. The buttons must describe the *next* thing still
 * missing, so a question the customer already answered never comes back; and
 * once there is something concrete to show, the buttons switch to actions on
 * that content rather than more qualification.
 */
/** The actions the customer has already completed, so they are not re-offered. */
function completedFrom(lead: Lead) {
  return {
    siteVisit: Boolean(lead.siteVisit),
    advisor: Boolean(lead.advisorRequested),
    callback: Boolean(lead.callbackRequested),
  };
}

export function suggestedReplies(
  lead: Lead,
  options: { hasMatches: boolean; hasSelectedProperty: boolean; finished?: boolean },
): string[] {
  const done = completedFrom(lead);

  if (options.finished) return ["Done"];

  if (options.hasSelectedProperty) {
    const actions: string[] = [];
    if (!done.siteVisit) actions.push("Book a site visit");
    if (!done.advisor) actions.push("Talk to an advisor");
    return Array.from(
      new Set([...actions, "Amenities", "Location", "Show more options"]),
    ).slice(0, 4);
  }

  if (options.hasMatches) {
    const replies: string[] = [];
    if (!done.siteVisit) replies.push("Schedule a site visit");
    if (!done.advisor) replies.push("Talk to an advisor");
    replies.push("Show more options");
    return replies.slice(0, 4);
  }

  const field = nextCoreField(lead);
  // Everything is known and still nothing matched, so the useful next moves are
  // the honest ones — never another round of the same qualification.
  if (!field) {
    const replies: string[] = [];
    if (!done.siteVisit) replies.push("Schedule a site visit");
    if (!done.advisor) replies.push("Talk to an advisor");
    replies.push("Broaden search", "Adjust budget");
    return replies.slice(0, 4);
  }
  if (field === "budget") return budgetOptions(lead);
  return OPTIONS[field];
}

/**
 * Fold the model's suggested buttons into the canonical set.
 *
 * The model's phrasing is kept where it is genuinely contextual, but anything
 * offering an answer the assistant has already been given is dropped, and the
 * result is topped up from the canonical set so the customer always has usable
 * buttons for whatever is still missing.
 */
export function reconcileReplies(
  modelReplies: string[] | undefined,
  lead: Lead,
  options: { hasMatches: boolean; hasSelectedProperty: boolean; finished?: boolean },
): string[] {
  const settled = new Set<string>();
  if (lead.intent) settled.add(lead.intent.toLowerCase());
  if (lead.bhk) settled.add(lead.bhk.toLowerCase());
  if (lead.timeline) settled.add(lead.timeline.toLowerCase());
  for (const location of lead.preferredLocations) settled.add(location.toLowerCase());
  if (lead.location) settled.add(lead.location.toLowerCase());

  const isSettled = (reply: string) => {
    const value = reply.toLowerCase().trim();
    if (settled.has(value)) return true;
    // A button restating a known fact is noise; "Tell me more" is not.
    if (/^(more|show|view|and)\b/.test(value) && settled.has(value.replace(/^(more|show|view|and)\s+/, "")))
      return true;
    return [...settled].some(
      (fact) => fact.length > 3 && value.includes(fact) && !value.includes(" or "),
    );
  };

  const done = completedFrom(lead);

  /*
   * A completed action is never offered again. The model is free to suggest a
   * button, but it cannot put the assistant back in a loop the customer already
   * left — a site visit or a hand-off that has happened is filtered out here.
   */
  const isCompletedAction = (reply: string) => {
    const value = reply.toLowerCase();
    if (done.advisor && /advisor|human|agent|insaan/.test(value)) return true;
    if (done.siteVisit && /\bvisit\b|dekhne|milne|mil sakt/.test(value)) return true;
    if (done.callback && /\bcallback\b|call back/.test(value)) return true;
    return false;
  };

  /*
   * While the assistant is still qualifying, the buttons ARE the question, so
   * they come from the canonical set only. Letting the model's passing
   * suggestions in here is how a greeting ended up offering "Dwarka" and
   * "Rohini" as buttons while the one answer that mattered — Sell — was pushed
   * off the end of the row. Once there is something concrete to act on
   * (matches or a named property) the model's contextual phrasing is allowed
   * back in, because then it is describing real listings rather than guessing
   * at a question it was already asked to phrase in the reply.
   */
  if (!options.hasMatches && !options.hasSelectedProperty && !options.finished) {
    const canonical = suggestedReplies(lead, options);
    if (canonical.length) return canonical.slice(0, 4);
  }

  const kept = (modelReplies ?? [])
    .map((reply) => reply.trim())
    .filter((reply) => reply && reply.length <= 60)
    .filter((reply) => !isSettled(reply))
    .filter((reply) => !isCompletedAction(reply));

  const merged = [
    ...kept,
    ...suggestedReplies(lead, options).filter(
      (reply) => !kept.some((k) => k.toLowerCase() === reply.toLowerCase()),
    ),
  ];

  return Array.from(new Set(merged.map((reply) => reply.trim())))
    .filter((reply) => !isCompletedAction(reply))
    .slice(0, 4);
}

/** The fields still open, in the order the assistant should ask about them. */
export function openFields(lead: Lead): CoreField[] {
  return CORE_FIELDS.filter((field) => missingFields(lead).includes(field));
}
