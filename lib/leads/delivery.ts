import { absolutePropertyUrl, type Property } from "@/lib/data/properties";
import { buildSummary } from "@/lib/ai/summarize";
import { nextActionLabel } from "@/lib/leads/view";
import type { Lead } from "@/lib/leads/types";

/**
 * Delivers a finished lead to wherever the business wants it — a Google Sheet,
 * a CRM, Slack, or an automation platform (Zapier / Make / n8n).
 *
 * Why one webhook instead of a per-provider SDK
 * ---------------------------------------------
 * Every one of those destinations can receive an HTTP POST, so a single
 * `LEAD_WEBHOOK_URL` covers all of them with no dependency, no OAuth dance and
 * nothing to keep in sync. The business owner pastes one URL; swapping Google
 * Sheets for HubSpot later is a new URL, not a code change.
 *
 * Two properties matter more than features here:
 *
 *  1. **It can never break the conversation.** The destination is optional. With
 *     no `LEAD_WEBHOOK_URL` set, delivery is skipped silently and the demo works
 *     exactly as before. A failing destination is logged and swallowed — a lead
 *     the CRM missed must never turn into an error the customer sees.
 *
 *  2. **It is awaited, not fire-and-forget.** On a serverless host (Vercel) the
 *     process is frozen as soon as the response is sent, so an un-awaited fetch
 *     is routinely killed mid-flight. Delivery is therefore awaited with a short
 *     timeout — it happens on the one turn a conversation completes.
 */

/** The webhook destination, or undefined when the integration is not configured. */
function webhookUrl(): string | undefined {
  const value = process.env.LEAD_WEBHOOK_URL?.trim();
  return value || undefined;
}

/** True when a lead destination has been configured. */
export function leadDeliveryConfigured(): boolean {
  return Boolean(webhookUrl());
}

/** A spoken turn, reduced to what a CRM record needs. */
export type DeliveredTurn = { role: string; text: string };

export type LeadDeliveryInput = {
  lead: Lead;
  /** The properties offered to the customer, so the agent sees what they saw. */
  matches?: Property[];
  /** The conversation, for the agent's context. */
  transcript?: DeliveredTurn[];
  /** Set when the customer has asked not to be contacted again. */
  optOut?: boolean;
};

/** One matched property, flattened for a spreadsheet row or a CRM field. */
export type DeliveredMatch = {
  name: string;
  bhk: string;
  location: string;
  price: string;
  url: string;
};

export type LeadPayload = {
  source: string;
  capturedAt: string;
  name: string;
  phone: string;
  intent: string;
  location: string;
  preferredLocations: string[];
  propertyType: string;
  bhk: string;
  budget: string;
  budgetValue: number | null;
  timeline: string;
  preferences: string[];
  requirement: string;
  siteVisit: string;
  callbackRequested: boolean;
  advisorRequested: boolean;
  /** Carried with the lead so no follow-up sequence can ignore it. */
  optedOutFollowUps: boolean;
  score: number;
  temperature: string;
  status: string;
  nextAction: string;
  summary: string;
  matches: DeliveredMatch[];
  transcript: DeliveredTurn[];
  /** The summary as one line — convenient for Slack, email or a Sheet cell. */
  text: string;
};

/** "2 BHK apartment in Dwarka" — the requirement as one readable phrase. */
function requirementPhrase(lead: Lead): string {
  const areas = lead.preferredLocations.length
    ? lead.preferredLocations
    : lead.location
      ? [lead.location]
      : [];
  return [
    lead.bhk,
    lead.propertyType?.toLowerCase(),
    areas.length ? `in ${areas.join(" or ")}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Build the exact object that is POSTed.
 *
 * Kept pure and exported so the payload a Sheet receives is testable without a
 * live webhook — the shape of what leaves the app is the contract with the
 * business, not an implementation detail.
 */
export function buildLeadPayload({
  lead,
  matches = [],
  transcript = [],
  optOut,
}: LeadDeliveryInput): LeadPayload {
  const summary = buildSummary(lead, matches, lead.source);

  return {
    source: lead.source,
    capturedAt: new Date().toISOString(),
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    intent: lead.intent ?? "",
    location: lead.location ?? "",
    preferredLocations: lead.preferredLocations,
    propertyType: lead.propertyType ?? "",
    bhk: lead.bhk ?? "",
    budget: lead.budgetLabel ?? "",
    budgetValue: lead.budget ?? lead.budgetMax ?? lead.budgetMin ?? null,
    timeline: lead.timeline ?? "",
    preferences: lead.preferences,
    requirement: requirementPhrase(lead),
    siteVisit: lead.siteVisit ?? "",
    callbackRequested: Boolean(lead.callbackRequested),
    advisorRequested: Boolean(lead.advisorRequested),
    optedOutFollowUps: Boolean(optOut ?? lead.optOut),
    score: lead.score,
    temperature: lead.temperature,
    status: lead.status,
    nextAction: nextActionLabel(lead),
    summary,
    matches: matches.map((property) => ({
      name: property.name,
      bhk: `${property.bhk} BHK ${property.kind}`,
      location: property.location,
      price: property.priceLabel,
      url: absolutePropertyUrl(property),
    })),
    transcript: transcript.map((turn) => ({
      role: turn.role,
      text: turn.text,
    })),
    text: summary,
  };
}

export type LeadDeliveryResult =
  | { ok: true }
  | { ok: false; skipped: true }
  | { ok: false; skipped?: false; error: string };

/**
 * POST the lead to the configured destination.
 *
 * Never throws and never rejects: a lead the destination missed is a log line,
 * not a broken conversation. The timeout is deliberately short because this runs
 * before the customer's final reply is returned.
 */
export async function deliverLead(
  input: LeadDeliveryInput,
): Promise<LeadDeliveryResult> {
  const url = webhookUrl();
  if (!url) return { ok: false, skipped: true };

  const token = process.env.LEAD_WEBHOOK_TOKEN?.trim();
  const payload = buildLeadPayload(input);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      console.warn(
        `[leads] delivery rejected by the destination (${response.status})`,
      );
      return { ok: false, error: `http_${response.status}` };
    }

    return { ok: true };
  } catch (error) {
    console.warn(
      `[leads] delivery failed — ${
        error instanceof Error ? error.message.slice(0, 160) : "unknown error"
      }`,
    );
    return { ok: false, error: "network" };
  }
}
