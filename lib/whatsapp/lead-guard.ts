import { PROPERTIES } from "@/lib/data/properties";
import { parseTimeline, type Extraction } from "@/lib/ai/extract";
import { emptyLead, type Intent, type Lead } from "@/lib/leads/types";

/**
 * Boundary validation for anything crossing into lead state.
 *
 * The model proposes facts; this module decides which of them are admissible.
 * Nothing reaches the lead without passing through here, which is what keeps a
 * hallucinated locality, a nonsense budget or an invented property id from
 * becoming a "fact" the admin panel then reports.
 */

export const VALID_INTENTS = new Set<Intent>(["Buy", "Rent", "Sell", "Enquiry"]);

export const NEXT_STEPS = [
  "ask_intent",
  "ask_location",
  "ask_size",
  "ask_budget",
  "ask_timeline",
  "show_properties",
  "explore_areas",
  "property_question",
  "site_visit",
  "callback",
  "human_handoff",
  "continue",
] as const;

export type NextStep = (typeof NEXT_STEPS)[number];

const MAX_BUDGET = 2_000_000_000;

const text = (value: unknown, max = 100) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;

const money = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_BUDGET
    ? Math.round(value)
    : undefined;

const knownPropertyId = (value: unknown): string | undefined =>
  typeof value === "string" && PROPERTIES.some((property) => property.id === value)
    ? value
    : undefined;

/** Rehydrate a lead from untrusted client state, dropping anything invalid. */
export function safeLead(input?: Partial<Lead>): Lead {
  const lead = emptyLead(input?.source === "Phone" ? "Phone" : "WhatsApp");
  if (!input || typeof input !== "object") return lead;
  lead.source = input.source === "Phone" ? "Phone" : "WhatsApp";

  const name = text(input.name, 80);
  if (name) lead.name = name;
  if (VALID_INTENTS.has(input.intent as Intent)) lead.intent = input.intent as Intent;

  const location = text(input.location, 80);
  if (location) lead.location = location;
  if (Array.isArray(input.preferredLocations)) {
    lead.preferredLocations = Array.from(
      new Set(
        input.preferredLocations
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 80))
          .filter(Boolean),
      ),
    ).slice(0, 5);
  }

  const propertyType = text(input.propertyType, 50);
  if (propertyType) lead.propertyType = propertyType;
  const bhk = text(input.bhk, 20);
  if (bhk) lead.bhk = bhk;

  for (const key of ["budget", "budgetMin", "budgetMax"] as const) {
    const amount = money(input[key]);
    if (amount != null) lead[key] = amount;
  }
  if (typeof input.budgetFlexible === "boolean") lead.budgetFlexible = input.budgetFlexible;
  const budgetLabel = text(input.budgetLabel, 40);
  if (budgetLabel) lead.budgetLabel = budgetLabel;

  const timeline = text(input.timeline, 50);
  if (timeline) lead.timeline = timeline;

  if (Array.isArray(input.preferences)) {
    lead.preferences = Array.from(
      new Set(
        input.preferences
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 80))
          .filter(Boolean),
      ),
    ).slice(0, 12);
  }

  const selectedPropertyId = knownPropertyId(input.selectedPropertyId);
  if (selectedPropertyId) lead.selectedPropertyId = selectedPropertyId;

  if (typeof input.score === "number" && Number.isFinite(input.score)) {
    lead.score = Math.max(0, Math.min(100, Math.round(input.score)));
  }
  if (input.temperature === "HOT" || input.temperature === "WARM" || input.temperature === "COLD") {
    lead.temperature = input.temperature;
  }
  if (["New", "Qualifying", "Qualified", "Handed off"].includes(input.status ?? "")) {
    lead.status = input.status as Lead["status"];
  }

  const siteVisit = text(input.siteVisit, 100);
  if (siteVisit) lead.siteVisit = siteVisit;
  if (Array.isArray(input.siteVisitAlternatives)) {
    lead.siteVisitAlternatives = input.siteVisitAlternatives
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 100))
      .slice(0, 4);
  }
  const callbackAt = text(input.callbackAt, 100);
  if (callbackAt) lead.callbackAt = callbackAt;
  if (typeof input.callbackRequested === "boolean") lead.callbackRequested = input.callbackRequested;
  if (typeof input.advisorRequested === "boolean") lead.advisorRequested = input.advisorRequested;
  const nextAction = text(input.nextAction, 80);
  if (nextAction) lead.nextAction = nextAction;
  if (typeof input.recapSent === "boolean") lead.recapSent = input.recapSent;
  if (typeof input.optOut === "boolean") lead.optOut = input.optOut;

  if (Array.isArray(input.matchedPropertyIds)) {
    lead.matchedPropertyIds = Array.from(
      new Set(input.matchedPropertyIds.filter((id): id is string => knownPropertyId(id) !== undefined)),
    );
  }

  return lead;
}

/**
 * Filter the model's proposed facts against what the customer actually said.
 *
 * Two checks matter most. A property type is only accepted when the word for it
 * appears in the message — otherwise a "2 BHK" is quietly relabelled an
 * apartment, which then filters real matches away. And the timeline is
 * re-parsed with the deterministic parser so "next year" and "12 months" cannot
 * diverge.
 */
export function validatedExtraction(value: unknown, userText: string): Extraction {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const patch: Extraction = {};

  if (VALID_INTENTS.has(raw.intent as Intent)) patch.intent = raw.intent as Intent;

  const name = text(raw.name, 80);
  if (name) patch.name = name;
  const location = text(raw.location, 80);
  if (location) patch.location = location;
  const bhk = text(raw.bhk, 20);
  if (bhk) patch.bhk = bhk;

  const propertyType = text(raw.propertyType, 50);
  if (propertyType && /\b(apartment|flat|villa|studio|penthouse|builder floor)\b/i.test(userText)) {
    patch.propertyType = propertyType;
  }

  const timeline = text(raw.timeline, 50);
  if (timeline) patch.timeline = parseTimeline(timeline) ?? timeline;

  if (Array.isArray(raw.preferredLocations)) {
    patch.preferredLocations = raw.preferredLocations
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 5);
  }

  const budget = money(raw.budget);
  if (budget != null) patch.budget = budget;
  const budgetMin = money(raw.budgetMin);
  if (budgetMin != null) patch.budgetMin = budgetMin;
  const budgetMax = money(raw.budgetMax);
  if (budgetMax != null) patch.budgetMax = budgetMax;
  if (
    patch.budgetMin != null &&
    patch.budgetMax != null &&
    patch.budgetMin > patch.budgetMax
  ) {
    [patch.budgetMin, patch.budgetMax] = [patch.budgetMax, patch.budgetMin];
  }
  if (typeof raw.budgetFlexible === "boolean") patch.budgetFlexible = raw.budgetFlexible;

  if (Array.isArray(raw.preferences)) {
    patch.preferences = raw.preferences
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);
  }

  const selectedPropertyId = knownPropertyId(raw.selectedPropertyId);
  if (selectedPropertyId) patch.selectedPropertyId = selectedPropertyId;

  return patch;
}

export function parseNextStep(value: unknown): NextStep {
  return typeof value === "string" && NEXT_STEPS.includes(value as NextStep)
    ? (value as NextStep)
    : "continue";
}
