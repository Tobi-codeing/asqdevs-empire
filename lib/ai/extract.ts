import { formatBudget, formatBudgetRange } from "@/lib/data/properties";
import { getKnownLocations } from "@/lib/data/inventory";
import { normalisePhone } from "@/lib/leads/normalise";
import type { Intent, Lead } from "@/lib/leads/types";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
};

const EXTRA_LOCATIONS = [
  "South Delhi",
  "North Delhi",
  "Delhi",
  "Saket",
  "Rohini",
  "Dwarka",
  "Noida",
  "Gurugram",
];

const NAME_TRIGGERS = [
  // Hindi / Devanagari, because the voice call transcript is in the caller's
  // own script: "मेरा नाम राहुल है" must yield the name too.
  /मेरा नाम\s+([\u0900-\u097F]{2,})/,
  /मेरा नाम\s+([\u0900-\u097F]{2,})\s+है/,
  /नाम\s+([\u0900-\u097F]{2,})/,
  /मैं\s+([\u0900-\u097F]{2,})\s+(?:हूँ|हूं|बोल)/,
  /my name is\s+([a-z]+)/i,
  /name is\s+([a-z]+)/i,
  /this is\s+([a-z]+)/i,
  /i am\s+([a-z]+)/i,
  /i'm\s+([a-z]+)/i,
  /naam\s+([a-z]+)/i,
  /main\s+([a-z]+)\s+(?:hoon|hun|bol)/i,
];

const NAME_STOPWORDS = new Set([
  "looking",
  "interested",
  "not",
  "here",
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "from",
  "buying",
  "renting",
  "searching",
  "planning",
  "just",
  "also",
  "still",
  "only",
  "very",
  "so",
  "new",
]);

/*
 * The amenities people actually mention, in the language they actually use.
 * A phone call in Hindi is transcribed in Devanagari, so every Latin pattern
 * has its Devanagari counterpart — otherwise a caller who listed a gym, a
 * school and a market nearby reached the admin as "Preferences: None stated".
 */
const PREFERENCE_MAP: { test: RegExp; label: string }[] = [
  { test: /\bsemi[\s-]?furnished\b/i, label: "Semi-furnished" },
  { test: /\bunfurnished\b/i, label: "Unfurnished" },
  { test: /\bfurnished\b|फर्निश्ड/i, label: "Furnished" },
  { test: /\bparking\b|\bcar park\b|पार्किंग/i, label: "Parking" },
  { test: /park facing|facing park|पार्क\s*(?:की|की तरफ|के सामने)/i, label: "Park facing" },
  { test: /\bvastu\b|वास्तु/i, label: "Vastu" },
  { test: /\bmetro\b|मेट्रो/i, label: "Near metro" },
  { test: /\bschool\b|स्कूल|स्कुल/i, label: "Near school" },
  { test: /\bgym\b|जिम/i, label: "Gym" },
  { test: /\bmarket\b|मार्केट|बाज़ार|बाजार/i, label: "Market nearby" },
  { test: /\blift\b|elevator|लिफ्ट/i, label: "Lift" },
  { test: /ready to move|रहने के लिए तैयार/i, label: "Ready to move" },
  { test: /under construction|निर्माणाधीन/i, label: "Under construction" },
  { test: /\bcorner\b/i, label: "Corner unit" },
  { test: /higher floor|top floor|high floor/i, label: "Higher floor" },
  { test: /\bgarden\b|बगीचा|गार्डन/i, label: "Garden" },
  { test: /\bpool\b|swimming|स्विमिंग/i, label: "Swimming pool" },
];

function firstBudgetToken(
  text: string,
): { value: number; label: string } | undefined {
  const crore = text.match(
    /(\d+(?:\.\d+)?)\s*(?:crore|crores|cr\b|करोड़|करोड|करोड़ों)/i,
  );
  if (crore) {
    const value = Math.round(Number(crore[1]) * 10_000_000);
    return { value, label: formatBudget(value) };
  }

  const lakh = text.match(
    /(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lacs?|\bl\b|लाख|लाखों|लाखो)/i,
  );
  if (lakh) {
    const value = Math.round(Number(lakh[1]) * 100_000);
    return { value, label: formatBudget(value) };
  }

  // "95L" / "1.2Cr" without a space.
  const compact = text.match(/(\d+(?:\.\d+)?)\s*(?:l|c)\b/i);
  if (compact) {
    const unit = compact[0].toLowerCase().trim().slice(-1);
    const value = Math.round(
      Number(compact[1]) * (unit === "c" ? 10_000_000 : 100_000),
    );
    return { value, label: formatBudget(value) };
  }

  return undefined;
}

