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

const LOCAL_DATA_DIR = join(process.cwd(), "data");
const LOCAL_LEADS_FILE = join(LOCAL_DATA_DIR, "leads.json");
const TMP_DATA_DIR = join("/tmp", "asqdevs-data");
const TMP_LEADS_FILE = join(TMP_DATA_DIR, "leads.json");
const MAX_LEADS = 300;

function ensureWritableDir(): string {
  try {
    if (!existsSync(LOCAL_DATA_DIR)) {
      mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    }
    return LOCAL_DATA_DIR;
  } catch {
    try {
      if (!existsSync(TMP_DATA_DIR)) {
        mkdirSync(TMP_DATA_DIR, { recursive: true });
      }
      return TMP_DATA_DIR;
    } catch {
      return LOCAL_DATA_DIR;
    }
  }
}

/** Tests exercise the turn logic, not the filesystem — never write during them. */
const isTest = () =>
  process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

export type StoredLead = LeadPayload & {
  /** Stable id for the admin list. */
  id: string;
  /** When the app recorded it (distinct from the lead's own capturedAt). */
  receivedAt: string;
};

let inMemoryLeads: StoredLead[] = [];

function load(): StoredLead[] {
  try {
    const targetFile = existsSync(LOCAL_LEADS_FILE)
      ? LOCAL_LEADS_FILE
      : existsSync(TMP_LEADS_FILE)
        ? TMP_LEADS_FILE
        : null;

    if (targetFile) {
      const parsed = JSON.parse(readFileSync(targetFile, "utf-8"));
      if (Array.isArray(parsed)) {
        const ids = new Set(inMemoryLeads.map((l) => l.id));
        return [...inMemoryLeads, ...(parsed as StoredLead[]).filter((l) => !ids.has(l.id))];
      }
    }
  } catch {
    /* corrupt or missing — fall back to in-memory */
  }
  return inMemoryLeads;
}

function persist(leads: StoredLead[]) {
  try {
    const dir = ensureWritableDir();
    const file = join(dir, "leads.json");
    writeFileSync(file, JSON.stringify(leads.slice(0, MAX_LEADS), null, 2), "utf-8");
  } catch (err) {
    console.warn("[leads] could not persist leads to disk, keeping in memory:", err);
  }
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
  inMemoryLeads = [record, ...inMemoryLeads].slice(0, MAX_LEADS);
  if (isTest()) return record;

  const leads = [record, ...load()];
  persist(leads);
  return record;
}
