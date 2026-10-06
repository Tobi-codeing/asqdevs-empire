import { detectAction, extractLeadFields } from "@/lib/ai/extract";
import { budgetSummaryText, formatLocation, formatTimeline } from "@/lib/leads/format";
import { extractPhone, formatPhone, normalisePhone } from "@/lib/leads/normalise";
import type { ConfirmationStage, Lead } from "@/lib/leads/types";

export { extractPhone };

/**
 * The end-of-conversation confirmation, shared by WhatsApp and the phone line.
 *
 * Both channels collect the same lead, and both have the same failure mode
 * without this step: a name the customer never gave, a number nobody read back,
 * and an admin record that turns out to disagree with what the customer thought
 * they had agreed. So the flow is application-owned and lives in one place — the
 * customer is shown a read-back of everything captured, asked whether it is
 * correct, asked for a name and a contact number, and asked to confirm that
 * number. A correction is just a normal turn: it merges through the one lead
 * path, so whatever the admin sees is what the customer last agreed to.
 */

export type ConfirmationStageLite = ConfirmationStage;

/** Offered alongside the read-back. Two clear ways forward, nothing else. */
export const REVIEW_REPLIES = ["Yes, that's correct", "Change something"];

/** Offered alongside the number read-back. */
export const PHONE_REPLIES = ["Call on this number", "Change number"];

/**
 * True when the customer is agreeing that the read-back is right.
 *
 * Kept to short, unambiguous affirmatives: a reply like "yes, but change the
 * budget" also contains a correction, so the caller checks for a change cue
 * first and only treats a clean "yes" as consent.
 */
export function isAffirmative(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 50) return false;
  if (/(?:sab|woh?|sab\s*kuch)\s*(?:sahi|theek|thik|correct)|सब\s*(?:कुछ\s*)?(?:सही|ठीक)|(?:वह|वो)\s*(?:सही|ठीक)|all\s*correct/i.test(value)) {
    return true;
  }
  return /^(?:(?:nahi\s*nahi[,\s]*)?(?:yes|yeah|yep|yup|y|correct|right|righto|that'?s right|that is right|all correct|looks good|confirm(?:ed)?|ok(?:ay)?|sure|perfect|sahi(?: hai)?|theek(?: hai)?|thik(?: hai)?|haan(?: ji)?|han|ha|aa?|ji haan|ji|sab (?:sahi|theek)(?: hai)?|बिल्कुल|हाँ(?: जी)?|हां(?: जी)?|हॉं|जी(?: हाँ| हां)?|सही(?: है)?|ठीक(?: है)?|सब (?:सही|ठीक)(?: है)?))(?=$|[\s,.!?|।])/i.test(
    value,
  );
}

/**
 * True when the reply is a correction, a refusal, or a request to change
 * something. Checked before {@link isAffirmative} so "yes change the budget"
 * edits rather than confirms.
 */
export function isCorrection(text: string): boolean {
  if (/(?:sab|woh?|sab\s*kuch)\s*(?:sahi|theek|thik|correct)|सब\s*(?:कुछ\s*)?(?:सही|ठीक)|(?:वह|वो)\s*(?:सही|ठीक)|all\s*correct/i.test(text)) {
    return false;
  }
  return /\b(?:change|different|instead|correction|update|not right|wrong|incorrect|no|nope|nahi|nahin|badal|galat|badlo)\b|नहीं|गलत|बदल|बदलो|सही नहीं/i.test(
    text,
  );
}

/**
 * The customer's name from an answer to "what name should I save?".
 *
 * The structured extractor runs first, so "my name is Rahul" and "मेरा नाम
 * राहुल है" both resolve exactly as they do everywhere else. When the reply is
 * just the name — which is how people actually answer that question — a short,
 * name-shaped message is accepted as-is.
 */
