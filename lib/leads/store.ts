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

function getRelayUrl(): string | undefined {
  const value = process.env.VOICE_RELAY_URL?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

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

/** Newest first. Tries persistent relay first if configured, else reads local store. */
export async function getStoredLeads(): Promise<StoredLead[]> {
  const relayUrl = getRelayUrl();
  if (relayUrl) {
    try {
      const res = await fetch(`${relayUrl}/api/leads`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.leads) && data.leads.length > 0) {
          const relayIds = new Set(data.leads.map((l: StoredLead) => l.id));
          const localOnly = load().filter((l) => !relayIds.has(l.id));
          return [...data.leads, ...localOnly];
        }
      }
    } catch {
      /* relay unreachable or timing out — proceed with local storage */
    }
  }
  return load();
}

/** Record or update a lead. Returns the stored record. */
export function recordLead(input: LeadDeliveryInput): StoredLead {
  const payload = buildLeadPayload(input);
  const receivedAt = new Date().toISOString();

  const currentLeads = load();
  const existingIndex = currentLeads.findIndex((l) => {
    if (input.id && l.id === input.id) {
      return true;
    }
    if (payload.phone && payload.phone !== "Not shared yet" && l.phone === payload.phone) {
      return true;
    }
    // Also match by recent source and identical name/intent if phone not yet shared
    if (
      payload.name &&
      payload.name !== "Not shared yet" &&
      l.name === payload.name &&
      l.source === payload.source
    ) {
      return true;
    }
    return false;
  });

  const leadId =
    existingIndex >= 0
      ? currentLeads[existingIndex].id
      : input.id ||
        `${payload.source.toLowerCase()}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;

  const isJunk = (str?: string) => {
    if (!str) return false;
    const norm = str.replace(/['"`]/g, "").toLowerCase().trim();
    return norm === "así es" || norm === "asi es" || norm === "hindi" || norm === "हिंदी" || norm === "english";
  };

  const isAnonymous = (str?: string) => {
    if (!str) return true;
    const norm = str.replace(/['"`]/g, "").toLowerCase().trim();
    return norm === "caller" || norm === "not shared yet" || isJunk(str);
  };

  const cleanName = isAnonymous(payload.name) ? "New enquiry" : payload.name;

  const record: StoredLead = {
    ...payload,
    name: cleanName,
    id: leadId,
    receivedAt: receivedAt,
    recordingUrl: payload.recordingUrl || (existingIndex >= 0 ? currentLeads[existingIndex].recordingUrl : undefined),
  };

  let updatedList: StoredLead[];
  if (existingIndex >= 0) {
    const without = currentLeads.filter((_, idx) => idx !== existingIndex);
    updatedList = [record, ...without].slice(0, MAX_LEADS);
  } else {
    updatedList = [record, ...currentLeads].slice(0, MAX_LEADS);
  }

  // Only purge empty records that have literally zero qualification content AND junk name without a phone
  updatedList = updatedList.filter((l) => {
    const hasContent = Boolean(
      (l.score && l.score > 0) ||
      l.budget ||
      l.bhk ||
      l.location ||
      (l.transcript && l.transcript.length > 0)
    );
    if (hasContent) return true;
    if (isJunk(l.name) && (!l.phone || l.phone === "Not shared yet")) return false;
    return true;
  });

  inMemoryLeads = updatedList;

  // Clean any stale records for this same customer that lacked a phone number
  if (
    payload.phone &&
    payload.phone !== "Not shared yet" &&
    payload.name &&
    payload.name !== "Not shared yet"
  ) {
    const normName = payload.name.toLowerCase().trim();
    updatedList = updatedList.filter(
      (l) =>
        l.id === record.id ||
        !(
          l.name &&
          l.name.toLowerCase().trim() === normName &&
          l.source === payload.source &&
          (!l.phone || l.phone === "Not shared yet" || l.phone.trim() === "")
        ),
    );
    inMemoryLeads = updatedList;
  }

  // Fire-and-forget sync to Render persistent relay service if available
  const relayUrl = getRelayUrl();
  if (relayUrl && !isTest()) {
    void syncLeadToRelay(record).catch(() => undefined);
  }

  if (isTest()) return record;

  persist(updatedList);
  return record;
}

/**
 * Explicitly awaitable sync to persistent relay. Critical on serverless (Vercel)
 * where the container freezes immediately when the request handler returns.
 */
export async function syncLeadToRelay(record: StoredLead): Promise<boolean> {
  const relayUrl = getRelayUrl();
  if (!relayUrl || isTest()) return false;
  try {
    const res = await fetch(`${relayUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(3500),
    });
    return res.ok;
  } catch (err) {
    console.warn("[leads] relay sync error:", err);
    return false;
  }
}

