import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLeadPayload,
  type LeadDeliveryInput,
  type LeadPayload,
} from "./delivery";

/**
 * Local lead record for the admin view.
 *
 * Both channels already funnel their finished lead through one canonical shape
 * (`buildLeadPayload` — see `lib/leads/delivery`). This module keeps the last N
 * of those records on disk so the admin can see exactly what each conversation
 * produced, without a CRM. Nothing here re-derives a lead; it stores the same
 * payload the webhook would receive, so the admin view, the CRM and the
 * customer-facing summary can never disagree.
 *
 * Server-only (`node:fs`).
 */

const DATA_DIR = join(process.cwd(), "data");
const LEADS_FILE = join(DATA_DIR, "leads.json");
const MAX_LEADS = 300;

/** Tests exercise the turn logic, not the filesystem — never write during them. */
const isTest = () =>
  process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

export type StoredLead = LeadPayload & {
  /** Stable id for the admin list. */
  id: string;
  /** When the app recorded it (distinct from the lead's own capturedAt). */
  receivedAt: string;
};

function load(): StoredLead[] {
  try {
    if (existsSync(LEADS_FILE)) {
      const parsed = JSON.parse(readFileSync(LEADS_FILE, "utf-8"));
      if (Array.isArray(parsed)) return parsed as StoredLead[];
    }
  } catch {
    /* corrupt or missing — start fresh */
  }
  return [];
}

function persist(leads: StoredLead[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, MAX_LEADS), null, 2), "utf-8");
}

/** Newest first. */
export function getStoredLeads(): StoredLead[] {
  return load();
}

/** Record one finished lead. Returns the stored record. */
export function recordLead(input: LeadDeliveryInput): StoredLead {
  const payload = buildLeadPayload(input);
  const receivedAt = new Date().toISOString();
  const record: StoredLead = {
    ...payload,
    id: `${payload.source.toLowerCase()}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    receivedAt,
  };
  if (isTest()) return record;

  const leads = [record, ...load()];
  persist(leads);
  return record;
}