export function readName(text: string): string | undefined {
  const parsed = extractLeadFields(text).name;
  if (parsed) return parsed;
  const value = text.replace(/[.!।'"]+$/g, "").replace(/^['"]+/g, "").trim();
  if (!value || value.length > 40 || value.length < 2) return undefined;
  const words = value.split(/\s+/);
  if (words.length > 3) return undefined;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'-]*$/u.test(value)) return undefined;
  // An acknowledgement is not a name: "ok thanks" and "yes" must not be saved
  // as the customer's name just because they answer the question with one.
  if (words.every((word) => ACKNOWLEDGEMENTS.has(word.toLowerCase())))
    return undefined;
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Words that answer a question without ever being a name. */
const ACKNOWLEDGEMENTS = new Set([
  "ok",
  "okay",
  "yes",
  "yeah",
  "sure",
  "thanks",
  "thank",
  "you",
  "thx",
  "haan",
  "han",
  "ji",
  "nahi",
  "nahin",
  "no",
  "theek",
  "thik",
  "sahi",
  "ठीक",
  "सही",
  "हां",
  "हाँ",
  "जी",
  "धन्यवाद",
  "शुक्रिया",
  "नहीं",
  // Short function words and filler that a phone transcript constantly
  // produces — "is", "un", "A" must never be saved as the caller's name.
  "is",
  "am",
  "are",
  "was",
  "a",
  "an",
  "the",
  "and",
  "or",
  "um",
  "uh",
  "hm",
  "hmm",
  "eh",
  "ah",
  "oh",
  "un",
  "yeah",
  "así",
  "es",
  "right",
  "correct",
  "bilkul",
  "accha",
  "achha",
  "badhiya",
  "batao",
  "bataiye",
  "bolo",
  "karo",
  "karein",
  "hello",
  "namaste",
  "sir",
  "madam",
  "बिल्कुल",
  "अच्छा",
  "नमस्ते",
]);

const INTENT_LABEL: Record<string, string> = {
  Buy: "Buying",
  Rent: "Renting",
  Sell: "Looking to sell",
  Enquiry: "Enquiring",
};

/** The structured read-back lines, one fact per line, never invented. */
export function reviewLines(lead: Lead): string[] {
  const lines: string[] = [];
  if (lead.intent) lines.push(`Looking to: ${INTENT_LABEL[lead.intent] ?? lead.intent}`);
  const areas = lead.preferredLocations.length
    ? lead.preferredLocations
    : lead.location
      ? [lead.location]
      : [];
  if (areas.length) lines.push(`Area: ${areas.map(formatLocation).join(" or ")}`);
  const spec = [lead.bhk, lead.propertyType].filter(Boolean).join(" ");
  if (spec) lines.push(`Size: ${spec}`);
  const budget = budgetSummaryText(lead);
  if (budget) lines.push(`Budget: ${budget}`);
  if (lead.timeline) lines.push(`Timeline: ${formatTimeline(lead.timeline)}`);
  if (lead.preferences.length)
    lines.push(`Preferences: ${lead.preferences.join(", ")}`);
  if (lead.siteVisit) lines.push(`Site visit: ${lead.siteVisit}`);
  if (lead.name) lines.push(`Name: ${lead.name}`);
  if (lead.phone) lines.push(`Number: ${formatPhone(lead.phone)}`);
  return lines;
}

/**
 * The full read-back message. Everything the record holds, so the customer can
 * catch a wrong locality or budget before it reaches the sales team.
 */
export function buildReviewMessage(lead: Lead): string {
  const lines = reviewLines(lead);
  if (!lines.length) {
    return "Before I pass this on, can you confirm what you're looking for?";
  }
  return [
    "Before I pass this to our advisor, just confirm I have it right:",
    ...lines,
    'Reply "Yes, that\'s correct", or tell me what to change.',
  ].join("\n");
}

/**
 * The next question the confirmation flow should ask, given what the record
 * still lacks. Name first, then the number, then the read-back of the number
 * itself — a number nobody repeats back is a number that gets dialled wrong.
 */
export function nextConfirmationAsk(lead: Lead): {
  stage: ConfirmationStage;
  text: string;
  quickReplies: string[];
} {
  if (!lead.name) {
    return {
      stage: "name",
      text: "Thanks! And what name should I save with your requirement?",
      quickReplies: [],
    };
  }
  if (!lead.phone) {
    return {
      stage: "phone",
      text: "Great. What's the best number for our advisor to reach you on?",
      quickReplies: [],
    };
  }
  return {
    stage: "phoneConfirm",
    text: `I'll have our advisor call you on ${formatPhone(lead.phone)}. Is this the right number to reach you on, or would you like to change it?`,
    quickReplies: PHONE_REPLIES,
  };
}

export type ConfirmationStep =
  | { kind: "reply"; lead: Lead; text: string; quickReplies: string[] }
  /** Confirmation complete: the caller may finalise and deliver the lead. */
  | { kind: "final"; lead: Lead }
  /** Not a confirmation answer — clear the stage and let the normal turn run. */
  | { kind: "change"; lead: Lead }
  | { kind: "none" };

/**
 * Advance the confirmation flow by one customer message.
 *
 * Pure: it returns the next lead and the message to send, and never touches the
 * conversation itself. A "change" outcome deliberately clears the stage and
 * hands control back to the ordinary turn, so the customer's correction is
 * merged through the same `applyExtraction` every other turn uses — the read-back
 * then re-fires on the next completion, which is how a correction propagates
 * everywhere including the admin record.
 */
export function advanceConfirmation(
  lead: Lead,
  text: string,
): ConfirmationStep {
  const stage = lead.confirmation;
  if (!stage) return { kind: "none" };

  if (stage === "review") {
    if (isAffirmative(text) && !isCorrection(text)) {
      const ask = nextConfirmationAsk(lead);
      return {
        kind: "reply",
        lead: { ...lead, confirmation: ask.stage },
        text: ask.text,
        quickReplies: ask.quickReplies,
      };
    }
    /*
     * If the reply carries a new fact ("my budget is 80 lakh"), clearing the
     * stage and letting the ordinary turn merge it is the whole point — the
     * read-back then re-fires with the corrected value. A reply with nothing in
     * it but a request to change ("Change something") has nothing to merge, so
     * re-showing the same read-back would just be a loop; ask which detail to
     * change instead. A recognised action (more options, a visit, an advisor)
     * is left to the ordinary turn as well.
     */
    const patch = extractLeadFields(text);
    if (Object.keys(patch).length === 0 && !detectAction(text)) {
      return {
        kind: "reply",
        lead,
        text: "Of course — tell me what to change (area, size, budget or timeline) and I'll update it.",
        quickReplies: [],
      };
    }
    return { kind: "change", lead: { ...lead, confirmation: undefined } };
  }

  if (stage === "name") {
    const phone = extractPhone(text);
    const textWithoutPhone = phone
      ? text
          .replace(phone, "")
          .replace(/(?:\+?91|0)/g, "")
          .replace(/\b(?:phone|number|mobile|contact|naam|name|hai|is|mera|my|pe|par)\b/gi, "")
          .trim()
      : text;
    const name = readName(textWithoutPhone) || readName(text);
    if (!name && !phone) {
      return {
        kind: "reply",
        lead,
        text: "Sorry, I didn't catch a name there — what should I save it as?",
        quickReplies: [],
      };
    }
    const withName = {
      ...lead,
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
    };
    const ask = nextConfirmationAsk(withName);
    return {
      kind: "reply",
      lead: { ...withName, confirmation: ask.stage },
      text: ask.text,
      quickReplies: ask.quickReplies,
    };
  }

  if (stage === "phone") {
    const phone = extractPhone(text);
    const textWithoutPhone = phone
      ? text
          .replace(phone, "")
          .replace(/(?:\+?91|0)/g, "")
          .replace(/\b(?:phone|number|mobile|contact|naam|name|hai|is|mera|my|pe|par)\b/gi, "")
          .trim()
      : text;
    const name = !lead.name ? readName(textWithoutPhone) : undefined;
    if (!phone) {
      return {
        kind: "reply",
        lead,
        text: "Sorry, that didn't look like a number — could you send a 10-digit mobile number?",
        quickReplies: [],
      };
    }
    const withPhone = {
      ...lead,
      phone,
      ...(name ? { name } : {}),
    };
    const ask = nextConfirmationAsk(withPhone);
    return {
      kind: "reply",
      lead: { ...withPhone, confirmation: ask.stage },
      text: ask.text,
      quickReplies: ask.quickReplies,
    };
  }

  if (stage === "phoneConfirm") {
    const changed = extractPhone(text);
    if (changed && changed !== lead.phone && isCorrection(text)) {
      const withPhone = { ...lead, phone: changed };
      const ask = nextConfirmationAsk(withPhone);
      return {
        kind: "reply",
        lead: { ...withPhone, confirmation: ask.stage },
        text: ask.text,
        quickReplies: ask.quickReplies,
      };
    }
    if (isAffirmative(text) && !isCorrection(text)) {
      return { kind: "final", lead: { ...lead, confirmation: "done" } };
    }
    if (
      /(?:change|wrong|different)\s*number|नंबर\s*(?:बदलो|बदलना|गलत)/i.test(text)
    ) {
      return {
        kind: "reply",
        lead: { ...lead, phone: undefined, confirmation: "phone" },
        text: "No problem — what's the correct number?",
        quickReplies: [],
      };
    }
    if (isCorrection(text)) {
      // General correction (budget, locality, etc.) — preserve the phone!
      return { kind: "change", lead: { ...lead, confirmation: undefined } };
    }
    return { kind: "final", lead: { ...lead, confirmation: "done" } };
  }

  return { kind: "none" };
}
