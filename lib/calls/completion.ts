import { CORE_FIELDS, missingFields, type Lead } from "@/lib/leads/types";
import {
  extractPhone,
  isAffirmative,
  isCorrection,
  readName,
  reviewLines,
} from "@/lib/leads/confirmation";
import { patchFromUtterance, reconcilePatch } from "@/lib/calls/transcript";

/**
 * Decides when a call has served its purpose and can end itself.
 *
 * There is deliberately no turn budget. A call may be short or long — what
 * matters is whether the requirement is understood and a next step is agreed
 * AND that step actually completed. The receptionist is told to say goodbye,
 * and the call closes after that goodbye rather than after a fixed number of
 * exchanges.
 */

export type CallCompletion = {
  complete: boolean;
  /** Why the call is considered finished, for the transcript note. */
  reason: string;
};

/**
 * Core fields that must be present before a call may end itself.
 *
 * The timeline is deliberately excluded. It is a nice-to-have the sales team can
 * ask later, and requiring it was what kept a call open after the visit had
 * already been booked — the caller had agreed a slot and was still being held on
 * the line over a question the booking did not depend on.
 */
export const REQUIRED_FIELDS = CORE_FIELDS.filter((field) => field !== "timeline");

export function isFullyQualified(lead: Lead): boolean {
  const missing = missingFields(lead);
  return missing.every((field) => field === "timeline");
}

/** True when the caller has agreed to a concrete next step. */
export function hasNextStep(lead: Lead): boolean {
  return Boolean(
    lead.siteVisit || lead.callbackRequested || lead.advisorRequested,
  );
}

/**
 * True when a promised next step is still outstanding.
 *
 * A visit the caller asked for but which the backend did not confirm must not
 * count as a completed action — the call has to stay open so the receptionist
 * can offer the alternatives or sort it out.
 */
export function hasUnresolvedAction(lead: Lead): boolean {
  const visitPending = Boolean(
    lead.siteVisit && /requested|to confirm|pending/i.test(lead.siteVisit),
  );
  return visitPending && !lead.callbackRequested && !lead.advisorRequested;
}

export function evaluateCompletion(lead: Lead): CallCompletion {
  if (!isFullyQualified(lead)) {
    return { complete: false, reason: "still_qualifying" };
  }

  if (!hasNextStep(lead)) {
    return { complete: false, reason: "awaiting_next_step" };
  }

  // Never close on an action that did not actually complete.
  if (hasUnresolvedAction(lead)) {
    return { complete: false, reason: "action_unresolved" };
  }

  return { complete: true, reason: "qualified_with_next_step" };
}

/**
 * Detects a natural sign-off so the call ends when the conversation is genuinely
 * over, rather than when a counter expires.
 *
 * Only the receptionist's own closing line is inspected — if a caller says
 * "bye" mid-conversation, that must not cut the call short.
 */
