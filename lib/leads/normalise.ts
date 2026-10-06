import {
  getActiveProperties,
  getKnownLocations,
} from "@/lib/data/inventory";
import type { Intent } from "@/lib/leads/types";

/**
 * The one vocabulary every ingress into the lead state must speak.
 *
 * There are four ways a fact can reach a lead — the WhatsApp deterministic
 * parser, the WhatsApp model's structured output, the phone transcript, and a
 * phone tool call. Each can be wrong or merely differently worded ("buy",
 * "Buying", "buy karna"; "2", "2bhk", "2 BHK apartment"). If any of them is
 * written to the lead unvalidated, the admin panel reports a value the rest of
 * the system cannot act on — which is how a conversation that clearly
 * established an intent ends up filed as "Not provided".
 *
 * Canonical forms:
 *   intent   "Buy" | "Rent" | "Sell" | "Enquiry"
 *   bhk      "1 BHK" … "4+ BHK"
 *   timeline one of TIMELINES
 *   location a known locality, or the customer's own words title-cased
 *   budget   rupees, a whole number
 */

export const CANONICAL_INTENTS: readonly Intent[] = [
  "Buy",
  "Rent",
  "Sell",
  "Enquiry",
];

/** The timeline buckets the assistant offers and the admin view reports. */
export const TIMELINES = [
  "Immediately",
  "1–3 months",
  "3–6 months",
  "6–12 months",
  "12 months",
  "Just exploring",
] as const;

export type Timeline = (typeof TIMELINES)[number];

/** The largest figure anyone could plausibly mean by "budget" (₹200 Cr). */
const MAX_BUDGET = 2_000_000_000;

const INTENT_ALIASES: Record<string, Intent> = {
  buy: "Buy",
  buying: "Buy",
  purchase: "Buy",
  purchasing: "Buy",
  kharid: "Buy",
  kharidna: "Buy",
  "buy karna": "Buy",
  rent: "Rent",
  rental: "Rent",
  renting: "Rent",
  lease: "Rent",
  kiraya: "Rent",
  sell: "Sell",
  selling: "Sell",
  sale: "Sell",
  bechna: "Sell",
  enquiry: "Enquiry",
  inquiry: "Enquiry",
  enquire: "Enquiry",
  inquire: "Enquiry",
  enquiring: "Enquiry",
  exploring: "Enquiry",
};

const TIMELINE_ALIASES: Record<string, Timeline> = {
  immediately: "Immediately",
  immediate: "Immediately",
  asap: "Immediately",
  urgent: "Immediately",
  now: "Immediately",
  "1-3 months": "1–3 months",
  "1–3 months": "1–3 months",
  "0-3 months": "1–3 months",
  "3-6 months": "3–6 months",
  "3–6 months": "3–6 months",
  "6-12 months": "6–12 months",
  "6–12 months": "6–12 months",
  "12 months": "12 months",
  "1 year": "12 months",
  "one year": "12 months",
  "next year": "12 months",
  "just exploring": "Just exploring",
  exploring: "Just exploring",
  "not sure": "Just exploring",
  browsing: "Just exploring",
};

export const normaliseText = (value: unknown, max = 120): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

export function normaliseIntent(value: unknown): Intent | undefined {
  const raw = normaliseText(value, 40);
  if (!raw) return undefined;
  const direct = CANONICAL_INTENTS.find(
    (intent) => intent.toLowerCase() === raw.toLowerCase(),
  );
  if (direct) return direct;
  const collapsed = raw.toLowerCase().replace(/\s+/g, " ");
  return (
    INTENT_ALIASES[collapsed] ??
    INTENT_ALIASES[collapsed.split(" ")[0]] ??
    undefined
  );
}

/**
 * "2" / "2bhk" / "2 BHK" / "4+" / "4+ BHK" all become "2 BHK" / "4+ BHK".
 * Anything outside a plausible range is rejected rather than stored.
 */
export function normaliseBhk(value: unknown): string | undefined {
  if (typeof value === "number") {
    return value >= 1 && value <= 10 ? `${value} BHK` : undefined;
  }
  const raw = normaliseText(value, 30);
  if (!raw) return undefined;

  // An explicitly open-ended size: "4+", "4 plus", "4 or more".
  const plus = raw.match(/\b(\d+)\s*(?:\+|plus|or more|and above|se zyada)\b/i);
  if (plus) {
    const size = Number(plus[1]);
    return size >= 1 && size <= 10 ? `${size}+ BHK` : undefined;
  }

  const digits = raw.match(/(\d+)/);
  if (!digits) return undefined;
  const size = Number(digits[1]);
  if (size < 1 || size > 10) return undefined;
  return `${size} BHK`;
}