function boundBudget(text: string): { min: number; max: number } | undefined {
  // "85 to 90", "85-90", "85 and 90", "85 - 90 lakh", etc.
  const fromTo = text.match(
    /(\d+(?:\.\d+)?)\s*(?:-|to|and|tak|se|तक|से|\s+)\s*(\d+(?:\.\d+)?)/i,
  );
  if (!fromTo) return undefined;

  const lower = Math.round(Number(fromTo[1]));
  const upper = Math.round(Number(fromTo[2]));
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower)
    return undefined;

  // If one of them looks like a lakh/crore token, assume the same unit for both.
  const context = text.slice(
    Math.max(0, fromTo.index! - 40),
    fromTo.index! + fromTo[0].length + 40,
  );
  const unitLakh =
    /lakh|lakhs|lac|\bl\b|लाख|लाखों|लाखो|crore|crores|cr\b|करोड़|करोड|करोड़ों/i.test(
      context,
    );
  const unitCrore = /crore|crores|cr\b|करोड़|करोड|करोड़ों/i.test(context);
  /*
   * Two small bare numbers are usually not a budget — "2 3 BHK" is a
   * configuration, not a price. A pair is only read as money when a unit, a
   * "tak/तक" ceiling or another budget cue is present, or both are large enough
   * to plainly be an amount.
   */
  const hasBudgetCue =
    unitLakh ||
    /तक|tak|budget|around|roughly|approx|between|up\s*to|upto/i.test(context);
  if (!hasBudgetCue && (lower < 10 || upper < 10)) return undefined;

  const toValue = (n: number, preferCrore: boolean): number => {
    if (unitCrore) return Math.round(n * 10_000_000);
    if (unitLakh || preferCrore) return Math.round(n * 100_000);
    // Bare number with no unit is assumed to be in lakhs.
    return Math.round(n * 100_000);
  };

  const min = Math.min(toValue(lower, false), toValue(upper, true));
  const max = Math.max(toValue(lower, false), toValue(upper, true));
  return { min, max };
}

function parseBhk(text: string): string | undefined {
  const numeric = text.match(
    /(\d+)\s*(?:\+\s*)?(?:bhk|bedroom|bed rooms?|br\b)/i,
  );
  if (numeric) return `${numeric[1]} BHK`;

  const worded = text.match(
    /\b(one|two|three|four|ek|do|teen|char|chaar)\s*(?:bhk|bedroom)/i,
  );
  if (worded) return `${NUMBER_WORDS[worded[1].toLowerCase()]} BHK`;

  if (/\bstudio\b/i.test(text)) return "1 BHK";
  return undefined;
}