const GOODBYE_PATTERNS = [
  /\bgoodbye\b/i,
  /\bgood bye\b/i,
  /\bbye\b/i,
  /\bthank you for calling\b/i,
  /\bthanks for calling\b/i,
  /\bthank you for contacting\b/i,
  /\bhave a (?:great|good|nice) (?:day|evening)\b/i,
  /\bwe(?:'| ha)?ll (?:be in touch|call you)\b/i,
  /\btake care\b/i,
  /आपका दिन शुभ/,
  /दिन (?:शुभ|अच्छा|मंगलमय) (?:हो|रहे)/,
  /शुभ दिन/,
  /शुभ रात्रि/,
  /अलविदा/,
  /फिर मिलेंगे|फिर मिलते हैं/,
  /बहुत-बहुत धन्यवाद/,
  /(?:कॉल|संपर्क)\s*करने के लिए\s*(?:धन्यवाद|शुक्रिया)/,
  /(?:धन्यवाद|शुक्रिया)[^।!?\n]{0,35}(?:कॉल|संपर्क)\s*करने के लिए/,
  /(?:अपना\s*)?(?:ख्याल|ध्यान)\s*रखें|ख्याल रखना/,
  /(?:बात|जुड़ने|जुड़ने|बातचीत)\s*करने के लिए\s*(?:धन्यवाद|शुक्रिया)/,
  /\b(?:thank you|thanks)\s+(?:for\s+)?(?:calling|contacting|reaching out)\b/i,
  /(?:दिन\s+शुभ\s+हो|शुभ\s+दिन)/,
];

/**
 * A bare thank-you, which is only a sign-off when nothing follows it.
 *
 * "शुक्रिया, तो आपका बजट कितना है?" is a receptionist mid-conversation, not a
 * goodbye — but "ठीक है, शुक्रिया!" is how a Hindi call actually ends, and
 * without this the call only closed on the wrap-up timer instead of the moment
 * the receptionist said goodbye.
 */
const CLOSING_TAIL = /(?:शुक्रिया|धन्यवाद|thanks|thank you)[\s!.,…|।]*$/i;

const NOT_GOODBYE_QUESTIONS = /\?|(?:चाहेंगे|सकते हैं|बताइए|बताएं|बता दीजिए|जान सकती|पूछ सकती|क्या आप|कितना|कहाँ|कब|समय|दिन|तारीख|नंबर|फ़ोन|फोन|नाम)\s*[\??|।!.\s]*$/i;

export function isGoodbye(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  // If the sentence asks a question or prompts for information, it is NEVER a goodbye
  if (NOT_GOODBYE_QUESTIONS.test(value)) return false;
  if (GOODBYE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return CLOSING_TAIL.test(value);
}

/** True when the lead has a valid phone number and an agreed next step / qualification. */
export function hasPhoneAndNextStep(lead: Lead): boolean {
  const cleanPhone = (lead.phone ?? "").replace(/\D/g, "");
  const hasPhone = cleanPhone.length >= 10;
  const hasNextStep = Boolean(
    lead.siteVisit ||
      lead.advisorRequested ||
      lead.callbackRequested ||
      isFullyQualified(lead),
  );
  return hasPhone && hasNextStep;
}

/**
 * True only when all required lead data has been cleanly captured and confirmed:
 * - Valid phone number (10 digits)
 * - Real caller name
 * - Core requirement fully qualified
 * - Final confirmation agreed
 */
export function isCallReadyToEnd(lead: Lead): boolean {
  const cleanPhone = (lead.phone ?? "").replace(/\D/g, "");
  const hasPhone = cleanPhone.length >= 10;
  const name = (lead.name ?? "").trim();
  const hasName =
    name.length >= 2 &&
    !/^(?:not shared|caller|new enquiry|enquiry|बिल्कुल|बताइए|ज़रूर|अच्छा)/i.test(name);
  const qualified =
    isFullyQualified(lead) ||
    Boolean(lead.advisorRequested) ||
    Boolean(lead.callbackRequested);
  const confirmed = lead.confirmation === "done";
  return hasPhone && hasName && qualified && confirmed;
}

/**
 * True while the end-of-conversation confirmation still has to run.
 *
 * A call is not finished the moment the requirement is captured. The receptionist
 * reads the whole requirement back, the caller confirms or corrects it, the name
 * and contact number are taken, and the number is read back once — only then may
 * the call close. Without this the admin gets a lead the customer never actually
 * agreed to.
 */
export function needsConfirmation(lead: Lead): boolean {
  return lead.confirmation !== "done";
}

/**
 * What the receptionist is asked to do next in the confirmation, chosen from the
 * record itself so a field the caller already gave is never asked for again.
 */
export function confirmationPrompt(
  lead: Lead,
  language?: { label: string; native?: string },
): string {
  const langLabel = language?.label ?? "the caller's chosen language";
  const langNative = language?.native ? ` (${language.native})` : "";
  const lock = language
    ? ` Speak strictly in ${langLabel}${langNative}. Do NOT speak English.`
    : "";

  if (!lead.name) {
    return `[Before you close, take the caller's NAME once, naturally in ${langLabel}${langNative}: ask what name you should note for them (e.g. "क्या मैं आपका शुभ नाम जान सकती हूँ?").${lock} Then continue.]`;
  }
  if (!lead.phone) {
    return `[Now ask for the caller's CONTACT NUMBER once, naturally in ${langLabel}${langNative}: what is the best number for the advisor to reach them on? Then read it back to confirm.${lock}]`;
  }
  /*
   * The read-back carries the record's actual values, not just an instruction to
   * "read it back". The model is told to speak exactly these facts, so a value
   * the caller just corrected cannot be read back from stale memory — the
   * corrected number or budget is what goes out, and the caller is asked to
   * agree to that updated record before the call may close.
   */
  const lines = reviewLines(lead);
  return [
    `[Before you finish, read the whole requirement back to the caller in ONE or TWO short sentences, strictly in ${langLabel}${langNative} and spoken naturally — do not read these labels aloud.${lock} These are the exact facts to cover, and nothing else:`,
    ...lines,
    `Then ask them to confirm it is all correct in ${langLabel}${langNative}. If they change anything, accept the change, repeat the corrected detail back, and ask them to confirm the updated record once more. Only after they agree, thank them and close.${lock}]`,
  ].join("\n");
}

/**
 * What the caller's reply to the closing confirmation means.
 *
 * - `advance`: a name, a number, or a clean yes — the flow moves on.
 * - `reread`: the caller changed something. The change is merged here and the
 *   updated record must be read back before the call can end.
 * - `none`: not a confirmation answer; leave the flow untouched.
 */
export type ConfirmationReply =
  | { kind: "advance"; lead: Lead }
  | { kind: "reread"; lead: Lead }
  | { kind: "none" };

/**
 * Read the caller's answer to the closing confirmation, purely.
 *
 * This is the application-owned half of "confirm the record and update it if
 * they change it": the model asks the question, but the decision to accept, to
 * edit, or to ignore is made here so it is deterministic and testable. A change
 * cue wins over a yes, so "yes, but make it 90 lakh" edits rather than closes,
 * and any spoken correction is folded through the one merge path before the
 * record is read back again.
 */
const HONORIFIC_STOPWORDS = new Set([
  "sir", "madam", "yes", "no", "ok", "okay", "thanks", "thank", "ji",
  "सर", "मैडम", "हाँ", "हां", "जी", "ठीक", "सही", "धन्यवाद", "शुक्रिया", "नमस्ते", "नमस्कार", "है", "था", "थी", "थे",
  "बिल्कुल", "बताइए", "बताएं", "बताओ", "ज़रूर", "जरूर", "अच्छा", "achha", "accha", "सुनिए", "दीजिए", "लीजिए",
  "साहब", "भैया", "मैम", "mam", "ma'am", "bilkul", "zaroor", "bataiye", "batao", "suniye", "dekhie", "dekhiye",
  "dekho", "kahiye", "bolo", "boliye", "kripya", "kripaya", "alvida", "han", "haan", "theek", "sahi", "karein", "karo",
  // Languages are never caller names:
  "hindi", "हिंदी", "हिन्दी", "english", "इंग्लिश", "अंग्रेजी",
  "punjabi", "पंजाबी", "gujarati", "गुजराती", "marathi", "मराठी",
  "bengali", "बंगाली", "tamil", "तमिल", "telugu", "तेलुगु",
  "kannada", "कन्नड़", "malayalam", "मलयालम", "urdu", "उर्दू",
  "language", "bhasha", "भाषा"
]);

export function extractHonorificName(text: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:^|[,\s।!?])([A-Za-z\u0900-\u097F]{2,})\s*जी(?=$|[,\s।!?])/u) ||
                text.match(/(?:^|[,\s।!?])([A-Za-z]{2,})\s+ji(?=$|[,\s।!?])/i);
  if (!match) return undefined;
  const candidate = match[1].trim();
  const lower = candidate.toLowerCase();
  if (HONORIFIC_STOPWORDS.has(lower) || HONORIFIC_STOPWORDS.has(candidate)) return undefined;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
}