export function normaliseTimeline(value: unknown): string | undefined {
  const raw = normaliseText(value, 40);
  if (!raw) return undefined;
  const direct = TIMELINES.find(
    (timeline) => timeline.toLowerCase() === raw.toLowerCase(),
  );
  if (direct) return direct;
  const collapsed = raw.toLowerCase().replace(/\s+/g, " ");
  if (TIMELINE_ALIASES[collapsed]) return TIMELINE_ALIASES[collapsed];

  // "next 4 months" and friends: map the number onto the right bucket.
  const months = collapsed.match(/(\d+)\s*(?:month|mahine)/);
  if (months) {
    const count = Number(months[1]);
    if (count <= 3) return "1–3 months";
    if (count <= 6) return "3–6 months";
    if (count <= 12) return "6–12 months";
    return "12 months";
  }
  return undefined;
}

/**
 * Locality names have one spelling in the inventory, and "Gurgaon" is not it.
 * A locality we do not recognise is still kept — it is what the customer said,
 * and pretending they said something else would be worse.
 */
export function normaliseLocation(value: unknown): string | undefined {
  const raw = normaliseText(value, 80);
  if (!raw) return undefined;
  const collapsed = raw
    .replace(/gurgaon/gi, "Gurugram")
    .replace(/\s+/g, " ")
    .trim();
  const known = getKnownLocations().find(
    (location) => location.toLowerCase() === collapsed.toLowerCase(),
  );
  if (known) return known;
  if (/^[a-z]+(?:\s+[a-z]+)*$/i.test(collapsed)) {
    return collapsed
      .split(" ")
      .map((word) =>
        word.length > 2
          ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          : word.toUpperCase(),
      )
      .join(" ");
  }
  return collapsed;
}

export function normalisePropertyType(value: unknown): string | undefined {
  const raw = normaliseText(value, 40);
  if (!raw) return undefined;
  const known = ["Apartment", "Villa", "Studio", "Penthouse", "Builder Floor"];
  return known.find((kind) => kind.toLowerCase() === raw.toLowerCase()) ?? raw;
}

/** A plausible rupee amount, or nothing at all. */
export function normaliseBudget(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > MAX_BUDGET) return undefined;
  return Math.round(value);
}

/**
 * Convert Devanagari numerals (०, १, २, ३, ४, ५, ६, ७, ८, ९) to standard ASCII digits (0-9).
 */
export function normaliseDevanagariDigits(text: string): string {
  return text.replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

const HINDI_WORD_DIGITS: [RegExp, string][] = [
  [/(^|[\s,.-])(?:शून्य|शुन्य)(?=[\s,.-]|$)/g, "$10 "],
  [/(^|[\s,.-])(?:एक)(?=[\s,.-]|$)/g, "$11 "],
  [/(^|[\s,.-])(?:दो)(?=[\s,.-]|$)/g, "$12 "],
  [/(^|[\s,.-])(?:तीन)(?=[\s,.-]|$)/g, "$13 "],
  [/(^|[\s,.-])(?:चार)(?=[\s,.-]|$)/g, "$14 "],
  [/(^|[\s,.-])(?:पाँच|पांच)(?=[\s,.-]|$)/g, "$15 "],
  [/(^|[\s,.-])(?:छह|छः|छे)(?=[\s,.-]|$)/g, "$16 "],
  [/(^|[\s,.-])(?:सात)(?=[\s,.-]|$)/g, "$17 "],
  [/(^|[\s,.-])(?:आठ)(?=[\s,.-]|$)/g, "$18 "],
  [/(^|[\s,.-])(?:नौ)(?=[\s,.-]|$)/g, "$19 "],
  [/\b(?:zero|shunya|shoonya)\b/gi, "0"],
  [/\b(?:one|ek)\b/gi, "1"],
  [/\b(?:two|do)\b/gi, "2"],
  [/\b(?:three|teen)\b/gi, "3"],
  [/\b(?:four|char|chaar)\b/gi, "4"],
  [/\b(?:five|paanch|panch)\b/gi, "5"],
  [/\b(?:six|chhe|chhah|che)\b/gi, "6"],
  [/\b(?:seven|saat|sat)\b/gi, "7"],
  [/\b(?:eight|aath|ath)\b/gi, "8"],
  [/\b(?:nine|nau)\b/gi, "9"],
];

/** Convert sequences of spoken number words in text to numeric digits */
export function convertSpokenDigitWords(text: string): string {
  let res = text;
  for (let i = 0; i < 2; i++) {
    for (const [pattern, repl] of HINDI_WORD_DIGITS) {
      res = res.replace(pattern, repl);
    }
  }
  return res;
}

/**
 * A phone number, reduced to the ten-digit Indian mobile it actually is.
 *
 * Callers say "+91 98765 43210", "09876543210" or "9876543210" and all three
 * mean one number. Anything that is not a plausible Indian mobile is rejected
 * rather than stored, so a stray digit string from a garbled transcript never
 * becomes the number the sales team dials.
 */
export function normalisePhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const devanagariFixed = normaliseDevanagariDigits(value);
  const digits = devanagariFixed.replace(/\D/g, "");
  let local = digits;
  if (local.length >= 12 && local.startsWith("091")) local = local.slice(3);
  else if (local.length >= 11 && local.startsWith("91")) local = local.slice(2);
  else if (local.length >= 11 && local.startsWith("0")) local = local.slice(1);

  // Accept 9 to 10 digits starting with 5-9 (handles 9-digit spoken numbers like 748586309, VoIP, and standard 10-digit Indian mobiles)
  if ((local.length === 10 || local.length === 9) && /^[5-9]/.test(local)) {
    return local;
  }
  return undefined;
}