function parseIntent(text: string): Intent | undefined {
  const lower = text.toLowerCase();

  /*
   * The voice call is transcribed in the caller's own script, so a Hindi
   * caller's whole requirement arrives in Devanagari. Without these the intent
   * field was left empty — which is exactly what stops matching and what made a
   * phone lead reach the admin as "Intent: Not shared yet". Rent and Sell are
   * checked before Buy so "किराये पर लेना" reads as a rental, not a purchase.
   */
  if (/किराये|किराया|रेंट|किराए/.test(text)) return "Rent";
  if (/बेच|बिक्री|विक्रय/.test(text)) return "Sell";
  if (/खरीद|क्रय|लेना है|लेने का|ले रहा|चाहता हूँ|चाहती हूँ/.test(text)) return "Buy";

  /*
   * Every keyword here is word-bounded. Without the boundaries, `lease` matched
   * the "lease" inside "please" — so a polite "please" anywhere in a message
   * silently flipped a buyer's intent to Rent.
   */
  if (/\brent\b|\brenting\b|\blease\b|\bleasing\b|kiraya|kiraye|on rent/i.test(lower))
    return "Rent";
  if (/\bsell\b|\bsale\b|bechna|sell karna|sell karna|sell karne/i.test(lower))
    return "Sell";

  /*
   * Hinglish demand, e.g. "2 BHK chahiye Rohini mein, budget 90L". The plain
   * Buy patterns need an explicit English verb, so this most natural way of
   * stating a requirement in Delhi was leaving the intent empty — and an empty
   * intent is exactly what stops the search, so a complete requirement sat
   * unmatched while the assistant asked a question the customer had answered.
   *
   * It only fires alongside a property noun, so a bare "kuch chahiye" stays
   * unqualified, and Rent/Sell are matched above and therefore win when the
   * customer actually said "rent" or "sell".
   */
  const hinglishWants =
    /\b(?:chahiye|chaahiye|chahie|chaiye|lena\s+hai|leni\s+hai|dhoond\s+raha|dhoondh\s+raha|dekh\s+raha)\b/i.test(
      lower,
    ) &&
    /\b(?:flat|apartment|property|home|house|ghar|makaan|bhk|villa|studio|penthouse|place|jagah)\b/i.test(
      lower,
    );
  if (hinglishWants) return "Buy";

  if (
    /\b(?:buy|purchase|kharid|kharidna|lena|leni|want to buy|want a home|need a home|looking to buy|looking for a home|interested in buying|need to buy|want a flat|need a flat|looking for flat|looking for property|want.*property)\b|\b(?:want|need|looking for|interested in)\b.*(?:flat|property|home|apartment|villa|2\s*bhk|3\s*bhk)/i.test(
      text,
    )
  )
    return "Buy";

  if (/\bbuy\b|\bpurchase\b|kharid|kharidna|lena|leni/i.test(lower))
    return "Buy";

  return undefined;
}

export function parseTimeline(text: string): string | undefined {
  /*
   * En/em dashes are what the quick-reply buttons and phone keyboards actually
   * send. Fold them before matching, otherwise "1–3 months" never hits the
   * 1–3 pattern and falls through to the bare `3 months` in the 3–6 pattern.
   */
  const source = text.replace(/[–—]/g, "-");
  const t = source.toLowerCase();

  /*
   * "I don't know the area" is an answer about the *location*, not a timeline.
   * Reading every "don't know" / "not sure" as "Just exploring" made the
   * assistant replay its exploratory message instead of moving on to the next
   * genuinely missing fact.
   */
  const unsureAboutArea =
    /(?:don'?t|do not|dont)\s+know\s+(?:the\s+|which\s+|any\s+)?(?:area|location|locality|place|where|kahan)|(?:not|no)\s+sure\s+(?:about|of)?\s*(?:the\s+)?(?:area|location|locality)|(?:pata|maloom)\s+nahi\s+(?:kahan|area|location|jagah)/i.test(
      t,
    );

  if (
    !unsureAboutArea &&
    /just exploring|just browsing|only exploring|only browsing|not decided|not sure|abhi nahi|thinking|abhi socha nahi|does not matter|wherever you think|don't know|still deciding|pata nahi|maloom nahi|sirf dekh/i.test(
      t,
    )
  )
    return "Just exploring";

  if (
    /as soon as possible|immediate|immediately|asap|turant|jaldi|urgent|abhi|right now|this week|is hafte|ready to move|\bkal\b|\btomorrow\b|\baaj\b|\btoday\b|कल|आज|तुरंत|जल्दी/i.test(
      t,
    )
  )
    return "Immediately";

  if (
    /(\b1\s*year|one year|next year|agle saal|agla saal|ek saal|ek saal me|in a year|within a year|within 1 year|after 1 year|probably in a year|around a year|probably next year|in the next year)/i.test(
      source,
    )
  )
    return "12 months";

  if (
    /*
     * `(?<![-\d])` stops the bare `6 months` alternative matching inside a
     * range like "3-6 months" — without it, a customer who said "3–6 months"
     * was filed as "6–12 months".
     */
    /((?<![-\d])6\s*months|6 mahine|after 6 months|in 6 months|around 6 months|maybe 6 months|about 6 months|6\s*\+|more than 6|over 6|6\s*(?:-|to)\s*12)/i.test(
      source,
    )
  )
    return "6–12 months";

  /*
   * The 1–3 bucket is checked BEFORE 3–6 on purpose. The 3–6 pattern contains a
   * bare `3 months` alternative, which matched inside "1-3 months" and filed a
   * customer who said "1–3 months" as "3–6 months". The range is the more
   * specific reading, so it has to win.
   */
  if (
    /1\s*(?:-|to)\s*3|1\s*-\s*2|2\s*(?:-|to)\s*3|ek\s*-?\s*do|agle mahine|next month|in a month|1 month/i.test(
      source,
    )
  )
    return "1–3 months";

  if (
    /3\s*(?:-|to)\s*6|teen se chhe|within\s+\d+\s*(?:month|mahine)|next\s+\d+\s*(?:month|mahine)|3\s*months|3 mahine/i.test(
      source,
    )
  )
    return "3–6 months";

  if (/\b(\d+)\s*months?\b/i.test(source)) {
    const match = source.match(/\b(\d+)\s*months?\b/i);
    if (!match) return undefined;
    const months = Number(match[1]);
    if (months <= 3) return "1–3 months";
    if (months <= 6) return "3–6 months";
    if (months <= 12) return "6–12 months";
    return "12 months";
  }

  if (/after\s+(?:a |\d+)\s*year/i.test(source)) {
    const m = source.match(/after\s+(?:a |)(\d+)\s*year/i);
    const years = m ? Number(m[1]) : 1;
    return years <= 1 ? "12 months" : "12 months";
  }

  return undefined;
}

