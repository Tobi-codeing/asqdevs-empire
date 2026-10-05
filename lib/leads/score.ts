import { getActiveProperties } from '@/lib/data/inventory';
import type { Lead, LeadStatus, Temperature } from './types';

/**
 * Lead scoring is a backend rule, never the model's intuition. The weights below
 * reward genuinely meaningful signals — real intent, a budget the inventory can
 * actually serve, a timeline, and action taken — rather than simply counting how
 * many fields happen to be filled.
 */
const WEIGHTS = {
  intent: 15,
  location: 12,
  bhk: 12,
  budget: 15,
  timeline: 12,
  name: 4,
  preferences: 4,
} as const;

/**
 * The strongest buying signals, worth real points. A lead cannot go HOT on
 * form-filling alone; these are what a sales team actually cares about.
 */
const SIGNAL_WEIGHTS = {
  /** A concrete next step: the caller committed to something. */
  siteVisit: 20,
  advisor: 14,
  callback: 12,
} as const;

/**
 * True when the lead's stated budget can realistically be served by the current
 * inventory. "I have 20 lakh and I want to buy in South Delhi" is not a hot
 * lead, however complete the form looks.
 */
export function hasRealisticBudget(lead: Lead): boolean {
  const amount =
    lead.budgetMax ?? lead.budgetMin ?? lead.budget ?? null;
  if (amount == null) return false;
  const cheapest = Math.min(
    ...getActiveProperties().map((property) => property.price),
  );
  return amount >= cheapest * 0.8;
}

/**
 * The highest figure the caller mentioned.
 *
 * Used where a single number is needed, such as centring the budget buttons on
 * what the customer can actually afford. Matching itself runs through
 * `lib/leads/match.ts`, which applies the qualification gate first.
 */
export function budgetForMatching(lead: Lead): number | undefined {
  return lead.budgetMax ?? lead.budgetMin ?? lead.budget ?? undefined;
}

/** How much of the requirement is captured: 0–5 core fields filled. */
export function requirementCoverage(lead: Lead): number {
  return [lead.intent, lead.location, lead.bhk, lead.budget, lead.timeline].filter(
    (value) => value != null && value !== '',
  ).length;
}

export function scoreLead(lead: Lead): number {
  let score = 0;

  if (lead.intent) score += WEIGHTS.intent;
  if (lead.location) score += WEIGHTS.location;
  if (lead.bhk) score += WEIGHTS.bhk;
  if (lead.budget != null || lead.budgetMin != null || lead.budgetMax != null)
    score += WEIGHTS.budget;
  if (lead.timeline) score += WEIGHTS.timeline;
  if (lead.name) score += WEIGHTS.name;
  if (lead.preferences.length) score += WEIGHTS.preferences;

  // Only reward the budget field fully when the inventory can serve it; a
  // hopeless budget is a qualification problem, not a buying signal.
  if (
    (lead.budget != null || lead.budgetMin != null || lead.budgetMax != null) &&
    !hasRealisticBudget(lead)
  )
    score -= 10;

  // Matching inventory is itself evidence the requirement is addressable, but it
  // is a small signal — having inventory must not by itself raise a lead.
  if (lead.matchedPropertyIds.length > 0) score += 6;

  // A requested-but-unconfirmed action is a weak signal. Only genuine completion
  // (a booked visit, a confirmed callback, an accepted hand-off) counts fully.
  if (lead.siteVisit) score += scoreForVisit(lead);
  if (lead.advisorRequested) score += SIGNAL_WEIGHTS.advisor;
  if (lead.callbackRequested) score += SIGNAL_WEIGHTS.callback;

  // A timeline of "just exploring" is engagement without urgency.
  if (lead.timeline === 'Just exploring') score -= 8;

  return Math.max(0, Math.min(100, score));
}

/**
 * A visit the backend rejected is not a buying signal worth the full weight —
 * the caller asked, but nothing was actually arranged.
 */
function scoreForVisit(lead: Lead): number {
  const pending =
    /requested|to confirm|pending/i.test(lead.siteVisit ?? '') &&
    (lead.siteVisitAlternatives?.length ?? 0) > 0;
  return pending ? Math.round(SIGNAL_WEIGHTS.siteVisit / 2) : SIGNAL_WEIGHTS.siteVisit;
}

/**
 * HOT requires both coverage and at least one real buying signal, so a lead
 * cannot be marked hot merely because five fields were filled in.
 */
export function temperatureFor(score: number, lead?: Lead): Temperature {
  if (lead) {
    const hasSignal = Boolean(
      lead.siteVisit || lead.advisorRequested || lead.callbackRequested,
    );
    const readyIntent =
      (lead.intent === 'Buy' || lead.intent === 'Rent') && hasRealisticBudget(lead);

    // A hot lead must be actionable: real intent, a serviceable budget, and
    // either a committed next step or a near-complete requirement.
    if (hasSignal && readyIntent) return 'HOT';
    if (score >= 70 && readyIntent && requirementCoverage(lead) >= 4) return 'HOT';

    if (hasSignal || (readyIntent && requirementCoverage(lead) >= 3)) return 'WARM';
    if (score >= 35) return 'WARM';
    return 'COLD';
  }

  if (score >= 65) return 'HOT';
  if (score >= 35) return 'WARM';
  return 'COLD';
}

export function statusFor(lead: Lead): LeadStatus {
  if (lead.advisorRequested || lead.callbackRequested) return 'Handed off';
  const filled = requirementCoverage(lead);
  if (filled === 5) return 'Qualified';
  if (filled > 0) return 'Qualifying';
  return 'New';
}
