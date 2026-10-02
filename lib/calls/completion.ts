import { CORE_FIELDS, missingFields, type Lead } from "@/lib/leads/types";

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

/** Core fields that must all be present before a call may end itself. */
export const REQUIRED_FIELDS = CORE_FIELDS;

export function isFullyQualified(lead: Lead): boolean {
  return missingFields(lead).length === 0;
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
  /\bhave a (?:great|good|nice) day\b/i,
  /\bwe(?:'| ha)?ll (?:be in touch|call you)\b/i,
  /आपका दिन शुभ/,
  /धन्यवाद/,
  /शुभ रात्रि/,
];

export function isGoodbye(text: string): boolean {
  if (!text.trim()) return false;
  return GOODBYE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Messages the receptionist should hear before the call closes, so the auto-end
 * reads as a natural ending rather than a dropped line.
 */
export const WRAP_UP_PROMPT =
  "[Your requirement is captured and the next step is agreed. Confirm what will happen next in ONE short sentence, thank the caller warmly, and say goodbye. Do not ask any further questions and do not mention the lead, the system, or a score.]";

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
    `Name: ${settled(lead.name)}`,
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