function parsePropertyType(text: string): string | undefined {
  if (/\bvilla\b|विला/i.test(text)) return "Villa";
  if (/\bpenthouse\b|पेंटहाउस/i.test(text)) return "Penthouse";
  if (/\bstudio\b|स्टूडियो/i.test(text)) return "Studio";
  if (/builder floor|बिल्डर फ्लोर/i.test(text)) return "Builder Floor";
  if (/\bflat\b|\bapartment\b|फ्लैट|फ़्लैट|अपार्टमेंट/i.test(text))
    return "Apartment";
  return undefined;
}

function parseLocation(text: string): string | undefined {
  const normalised = text
    .replace(/gurgaon/gi, "Gurugram")
    .replace(/gurugram/gi, "Gurugram")
    .replace(/delhi\s+or\s+nearby|nearby\s+delhi|delhi\s+nearby/gi, "Delhi");

  const candidates = [...getKnownLocations(), ...EXTRA_LOCATIONS];
  const match = candidates.find((location) =>
    normalised.toLowerCase().includes(location.toLowerCase()),
  );
  if (match) return match;

  if (
    /(?:socha\s+nahi|koi\s+(?:idea|area|jagah)\s+nahi|pata\s+nahi|kuch\s+(?:rakha|fix)\s+nahi|any\s+area|anywhere|flexible|no\s+preference|no\s+specific\s+area|doesn'?t\s+matter|koi\s+bhi|kahi\s+bhi|इलाके\s*(?:का|में|में\s*कोई)\s*(?:कोई\s*)?(?:सोचा|आईडिया|आइडिया|पता)\s*नहीं|कुछ\s*(?:रखा|सोचा|तय)\s*तो\s*नहीं|कोई\s*(?:भी\s*)?(?:सोचा|आईडिया|आइडिया|तय)\s*नहीं|कोई\s+भी\s+चलेगा|कहीं\s+भी)/i.test(
      text,
    )
  ) {
    return "Delhi (Flexible)";
  }

  return undefined;
}

/**
 * A contact number the customer stated.
 *
 * Deliberately strict: it looks for a run of digits a person would actually
 * read out as a phone number (optionally with +91, spaces or dashes) and the
 * caller's own words. A bare four-digit number from a garbled transcript must
 * never become the number the sales team dials.
 */