export function applyConfirmationReply(
  lead: Lead,
  stage: "name" | "phone" | "confirm",
  text: string,
): ConfirmationReply {
  const spoken = text.trim();
  if (!spoken) return { kind: "none" };

  if (stage === "name") {
    const declined = /(?:nahi\s+(?:batana|bataunga|bataungi|dena)|rehnde|rehnedo|naam\s*nahi|no\s*name|don'?t\s*want\s*to\s*(?:say|share|tell)|skip|not\s*(?:sharing|saying))/i.test(spoken);
    const name = declined ? undefined : (lead.name ?? readName(spoken));
    const phone = extractPhone(spoken);
    if (name || phone || declined) {
      return {
        kind: "advance",
        lead: {
          ...lead,
          ...(name ? { name } : {}),
          ...(phone ? { phone } : {}),
        },
      };
    }
    return { kind: "none" };
  }

  if (stage === "phone") {
    const phone = lead.phone ?? extractPhone(spoken);
    const name = !lead.name ? readName(spoken) : undefined;
    if (phone || name) {
      return {
        kind: "advance",
        lead: {
          ...lead,
          ...(phone ? { phone } : {}),
          ...(name ? { name } : {}),
        },
      };
    }
    return { kind: "none" };
  }

  /*
   * The full read-back has gone out. A stated fact is the strongest signal of a
   * correction: "yes, but make it 90 lakh" and "no, Dwarka instead" both carry
   * a new value, and treating either as consent would file the value the caller
   * just rejected. Only a clean agreement — affirmative with nothing new in it —
   * finalises.
   */
  const patch = patchFromUtterance(spoken);
  if (isCorrection(spoken) || (patch && !isAffirmative(spoken))) {
    const corrected = patch ? reconcilePatch(lead, patch) : lead;
    return { kind: "reread", lead: corrected };
  }

  if (isAffirmative(spoken)) {
    if (patch) return { kind: "reread", lead: reconcilePatch(lead, patch) };
    if (!lead.phone) return { kind: "none" };
    return { kind: "advance", lead: { ...lead, confirmation: "done" } };
  }

  /* A reply that says nothing new and does not agree: leave the flow alone. */
  return { kind: "none" };
}

/**
 * Messages the receptionist should hear before the call closes, so the auto-end
 * reads as a natural ending rather than a dropped line.
 */
export const WRAP_UP_PROMPT =
  "[Your requirement is captured and the next step is agreed. Confirm what will happen next in ONE short sentence, thank the caller warmly, and say goodbye. Do not ask any further questions and do not mention the lead, the system, or a score.]";

export function wrapUpPrompt(
  language?: { label: string; native?: string },
): string {
  const langLabel = language?.label ?? "the caller's chosen language";
  const langNative = language?.native ? ` (${language.native})` : "";
  const lock = language
    ? ` Speak strictly in ${langLabel}${langNative}. Do NOT speak English.`
    : "";
  return `[Your requirement is captured and the next step is agreed. Confirm what will happen next in ONE short sentence strictly in ${langLabel}${langNative}, thank the caller warmly in ${langLabel}, and say goodbye in ${langLabel}.${lock} Do not ask any further questions and do not mention the lead, the system, or a score.]`;
}

export const HANDOFF_NOTE =
  "Caller asked for a human advisor — passing context on";
export const AUTO_END_NOTE = "Call ended — requirement captured";

export const TRANSFER_NOTE =
  "Transferring to a human advisor with full context";

/**
 * Build the "[LEAD STATE]" message the receptionist receives before it answers.
 *
 * The model cannot be trusted to remember the conversation, and re-asking a
 * question the caller already answered is the single most bot-like failure. So
 * the application — not the model — owns this state and hands it back on every
 * turn. The message also carries today's real date, so relative dates like
 * "tomorrow" or "Saturday" resolve against the actual clock.
 *
 * Only genuinely missing fields are listed as still needed. Settled fields are
 * marked as settled explicitly, so the model has no excuse to re-ask them.
 */
/** True once at least one core field is known, so state injection starts early. */
export function hasSettledCore(lead: Lead): boolean {
  return missingFields(lead).length < CORE_FIELDS.length;
}

/**
 * The state message to push, or undefined when it is identical to the last one.
 *
 * Keeping this pure means the "never spam the session with the same state" rule
 * is testable without a live call.
 */
export function stateMessageIfChanged(
  lead: Lead,
  today: string,
  lastSent: string,
): string | undefined {
  const message = buildStateMessage(lead, today);
  return message === lastSent ? undefined : message;
}

export function buildStateMessage(lead: Lead, today: string): string {
  const settled = (input?: string | number | null) =>
    input == null || input === ''
      ? 'NOT KNOWN — you may ask for this'
      : `${String(input)} (settled — ask the caller NOTHING about this)`;

  const lines = [
    `Intent: ${settled(lead.intent)}`,
    `Location: ${settled(lead.location)}`,
    `Property type: ${settled(lead.propertyType)}`,
    `Size: ${settled(lead.bhk)}`,
    `Budget: ${settled(lead.budgetLabel)}`,
    `Timeline: ${settled(lead.timeline)}`,
    `Preferences: ${lead.preferences.length ? lead.preferences.join(', ') : 'none noted'}`,
    `Name: ${lead.name ? `${lead.name} (settled — address caller as ${lead.name} जी / ${lead.name} ji, do NOT alter or guess another name)` : 'NOT KNOWN — you may ask for this'}`,
    `Phone: ${settled(lead.phone)}`,
    `Property under discussion: ${settled(
      lead.selectedPropertyId ? lead.selectedPropertyId : undefined,
    )}`,
    `Site visit: ${settled(lead.siteVisit)}`,
    `Callback: ${lead.callbackRequested ? settled(lead.callbackAt ?? 'requested') : 'not requested'}`,
    `Advisor requested: ${lead.advisorRequested ? 'yes — they are being handed to a human' : 'no'}`,
  ];

  const missing = missingFields(lead);
  const nextQuestion = missing.length
    ? `The next thing you still need is: ${missing[0]}. Ask ONLY about that, in one short question.`
    : 'You have every core detail you need. Do not ask for any of the above again — either take the next action they asked for, or close the call warmly.';

  return [
    '[LEAD STATE — what the caller has already told you. Everything marked settled must NEVER be asked again.]',
    `Today's date: ${today}.`,
    ...lines,
    nextQuestion,
    'Reminder: one question per turn, one or two short sentences, and never invent a property, a price, a slot or an address.',
  ].join('\n');
}