/**
 * Extract an Indian contact number from free text (English, Hindi, or mixed sentence).
 *
 * Deliberately strict on digits but robust against sentence context:
 * - Won't greedily eat adjacent numbers (like "2 BHK" or "90L").
 * - Handles Devanagari numerals (०-९).
 * - Handles spoken digit words in Hindi and English.
 */
export function extractPhone(raw: string): string | undefined {
  if (!raw) return undefined;

  // 1. Normalise Devanagari numerals (०-९ -> 0-9)
  let text = normaliseDevanagariDigits(raw);

  // 2. Normalise spoken digit words if any
  text = convertSpokenDigitWords(text);

  // 3. Direct match for clean input with optional country code (+91, 91, 0)
  const clean = text.replace(/[\s()-]/g, "");
  const directMatch = clean.match(/^(?:\+?91|0)?([5-9]\d{8,9})$/);
  if (directMatch) {
    const normalised = normalisePhone(directMatch[0]);
    if (normalised) return normalised;
  }

  // 4. Pattern matching within free text (with word boundaries / non-digit lookahead):
  // 10-digit mobile with optional country code and optional spaces/dashes
  const tenDigitPattern = /(?:(?:\+?91|0)[\s.-]?)?([5-9]\d{4}[\s.-]?\d{5}|[5-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|[5-9]\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|[5-9]\d{9})(?!\d)/;
  const match10 = text.match(tenDigitPattern);
  if (match10) {
    const normalised = normalisePhone(match10[0]);
    if (normalised) return normalised;
  }

  // 9-digit spoken mobile (voice STT swallowed one digit)
  const nineDigitPattern = /(?:(?:\+?91|0)[\s.-]?)?([5-9]\d{3}[\s.-]?\d{5}|[5-9]\d{8})(?!\d)/;
  const match9 = text.match(nineDigitPattern);
  if (match9) {
    const normalised = normalisePhone(match9[0]);
    if (normalised) return normalised;
  }

  // 5. Fallback for pure digit string in case punctuation was unusual
  const allDigits = text.replace(/\D/g, "");
  if (
    allDigits.length === 10 ||
    allDigits.length === 9 ||
    (allDigits.length >= 11 &&
      allDigits.length <= 13 &&
      (allDigits.startsWith("91") || allDigits.startsWith("0")))
  ) {
    const normalised = normalisePhone(allDigits);
    if (normalised) return normalised;
  }

  return undefined;
}

/** A phone number as it should be read back to a person: "98765 43210". */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return phone;
}

/** Only an id that exists in the inventory may be stored as a selected property. */
export function normalisePropertyId(value: unknown): string | undefined {
  const raw = normaliseText(value, 60);
  if (!raw) return undefined;
  return getActiveProperties().find((property) => property.id === raw)?.id;
}

/**
 * A comparison key for "did we already know this?" checks.
 *
 * Buttons and re-asks are suppressed by comparing what the assistant is about to
 * offer against what the lead already holds, so both sides must normalise the
 * same way — otherwise "2 BHK" and "2bhk" read as different facts and the same
 * question comes back.
 */
export function normaliseMatchKey(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

export { MAX_BUDGET };