function parsePhone(text: string): string | undefined {
  if (!text) return undefined;
  const cleanDigits = text.replace(/\D/g, "");
  if (cleanDigits.length >= 8 && cleanDigits.length <= 13) {
    const normalised = normalisePhone(cleanDigits);
    if (normalised) return normalised;
  }
  const match = text.match(/(?:\+?91[\s-]?)?(?:0)?[5-9](?:[\s-]?\d){7,10}/);
  if (!match) return undefined;
  return normalisePhone(match[0]);
}

function parseName(text: string): string | undefined {
  for (const trigger of NAME_TRIGGERS) {
    const match = text.match(trigger);
    if (!match) continue;
    const candidate = match[1];
    if (!candidate || NAME_STOPWORDS.has(candidate.toLowerCase())) continue;
    return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
  }

  // Name correction or trailing name: e.g. "pass on nahi hai pass on nahi Aansu", "nahi Aansu"
  const correction =
    text.match(/(?:nahi|not|galat|nahi\s+hai)\s+([A-Za-z\u0900-\u097F]{2,})\s*$/i) ||
    text.match(/naam\s+([A-Za-z\u0900-\u097F]{2,})\s+hai/i) ||
    text.match(/([A-Za-z\u0900-\u097F]{2,})\s+naam\s+hai/i);
  if (correction) {
    const candidate = correction[1];
    if (candidate && !NAME_STOPWORDS.has(candidate.toLowerCase())) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
    }
  }

  return undefined;
}

function moneyFor(value: number, unit: string): number {
  const norm = unit.toLowerCase();
  if (norm.includes("crore") || norm.includes("cr")) {
    return Math.round(value * 10_000_000);
  }
  if (norm.includes("lakh") || norm.includes("lac") || norm.includes("l")) {
    return Math.round(value * 100_000);
  }
  return Math.round(value * 100_000);
}

function parseBudgetSignals(
  text: string,
): Partial<Pick<Lead, "budget" | "budgetMin" | "budgetMax" | "budgetLabel">> {
  const result: Partial<
    Pick<Lead, "budget" | "budgetMin" | "budgetMax" | "budgetLabel">
  > = {};

  const maxMatch = text.match(
    /(?:not\s+more\s+than|max(?:imum)?|under|below|up\s+to|upto|not\s+beyond|ceiling)\s*(?:rs\.?|â‚¹)?\s*(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|l\b|crore|crores|cr\b)/i,
  );
  if (maxMatch) {
    const value = moneyFor(Number(maxMatch[1]), maxMatch[0]);
    result.budgetMax = value;
    result.budget = value;
    result.budgetLabel = formatBudget(value);
  }

  // Hindi ceiling where the unit comes first: "50 लाख तक" / "55 lakh tak".
  const uptoMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|\bl\b|लाख|लाखों|लाखो|crore|crores|cr\b|करोड़|करोड)\s*(?:तक|tak)/i,
  );
  if (!maxMatch && uptoMatch) {
    const value = moneyFor(Number(uptoMatch[1]), uptoMatch[0]);
    result.budgetMax = value;
    result.budget = value;
    result.budgetLabel = formatBudget(value);
  }

  const minMatch = text.match(
    /(?:minimum|at\s+least|starting\s+at|no\s+less\s+than)\s*(?:rs\.?|â‚¹)?\s*(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|l\b|crore|crores|cr\b)/i,
  );
  if (minMatch) {
    const value = moneyFor(Number(minMatch[1]), minMatch[0]);
    result.budgetMin = value;
  }

  return result;
}

export type Extraction = Partial<
  Pick<
    Lead,
    | "name"
    | "phone"
    | "intent"
    | "location"
    | "preferredLocations"
    | "propertyType"
    | "budgetFlexible"
    | "selectedPropertyId"
    | "timeline"
  > & {
    bhk: string;
    budget?: number;
    budgetMin?: number;
    budgetMax?: number;
    budgetLabel?: string;
    preferences: string[];
  }
>;

