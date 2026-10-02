import type { Extraction } from "@/lib/ai/extract";
import { formatBudget, formatBudgetRange } from "@/lib/data/properties";
import { searchForLead } from "./match";
import {
  normaliseBhk,
  normaliseBudget,
  normaliseIntent,
  normaliseLocation,
  normalisePropertyId,
  normalisePropertyType,
  normaliseText,
  normaliseTimeline,
} from "./normalise";
import { scoreLead, statusFor, temperatureFor } from "./score";
import type { Lead } from "./types";

/**
 * Refresh the derived parts of a lead: its matches, score, temperature and
 * status.
 *
 * Matching runs through the same gate as every other channel, so a lead can
 * never accumulate recommendations while it is still missing the requirement
 * those recommendations would be based on.
 */
export function recompute(
  lead: Lead,
  options: { keepMatches?: boolean } = {},
): Lead {
  const withMatches: Lead = options.keepMatches
    ? lead
    : {
        ...lead,
        matchedPropertyIds: searchForLead(lead).matches.map((p) => p.id),
      };
  const score = scoreLead(withMatches);
  return {
    ...withMatches,
    score,
    temperature: temperatureFor(score, withMatches),
    status: statusFor(withMatches),
  };
}


/**
 * The one merge path into the canonical lead state.
 *
 * Every channel reaches the lead through here — the WhatsApp deterministic
 * parser, the WhatsApp model's structured output, the phone transcript and the
 * phone's tool calls. Nothing is written raw. Each proposed fact is normalised
 * into the shared vocabulary first (`lib/leads/normalise.ts`), so "buy",
 * "Buying" and "buy karna" are one intent, "2" and "2bhk" are one size, and a
 * malformed value is dropped rather than filed as a fact the admin view then has
 * to render as "Not provided".
 *
 * A stated value always wins: a corrected requirement replaces the old one
 * instead of coexisting with it. A field the customer did not mention is left
 * untouched, so a later sentence can never erase an earlier answer.
 */
export function applyExtraction(lead: Lead, patch: Extraction): Lead {
  const next: Lead = { ...lead };

  const name = normaliseText(patch.name, 80);
  if (name) next.name = name;

  const intent = normaliseIntent(patch.intent);
  if (intent) next.intent = intent;

  const propertyType = normalisePropertyType(patch.propertyType);
  if (propertyType) next.propertyType = propertyType;

  const bhk = normaliseBhk(patch.bhk);
  if (bhk) next.bhk = bhk;

  const timeline = normaliseTimeline(patch.timeline);
  if (timeline) next.timeline = timeline;

  const location = normaliseLocation(patch.location);
  if (location) next.location = location;

  if (patch.budgetFlexible != null) next.budgetFlexible = patch.budgetFlexible;

  const selectedPropertyId = normalisePropertyId(patch.selectedPropertyId);
  if (selectedPropertyId) next.selectedPropertyId = selectedPropertyId;

  if (patch.preferredLocations?.length) {
    const areas = Array.from(
      new Set(
        patch.preferredLocations
          .map(normaliseLocation)
          .filter((area): area is string => Boolean(area)),
      ),
    );
    if (areas.length) next.preferredLocations = areas;
  } else if (location && location !== lead.location) {
    // A newly stated area is an addition, not a replacement: "Gurgaon also
    // works" and "Dwarka or Noida" both widen the search rather than resetting
    // everything the customer already told us.
    next.preferredLocations = Array.from(
      new Set([...lead.preferredLocations, location]),
    );
  }

  return recompute(mergeBudget(next, patch));
}

/** Fold a proposed budget into the lead without ever creating a second copy. */
function mergeBudget(lead: Lead, patch: Extraction): Lead {
  const next: Lead = { ...lead };
  const budgetMin = normaliseBudget(patch.budgetMin);
  const budgetMax = normaliseBudget(patch.budgetMax);
  const budget = normaliseBudget(patch.budget);
  const label = normaliseText(patch.budgetLabel, 40);

  if (budgetMin != null) next.budgetMin = Math.min(budgetMin, budgetMax ?? budgetMin);
  if (budgetMax != null) next.budgetMax = Math.max(budgetMax, budgetMin ?? budgetMax);

  if (budget != null) {
    next.budget = budget;
    next.budgetMin = next.budgetMin ?? budget;
    next.budgetMax = next.budgetMax ?? budget;
    next.budgetLabel = label ?? formatBudget(budget);
    return next;
  }

  const min = next.budgetMin;
  const max = next.budgetMax;
  if (min != null && max != null && min !== max) {
    next.budget = next.budget ?? Math.round((min + max) / 2);
    next.budgetLabel = label ?? next.budgetLabel ?? formatBudgetRange(min, max);
  } else if (min != null || max != null) {
    const single = (min ?? max) as number;
    next.budget = next.budget ?? single;
    next.budgetLabel = label ?? next.budgetLabel ?? formatBudget(single);
  }
  return next;
}


/** Only report fields that were genuinely new, so we never re-ask or re-state. */
export function changedFields(before: Lead, after: Lead): string[] {
  const labels = new Set<string>();
  if (!before.intent && after.intent) labels.add(after.intent.toLowerCase());
  if (!before.location && after.location) labels.add(after.location);
  if (!before.bhk && after.bhk) labels.add(after.bhk);
  if (before.budget == null && after.budget != null && after.budgetLabel)
    labels.add(after.budgetLabel);
  if (before.budgetMin == null && after.budgetMin != null && after.budgetLabel)
    labels.add(after.budgetLabel);
  if (before.budgetMax == null && after.budgetMax != null && after.budgetLabel)
    labels.add(after.budgetLabel);
  if (!before.timeline && after.timeline) labels.add(after.timeline);
  return Array.from(labels);
}