/** Pull whatever the person already told us out of free text (English or Hinglish). */
export function extractLeadFields(raw: string): Extraction {
  // Normalise dashes and spacing so "1–3 months" / "₹75L–₹1Cr" parse reliably.
  const text = raw
    .replace(/[–—ˆ’]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const result: Extraction = {};

  const name = parseName(text);
  if (name) result.name = name;

  const phone = parsePhone(text);
  if (phone) result.phone = phone;

  const intent = parseIntent(text);
  if (intent) result.intent = intent;

  const location = parseLocation(text);
  if (location) result.location = location;

  // Scan a normalised copy so "Gurgaon" is still recognised as "Gurugram"
  // here — otherwise a message naming two areas ("Dwarka or Gurgaon") only
  // registers the first, and the second is silently dropped.
  const locationScan = text.replace(/gurgaon/gi, "Gurugram");
  const statedLocations = Array.from(
    new Set([...getKnownLocations(), ...EXTRA_LOCATIONS]),
  ).filter((locationName) =>
    locationScan.match(
      new RegExp(
        `\\b${locationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ),
    ),
  );
  if (statedLocations.length > 1) {
    result.preferredLocations = statedLocations;
  }

  if (
    /budget\s+(?:is\s+)?flexible|flexible\s+(?:on\s+)?budget|no\s+fixed\s+budget|not\s+strict\s+about\s+budget|budget\s+not\s+fixed|any\s+budget/i.test(
      text,
    )
  ) {
    result.budgetFlexible = true;
  }

  const bhk = parseBhk(text);
  if (bhk) result.bhk = bhk;

  const budgetSignals = parseBudgetSignals(text);
  if (budgetSignals.budgetMin != null)
    result.budgetMin = budgetSignals.budgetMin;
  if (budgetSignals.budgetMax != null)
    result.budgetMax = budgetSignals.budgetMax;
  if (budgetSignals.budget != null) result.budget = budgetSignals.budget;
  if (budgetSignals.budgetLabel) result.budgetLabel = budgetSignals.budgetLabel;

  if (
    text.toLowerCase().includes("between") ||
    /\b(?:to|and|tak|se)\b/i.test(text) ||
    /तक|से/.test(text) ||
    /\d\s+\d/.test(text)
  ) {
    const range = boundBudget(text);
    if (range) {
      result.budgetMin = range.min;
      result.budgetMax = range.max;
      result.budgetLabel = formatBudgetRange(range.min, range.max);
      result.budget = range.max;
      return result;
    }
  }

  const budget = firstBudgetToken(text);
  if (budget) {
    result.budget = budget.value;
    result.budgetLabel = budget.label;
    if (result.budgetMin == null && result.budgetMax == null) {
      result.budgetMin = budget.value;
      result.budgetMax = budget.value;
    }
  }

  const timeline = parseTimeline(text);
  if (timeline) result.timeline = timeline;

  const propertyType = parsePropertyType(text);
  if (propertyType) result.propertyType = propertyType;

  const preferences = PREFERENCE_MAP.filter((pref) => pref.test.test(text)).map(
    (p) => p.label,
  );
  if (preferences.length) result.preferences = preferences;

  return result;
}

export type DetectedAction =
  | "siteVisit"
  | "callback"
  | "advisor"
  | "notNow"
  | "propertyDetails"
  | "moreOptions"
  /** Widen the search, because nothing matched the stated requirement. */
  | "broaden"
  /** The customer wants to change their budget rather than keep the old one. */
  | "adjustBudget"
  /** The customer asked not to be contacted again. */
  | "optOut"
  | "restart";

/**
 * The stop words that mean "do not contact me again".
 *
 * Anchored on the whole short message so the standard "STOP" keyword works
 * while an ordinary sentence that happens to contain the word — "can I stop by
 * on Saturday?" — is not mistaken for an opt-out.
 */
const OPT_OUT_PATTERN =
  /^(?:stop|unsubscribe|opt[\s-]?out|remove me|mat bhejo|message na karo|band karo)[.!]?$|^(?:stop|unsubscribe)\s+(?:messaging|messages|sending|contacting|contact|all)\b|\b(?:do not|don'?t)\s+(?:message|contact|call)\b/i;

/** Detect an explicit request so the assistant can act rather than keep asking. */
export function detectAction(raw: string): DetectedAction | undefined {
  const text = raw.toLowerCase();
  if (OPT_OUT_PATTERN.test(text.trim())) return "optOut";
  if (/\brestart\b|start over|reset/i.test(text)) return "restart";
  if (
    /advisor|human|agent|insaan|kisi se baat|talk to (?:someone|a person)/i.test(
      text,
    )
  )
    return "advisor";
  if (/callback|call me back|call back|phone kar|ring me/i.test(text))
    return "callback";
  if (
    /*
     * A real visit request, not merely "show me listings".
     *
     * The Hinglish verb that matters is "dekhna" (to see, in person) — "dikhao"
     * means "show me", which is the single most common way a customer asks for
     * options. Matching the bare stem `dikha` made "haan dikhao kya options
     * hain" register as a booked viewing, which then skipped the whole rest of
     * the conversation and printed a site-visit recap the customer never asked
     * for. The visit verb is therefore required in a viewing context.
     */
    /site visit|schedule.{0,20}visit|book.{0,20}visit|visit.{0,20}(?:schedule|book)|\bmilna\b|\bmilne\b|\bmil\s+sakte\b|dekhne\s+(?:aana|aa|aay|aaun)|(?:flat|property|home|apartment|ghar|jagah|place)\s+dekh(?:ne|na)|aake\s+dekh|aakar\s+dekh|jaake\s+dekh|visit\s+karna/i.test(
      text,
    ) ||
    /\b(?:can|could|may) i (?:come|visit|see)\b/i.test(text)
  )
    return "siteVisit";
  // "Broaden the search" and "adjust my budget" are the two honest ways out of a
  // no-match, so they are recognised explicitly and acted on, not just offered.
  if (
    /broaden|widen|expand|other areas?|any area|try (?:a )?(?:bigger|wider) (?:search|area)|change (?:the )?area/i.test(
      text,
    )
  )
    return "broaden";
  if (
    /adjust (?:the )?budget|change (?:the )?budget|budget (?:is )?(?:too )?(?:low|high)|increase (?:the )?budget/i.test(
      text,
    )
  )
    return "adjustBudget";
  // "Tell me more about Dwarka Heights" is a request for that listing, so it is
  // checked before the generic "more options" phrase.
  if (
    /tell me more|more about|know more|details of|about (?:the )?[a-z]/i.test(
      text,
    )
  )
    return "propertyDetails";
  if (
    /property details|more details|show.*details|details.*propert|info.*propert/i.test(
      text,
    )
  )
    return "propertyDetails";
  if (
    /more options|other options|show more|any more|more properties|alternatives?/i.test(
      text,
    )
  )
    return "moreOptions";
  /*
   * "Change my requirements" used to be treated as a full restart, which wiped
   * everything the customer had already told us. Editing one field is not the
   * same as starting over — the WhatsApp engine handles it as an edit, so no
   * action is raised here (and the chat client no longer restarts on it).
   */
  if (/\bnot now\b|later|no thanks|baad mein/i.test(text)) return "notNow";
  return undefined;
}


export function isQuestion(raw: string): boolean {
  return /\?|kya|kitna|how much|how many|where|kahan|when|kab/i.test(raw);
}

/**
 * Did the customer ask to see properties — "show me options", "send me the
 * listings", "what do you have"?
 *
 * This is the one definition both WhatsApp paths use, so a typed request and a
 * tapped button resolve identically. The nouns are deliberately matched in
 * both singular and plural: "show me option**s**" and "show me propert**ies**"
 * are how customers actually phrase it, and an earlier pattern that only knew
 * the singular silently fell through to re-asking a qualification question.
 */
export function asksForPropertyList(text: string): boolean {
  return /\b(?:show|send|share|view|see|give|push|link|forward|browse)\b[^.?]{0,40}\b(?:properties|property|options?|listings?|matches?|results?|places?|homes?|flats?|apartments?)\b|\b(?:more|other|any more|additional)\s+(?:options?|properties|listings?|choices?|matches?)|details of\b|\bwhat have you got\b|\bwhat do you have\b/i.test(
    text,
  );
}
