import {
  asksForPropertyList,
  detectAction,
  extractLeadFields,
  isQuestion,
} from "@/lib/ai/extract";
import { resolveDate, resolveTime } from "@/lib/ai/dates";
import { broadenSearchFor, canMatchLead } from "@/lib/leads/match";
import { findPropertyByName } from "@/lib/properties/search";
import { getPropertiesByIds } from "@/lib/data/inventory";
import { applyExtraction, changedFields, recompute } from "@/lib/leads/update";
import {
  emptyLead,
  missingFields,
  type CoreField,
  type Lead,
} from "@/lib/leads/types";
import { budgetSummaryText } from "@/lib/leads/format";
import { buildReviewMessage, REVIEW_REPLIES } from "@/lib/leads/confirmation";
import { RESTART_REPLIES, suggestedReplies } from "@/lib/whatsapp/options";
import {
  additionalMatchesMessage,
  broadenedMessage,
  NO_EXACT_MATCH,
  propertyLinkMessage,
  toSentLink,
  type SentLink,
} from "@/lib/whatsapp/messages";
import type { Property } from "@/lib/data/properties";

/** Never suggest more than this at once, unless the customer asks for more. */
const MATCH_LIMIT = 3;

export type ChatMessage = {
  id: string;
  side: "user" | "assistant";
  text: string;
  at: string;
  quickReplies?: string[];
  propertyIds?: string[];
  /** Property links actually sent to the customer with this message. */
  links?: SentLink[];
  /** A message that should read as the end-of-conversation recap/review. */
  kind?: "recap" | "review";
};

export type EngineState = {
  lead: Lead;
  offeredMatches: boolean;
  finished: boolean;
  /** Property ids shown as cards or links so far, so nothing is repeated. */
  offeredPropertyIds: string[];
  /** Property ids whose detail link has actually been sent to the customer. */
  sentLinks: SentLink[];
};

let counter = 0;
const nextId = () => `m${++counter}`;
const time = () =>
  new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const assistant = (
  text: string,
  extra?: Pick<ChatMessage, "quickReplies" | "propertyIds" | "links" | "kind">,
): ChatMessage => ({
  id: nextId(),
  side: "assistant",
  text,
  at: time(),
  ...extra,
});

export const customer = (text: string): ChatMessage => ({
  id: nextId(),
  side: "user",
  text,
  at: time(),
});

export function createEngineState(
  source: Lead["source"] = "WhatsApp",
): EngineState {
  return {
    lead: emptyLead(source),
    offeredMatches: false,
    finished: false,
    offeredPropertyIds: [],
    sentLinks: [],
  };
}

/** Merge newly-shown property ids into the running list, no duplicates. */
function mergeIds(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

/** Merge newly-sent links into the running record, newest wins, no duplicates. */
function mergeLinks(existing: SentLink[], incoming: SentLink[]): SentLink[] {
  const byId = new Map(existing.map((link) => [link.propertyId, link]));
  for (const link of incoming) byId.set(link.propertyId, link);
  return Array.from(byId.values());
}

/* -------------------------------------------------------------------------
 * Conversation state.
 *
 * The stage is DERIVED from the canonical lead each turn rather than stored: a
 * stateless turn already receives the lead, the shown property ids and the sent
 * links, so deriving keeps one source of truth and cannot drift from the record
 * the admin panel shows. The point of naming the stage explicitly is that an
 * action, once completed, is terminal — it is never offered again.
 * ----------------------------------------------------------------------- */

export type ConversationStage =
  | "QUALIFYING"
  | "SHOWING_MATCHES"
  | "CHOOSING_VISIT_TIME"
  | "VISIT_REQUESTED"
  | "ADVISOR_REQUESTED"
  | "CALLBACK_REQUESTED"
  | "COMPLETED";

/** Actions the customer has already completed — never offered a second time. */
export type CompletedActions = {
  siteVisit: boolean;
  advisor: boolean;
  callback: boolean;
};

export function completedActions(lead: Lead): CompletedActions {
  return {
    siteVisit: Boolean(lead.siteVisit),
    advisor: Boolean(lead.advisorRequested),
    callback: Boolean(lead.callbackRequested),
  };
}

/** Where the conversation is, read off the lead — never guessed by the model. */
export function conversationStage(
  lead: Lead,
  offeredPropertyIds: string[],
): ConversationStage {
  const done = completedActions(lead);
  if (done.advisor) return "ADVISOR_REQUESTED";
  if (done.callback) return "CALLBACK_REQUESTED";
  if (isVisitTimePending(lead)) return "CHOOSING_VISIT_TIME";
  if (done.siteVisit) return "VISIT_REQUESTED";
  if (lead.recapSent || lead.confirmation) return "COMPLETED";
  if (offeredPropertyIds.length) return "SHOWING_MATCHES";
  return "QUALIFYING";
}

/** True while the customer has asked for a visit but not yet said when. */
export function isVisitTimePending(lead: Lead): boolean {
  return Boolean(lead.siteVisit) && /time to confirm/i.test(lead.siteVisit ?? "");
}

/**
 * True when a promised next step has actually landed.
 *
 * A visit with no time yet ("Visit requested — time to confirm") is still open:
 * the conversation has to keep going so the assistant can collect the time,
 * rather than closing on an appointment that does not exist.
 */
export function hasSettledNextStep(lead: Lead): boolean {
  return Boolean(
    (lead.siteVisit && !isVisitTimePending(lead)) ||
      lead.advisorRequested ||
      lead.callbackRequested,
  );
}

/**
 * True when the conversation has served its purpose and should close.
 *
 * An explicit hand-off (advisor or callback) is terminal the moment it is asked
 * for — the customer wants a person, so an advisor takes the partial requirement
 * rather than the assistant interrogating them further. A site visit closes only
 * once the full requirement is captured, so an early "can I visit?" still gets
 * the area, size and budget collected before the recap goes out.
 */
export function isConversationComplete(lead: Lead): boolean {
  if (lead.advisorRequested || lead.callbackRequested) return true;
  return missingFields(lead).length === 0 && hasSettledNextStep(lead);
}

/**
 * Read a bare time-of-day answer ("Afternoon") as the visit time the assistant
 * just asked for. Kept deliberately narrow: a long sentence that happens to
 * contain "morning" is a new request, not an answer to the pending question.
 */
export function visitTimeSelection(text: string): string | undefined {
  const value = text.trim().toLowerCase();
  if (!value || value.length > 50) return undefined;
  if (/^(?:this\s+)?weekend$/i.test(value)) return "This weekend";
  if (/^tomorrow\s+morning$/i.test(value)) return "Tomorrow morning";
  if (/^tomorrow\s+afternoon$/i.test(value)) return "Tomorrow afternoon";
  if (/^tomorrow\s+evening$/i.test(value)) return "Tomorrow evening";
  const date = resolveDate(text);
  const time = resolveTime(text);
  if (date?.label && time) return `${date.label}, ${time}`;
  if (date?.label) {
    if (/\bmorning\b|\bsubah\b/.test(value)) return `${date.label} morning`;
    if (/\bafternoon\b|\bdopahar\b/.test(value)) return `${date.label} afternoon`;
    if (/\bevening\b|\bshaam\b|\bsham\b/.test(value)) return `${date.label} evening`;
    return date.label;
  }
  if (/\bmorning\b|\bsubah\b/.test(value)) return "Morning";
  if (/\bafternoon\b|\bdopahar\b/.test(value)) return "Afternoon";
  if (/\bevening\b|\bshaam\b|\bsham\b/.test(value)) return "Evening";
  if (time) return time;
  return undefined;
}

/** Fold a chosen time-of-day into the visit request, keeping any date already set. */
export function withVisitTime(lead: Lead, chosen: string): Lead {
  const raw = lead.siteVisit ?? "";
  const datePart = raw.replace(/\s*[—-]\s*time to confirm\s*$/i, "").trim();
  const hasDate =
    Boolean(datePart) && !/^(?:visit requested|requested)$/i.test(datePart);
  return {
    ...lead,
    siteVisit: hasDate
      ? `${datePart}, ${chosen} — requested`
      : `${chosen} visit requested — to confirm`,
  };
}

/**
 * The actions still open, given what is already done.
 *
 * This is the rule that breaks the loop: after a visit has been arranged, the
 * "Schedule a site visit" button simply is not built any more.
 */
export function nextActionButtons(completed: CompletedActions): string[] {
  const buttons: string[] = [];
  if (!completed.siteVisit) buttons.push("Schedule a site visit");
  if (!completed.advisor) buttons.push("Talk to an advisor");
  buttons.push("Done");
  return buttons;
}

export function matchButtons(
  completed: CompletedActions,
  hasMatches: boolean,
  /** The properties just shown — one "Tell me about X" button each. */
  matchNames: string[] = [],
): string[] {
  const buttons: string[] = [];
  for (const name of matchNames.slice(0, 2)) {
    const label = `Tell me about ${name}`;
    if (!buttons.includes(label)) buttons.push(label);
  }
  if (!completed.siteVisit) buttons.push("Schedule a site visit");
  if (!completed.advisor) buttons.push("Talk to an advisor");
  if (hasMatches && buttons.length < 4) buttons.push("Show more options");
  if (!buttons.length) buttons.push("Done");
  return buttons.slice(0, 4);
}

/** The honest ways out of a no-match, minus any handoff already made. */
export function noMatchButtons(completed: CompletedActions): string[] {
  const buttons = ["Broaden search", "Adjust budget"];
  if (!completed.advisor) buttons.push("Talk to an advisor");
  return buttons;
}

/**
 * The WhatsApp conversation starts empty.
 *
 * A business line does not greet you before you say something — it is simply
 * there, online, waiting. Preloading a scripted opener, or worse a pre-written
 * customer message, turns the demo into a replay; the visitor has to open it.
 *
 * The phone path is the opposite case: the caller hears the receptionist the
 * moment the line connects, so that greeting is real.
 */
export function openingMessages(
  source: Lead["source"] = "WhatsApp",
): ChatMessage[] {
  if (source === "Phone") {
    return [
      assistant(
        "Namaste, Delhi Homes mein aapka swagat hai. Aap kis tarah ki property dekh rahe hain?",
        {
          quickReplies: [
            "2 BHK chahiye Dwarka me",
            "I want to buy a flat",
            "Sirf price jaanna hai",
          ],
        },
      ),
    ];
  }

  return [];
}

/**
 * The customer is signalling the conversation is done — "thanks, that's all",
 * "what next". Used to close with a recap instead of another question.
 */
const isWrapUp = (text: string) =>
  /\b(?:thanks|thank you|thats all|that.s all|bye|goodbye|done|anything else|what next|whats next|next step)\b/i.test(
    text,
  );

/**
 * "Show me something suitable", "show me anything".
 *
 * Deliberately separate from `asksForProperties`, which needs a noun like
 * "property" or "options". A customer who asks for "something" has asked to see
 * listings just as clearly, and treating that as a no-op would leave the
 * assistant mid-qualification while they wait for homes.
 */
const asksForOptions = (text: string) =>
  /\b(?:show|see|view|give|send|share|browse)\s+me\b/i.test(text) &&
  /\b(?:something|anything|whatever|suitable|available|matches?|what you have|couple of|a few)\b/i.test(
    text,
  );

/**
 * One well-phrased question per field.
 *
 * A single phrasing, not a pool. The fallback only asks about a field the
 * customer has not answered, and a field is only re-asked when their previous
 * reply genuinely did not contain it — in which case repeating the question is
 * the natural thing to do, not a glitch. (An earlier version kept three
 * variants per field and passed the array straight into the sentence, which is
 * how the fallback ended up reading three questions out at once.)
 */
const questionFor: Record<CoreField, string> = {
  intent: "Are you looking to buy or rent?",
  location: "Which area are you looking in?",
  bhk: "What size are you after?",
  budget: "What budget range should I work with?",
  timeline: "When are you hoping to move forward?",
};

/** The one question for a missing core field, shared with the model path. */
export const fieldQuestion = questionFor;


export function shouldShowLead(state: EngineState): boolean {
  return (
    state.finished ||
    state.lead.status === "Qualified" ||
    state.lead.status === "Handed off"
  );
}

export type EngineReply = { messages: ChatMessage[]; state: EngineState };

/** Pure-ish reducer: takes the current state plus what the user typed. */
export function respond(state: EngineState, userText: string): EngineReply {
  const text = userText.trim();
  const messages: ChatMessage[] = [customer(text)];

  /*
   * "Change my requirements" is an EDIT, not a reset. The customer says what is
   * different and the next message updates only that field; wiping the lead and
   * starting again is exactly the behaviour this used to have and must not.
   */
  if (/change\s+(?:my\s+|the\s+)?requirements?/i.test(text)) {
    messages.push(
      assistant(
        "Of course — tell me what's changed (area, size, budget or timeline) and I'll update it.",
      ),
    );
    return { messages, state };
  }

  // Restart
  if (detectAction(text) === "restart") {
    const fresh = createEngineState(state.lead.source);
    messages.push(...openingMessages());
    return { messages, state: fresh };
  }

  const action = detectAction(text);
  const before = state.lead;
  const completed = completedActions(before);
  let lead = applyExtraction(before, extractLeadFields(text));

  /**
   * Close the conversation once the requirement is captured and the agreed next
   * step is real. If a core field is still open — or a visit is still waiting on
   * a time — the confirmation goes out and qualification continues.
   */
  const finalised = (): EngineReply =>
    isConversationComplete(lead)
      ? finish(state, lead, messages)
      : { messages, state: { ...state, lead } };

  /*
   * Opt-out is terminal and honoured before anything else. The customer asked
   * not to be contacted again, so there is no recap, no question and no CTA —
   * just the confirmation, and the flag travels with the lead.
   */
  if (action === "optOut") {
    const optedOut = recompute({
      ...before,
      optOut: true,
      nextAction: "opted_out",
    });
    messages.push(
      assistant(
        "You're unsubscribed — we won't send you any follow-up messages. Message here any time if you'd like help again.",
      ),
    );
    return { messages, state: { ...state, lead: optedOut, finished: true } };
  }

  // Explicit actions take priority over further qualification.
  if (action === "advisor") {
    if (completed.advisor) {
      // Terminal: a hand-off that already happened is never made again.
      messages.push(
        assistant(
          "You're already connected with an advisor — they'll be in touch. Anything else I can help with?",
          { quickReplies: ["Done"] },
        ),
      );
      return { messages, state: { ...state, lead } };
    }
    lead = recompute({
      ...lead,
      advisorRequested: true,
      nextAction: "human_handoff",
    });
    messages.push(
      assistant(
        "Done — I've passed your requirement to a property advisor. They have everything you've shared, so you won't need to repeat it.",
      ),
    );
    return finalised();
  }

  if (action === "adjustBudget") {
    /*
     * The customer asked to change the budget, so the old figure is genuinely
     * obsolete. Clearing it is the honest move: keeping it would leave a stale
     * number on the lead that the next match would be run against.
     */
    lead = recompute({
      ...lead,
      budget: undefined,
      budgetMin: undefined,
      budgetMax: undefined,
      budgetLabel: undefined,
      matchedPropertyIds: [],
    });
    messages.push(
      assistant("No problem. What budget should I work with?", {
        quickReplies: suggestedReplies(lead, {
          hasMatches: false,
          hasSelectedProperty: Boolean(lead.selectedPropertyId),
        }),
      }),
    );
    return { messages, state: { ...state, lead } };
  }

  if (action === "callback") {
    lead = recompute({
      ...lead,
      callbackRequested: true,
      nextAction: "callback",
    });
    messages.push(
      assistant(
        "Noted — I'll have an advisor call you back. They'll already have your requirements.",
      ),
    );
    return finalised();
  }

  if (action === "siteVisit") {
    /*
     * The requested slot is resolved from what the customer actually said and
     * stored as requested — never as booked, and never swapped for a different
     * day or time. When no time was given we ask for it AND remember that an
     * answer is pending, so the next "morning / afternoon / evening" resumes
     * the visit instead of falling back to a generic question (the old loop).
     */
    const slot = resolveDate(text)?.label;
    const time = resolveTime(text);

    if (slot && time) {
      lead = recompute({
        ...lead,
        siteVisit: `${slot}, ${time} — requested`,
        nextAction: "site_visit",
      });
      messages.push(
        assistant(
          `Perfect — I've requested a site visit for ${slot}, ${time}. Our team will confirm the exact slot with you shortly.`,
        ),
      );
      return finalised();
    }

    if (time) {
      lead = recompute({
        ...withVisitTime(lead, time),
        nextAction: "site_visit",
      });
      messages.push(
        assistant(
          `Perfect — I've noted ${time}. I'll pass your requirement to the property team so they can confirm the exact slot.`,
        ),
      );
      return finalised();
    }

    lead = recompute({
      ...lead,
      siteVisit: slot
        ? `${slot} — time to confirm`
        : "Visit requested — time to confirm",
      nextAction: "site_visit",
    });
    messages.push(
      assistant(
        slot
          ? `Great — I've noted ${slot}. What time works better for you: morning, afternoon, or evening?`
          : "Great — what time works better for you: morning, afternoon, or evening?",
        { quickReplies: ["Morning", "Afternoon", "Evening"] },
      ),
    );
    return { messages, state: { ...state, lead } };
  }

  /*
   * A pending visit time. "Morning / Afternoon / Evening" is the answer to the
   * question the assistant just asked, so it has to move the visit forward — not
   * fall through to a generic "what next?" that re-offers the action the
   * customer already chose. This is the fix for the loop after "Afternoon".
   */
  if (isVisitTimePending(before) && !action) {
    const chosen = visitTimeSelection(text);
    if (chosen) {
      lead = recompute(
        { ...withVisitTime(lead, chosen), nextAction: "site_visit" },
        { keepMatches: true },
      );
      messages.push(
        assistant(
          `Perfect — I've noted an ${chosen.toLowerCase()} visit preference. I'll pass your requirement to the property team so they can confirm the exact slot.`,
        ),
      );
      return finalised();
    }
  }

  /*
   * The requirement is captured and a next step is already agreed — close with
   * the recap rather than conversing on. This is what makes a finished enquiry
   * actually finish: without it the assistant kept re-offering the same three
   * options on every later message, which is the loop customers saw.
   */
  if (!state.finished && !lead.recapSent && isConversationComplete(lead)) {
    return finish(state, lead, messages);
  }

  if (action === "notNow") {
    messages.push(
      assistant(
        "No problem at all. I'll leave it with you — reach out whenever you're ready.",
        { quickReplies: RESTART_REPLIES },
      ),
    );
    return finish(state, lead, messages);
  }

  // The customer named a specific property — send that link right away.
  if (action === "propertyDetails") {
    const named =
      findPropertyByName(text) ??
      findPropertyByName(
        getPropertiesByIds(lead.matchedPropertyIds)[0]?.name ?? "",
      );
    const top = named;

    if (top) {
      const sentLinks = mergeLinks(state.sentLinks, [toSentLink(top)]);
      const { text: copy, link } = propertyLinkMessage(top);
      messages.push(
        assistant(copy, {
          quickReplies: matchButtons(completed, true, [top.name]),
          links: [link],
        }),
      );
      return {
        messages,
        state: {
          ...state,
          lead,
          offeredPropertyIds: mergeIds(state.offeredPropertyIds, [top.id]),
          sentLinks,
        },
      };
    }

    const missing = missingFields(lead);
    messages.push(
      assistant(
        missing.length
          ? "I can share full details once I know a little more. " +
              questionFor[missing[0]]
          : "I don't have a listing matching that in front of me \u2014 an advisor can look into it.",
        {
          quickReplies: missing.length
            ? suggestedReplies(lead, {
                hasMatches: false,
                // Nothing was resolved, so there is no property to act on — the
                // buttons must offer the next qualification answer, not
                // property actions for a listing we could not find.
                hasSelectedProperty: false,
              })
            : matchButtons(completed, true),
        },
      ),
    );
    return { messages, state };
  }

  const missing = missingFields(lead);
  const learned = changedFields(before, lead);
  const canonicalBudget = budgetSummaryText(lead);
  const DASH = "\u2014";

  /*
   * Vary the acknowledgement. Starting every reply with the same word is what
   * makes a conversation read as a script, so the opener rotates over a small
   * set keyed on the facts themselves — no per-conversation state needed, and
   * the same lead always reads back the same way.
   */
  const ACKS = ["Got it", "Sure", "Okay", "Perfect", "Noted"];
  const ack = () => {
    const seed = learned.join(", ");
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash += seed.charCodeAt(i);
    return ACKS[hash % ACKS.length];
  };

  /** Acknowledge only what is genuinely new, so nothing is ever restated. */
  const learnt = () => {
    if (canonicalBudget && learned.includes(canonicalBudget))
      return `${ack()} ${DASH} ${canonicalBudget}.`;
    if (learned.length) return `${ack()} ${DASH} ${learned.join(", ")}.`;
    return "";
  };

  const withAck = (question: string) => {
    const ack = learnt();
    return ack ? `${ack} ${question}` : question;
  };

  const buttonsFor = (hasMatches: boolean) =>
    suggestedReplies(lead, {
      hasMatches,
      hasSelectedProperty: Boolean(lead.selectedPropertyId),
    });

  /*
   * The customer is wrapping up and there is nothing left to ask. Close with
   * the one recap of the requirement and the closest matches rather than
   * another question — the same completion the model path produces.
   */
  if (!state.finished && !missing.length && isWrapUp(text)) {
    return finish(state, lead, messages);
  }

  /*
   * "Just exploring" is a real answer, not a gap to be pushed on. Someone who
   * has said they are only browsing gets a low-pressure way in rather than
   * being asked to commit to buy or rent.
   *
   * It only fires when that is the new fact this turn. Repeating the same
   * exploratory question on every later message is exactly the loop the
   * assistant must never fall into.
   */
  if (
    lead.timeline === "Just exploring" &&
    !lead.bhk &&
    !lead.budget &&
    learned.includes("Just exploring")
  ) {
    messages.push(
      assistant(
        `No pressure at all. What kind of home are you curious about ${DASH} a 2 BHK in a particular area, or are you just getting a feel for prices?`,
        {
          quickReplies: ["2 BHK", "3 BHK", "Show me options", "Talk to an advisor"],
        },
      ),
    );
    return { messages, state: { ...state, lead } };
  }

  /*
   * Qualification first, listings second.
   *
   * The conversation moves on to properties only when the requirement is
   * complete or the customer asks to see something. Searching as soon as the
   * inventory *could* be searched is what turns an assistant into a sales
   * script: it stops the qualification halfway to push three listings.
   */
  const wantsProperties =
    action === "moreOptions" ||
    asksForPropertyList(text) ||
    asksForOptions(text);
  const matches = getPropertiesByIds(lead.matchedPropertyIds);

  const offer = (
    properties: Property[],
    links: SentLink[],
    text: string,
    buttons: string[],
  ): EngineReply => {
    messages.push(assistant(text, { quickReplies: buttons, links }));
    return {
      messages,
      state: {
        ...state,
        lead,
        offeredMatches: true,
        offeredPropertyIds: mergeIds(
          state.offeredPropertyIds,
          properties.map((property) => property.id),
        ),
        sentLinks: mergeLinks(state.sentLinks, links),
      },
    };
  };

  /*
   * Searching requires enough information to search with. "Show me options"
   * with nothing known must qualify, not dump the whole inventory as a
   * "closest match" — so a request to see properties only bypasses the next
   * qualification question once the lead can actually be matched.
   */
  const searchable = canMatchLead(lead);

  /*
   * A requirement can be complete enough to search while an optional field is
   * still open — intent, area, size and budget are what the inventory needs, and
   * the timeline is not one of them. On that turn the homes are what the
   * customer is waiting for, so they are shown now and the remaining question
   * follows, rather than holding the listings back until every last field is
   * filled and making the customer ask for them a second time.
   */
  const justBecameSearchable =
    searchable && !canMatchLead(before) && matches.length > 0;

  /*
   * The turn the requirement first becomes searchable is the turn the customer
   * has been waiting for. Making them sit through one more question (the
   * timeline, which matching does not use) before they see a single home is how
   * a complete, one-line requirement like "2 BHK chahiye Rohini mein, budget
   * 90L" got answered with nothing but another question. The homes go out now,
   * and the one field still open is asked for alongside them, so the lead still
   * completes without a second round.
   */
  if (justBecameSearchable) {
    const offered = matches.slice(0, MATCH_LIMIT);
    const links = offered.map(toSentLink);
    messages.push(
      assistant(
        withAck(
          "Based on what you've told me, these look like the closest matches in what I have available:",
        ),
        { propertyIds: offered.map((property) => property.id), links },
      ),
    );
    messages.push(
      missing.length
        ? assistant(questionFor[missing[0]], { quickReplies: buttonsFor(false) })
        : assistant(
            "Would you like to arrange a site visit, or speak with an advisor?",
            {
              quickReplies: matchButtons(
                completed,
                true,
                offered.map((property) => property.name),
              ),
            },
          ),
    );
    return {
      messages,
      state: {
        ...state,
        lead,
        offeredMatches: true,
        offeredPropertyIds: mergeIds(
          state.offeredPropertyIds,
          offered.map((property) => property.id),
        ),
        sentLinks: mergeLinks(state.sentLinks, links),
      },
    };
  }

  if (
    missing.length &&
    action !== "broaden" &&
    (!wantsProperties || !searchable)
  ) {
    messages.push(
      assistant(withAck(questionFor[missing[0]]), {
        quickReplies: buttonsFor(false),
      }),
    );
    return { messages, state: { ...state, lead } };
  }

  /*
   * Nothing matched exactly. Widening the search is a real action with a real
   * result: every step reports which of the customer's stated requirements it
   * dropped, so a near miss is never presented as a match.
   */
  if (searchable && (action === "broaden" || wantsProperties) && !matches.length) {
    const widened = broadenSearchFor(lead);
    const fresh = widened.properties.filter(
      (property) =>
        action === "broaden" || !state.offeredPropertyIds.includes(property.id),
    );
    const built = fresh.length ? broadenedMessage(fresh, widened.relaxed) : undefined;

    if (built)
      return offer(
        fresh,
        built.links,
        built.text,
        matchButtons(completed, true, fresh.map((property) => property.name)),
      );

    messages.push(assistant(NO_EXACT_MATCH, { quickReplies: noMatchButtons(completed) }));
    return { messages, state: { ...state, lead, offeredMatches: true } };
  }

  if (!state.offeredMatches && matches.length) {
    const offered = matches.slice(0, MATCH_LIMIT);
    const links = offered.map(toSentLink);
    messages.push(
      assistant(
        withAck(
          "Based on what you've told me, these look like the closest matches in what I have available:",
        ),
        {
          propertyIds: offered.map((property) => property.id),
          links,
        },
      ),
    );
    messages.push(
      assistant(
        "Would you like to arrange a site visit, or speak with an advisor?",
        {
          quickReplies: matchButtons(
            completed,
            true,
            offered.map((property) => property.name),
          ),
        },
      ),
    );
    return {
      messages,
      state: {
        ...state,
        lead,
        offeredMatches: true,
        offeredPropertyIds: mergeIds(
          state.offeredPropertyIds,
          offered.map((property) => property.id),
        ),
        sentLinks: mergeLinks(state.sentLinks, links),
      },
    };
  }

  /*
   * The matches were already shown, and the customer asked to see something
   * again ("show me something suitable"). Re-send the real listings with their
   * detail links rather than answering with a canned acknowledgement — the
   * link is the thing they asked for. "Show more options" has its own branch
   * below, which pages on to listings not yet sent.
   */
  if (wantsProperties && action !== "moreOptions" && matches.length) {
    const offered = matches.slice(0, MATCH_LIMIT);
    const links = offered.map(toSentLink);
    messages.push(
      assistant("Here are the closest matches I have for what you shared:", {
        quickReplies: matchButtons(
          completed,
          true,
          offered.map((property) => property.name),
        ),
        propertyIds: offered.map((property) => property.id),
        links,
      }),
    );
    return {
      messages,
      state: {
        ...state,
        lead,
        offeredMatches: true,
        offeredPropertyIds: mergeIds(
          state.offeredPropertyIds,
          offered.map((property) => property.id),
        ),
        sentLinks: mergeLinks(state.sentLinks, links),
      },
    };
  }

  // Already offered: the customer can ask for more, or name a property.
  if (action === "moreOptions") {
    const extra = additionalMatchesMessage(matches, state.offeredPropertyIds);
    if (extra) {
      const more = getPropertiesByIds(extra.links.map((link) => link.propertyId));
      return offer(
        more,
        extra.links,
        extra.text,
        matchButtons(completed, true, more.map((property) => property.name)),
      );
    }

    messages.push(
      assistant(
        "That's everything I have matching your requirement right now. An advisor may know of options I can't see \u2014 would you like me to arrange that?",
        { quickReplies: nextActionButtons(completed) },
      ),
    );
    return { messages, state: { ...state, lead } };
  }

  /*
   * The conversation is already complete and nothing further was recognised.
   * Every real branch (matches, more options, a named property, broaden) has
   * run by now, so this only catches stray messages — and it stays closed
   * instead of re-offering a CTA the customer already finished.
   */
  if (state.finished) {
    messages.push(
      assistant(
        "I've noted that. If anything changes, just tell me and I'll pick it right back up.",
        { quickReplies: RESTART_REPLIES },
      ),
    );
    return { messages, state: { ...state, lead, finished: true } };
  }

  /*
   * Nothing left to qualify and no recognised request. This is the one place
   * that used to repeat the "arrange a site visit?" CTA forever, so the buttons
   * are built from what is actually still open — a completed action is never
   * offered again.
   */
  const hasMatches = state.offeredPropertyIds.length > 0;
  messages.push(
    isQuestion(text)
      ? assistant(
          "That's a detail I can't confirm from here without guessing \u2014 an advisor can check it properly. Would you like me to arrange that?",
          { quickReplies: matchButtons(completed, hasMatches) },
        )
      : assistant(
          completed.advisor
            ? "Got it — I've added that to the notes for your advisor."
            : "Noted. Would you like to arrange a site visit, or speak with an advisor?",
          { quickReplies: matchButtons(completed, hasMatches) },
        ),
  );
  return { messages, state: { ...state, lead } };
}

/**
 * Close the qualification: mark the requirement settled and hand the customer
 * the one read-back that asks them to confirm it. The recap itself goes out only
 * after the confirmation (name, number, number read-back) has completed — so a
 * name or a budget the customer never actually agreed to cannot reach the
 * business. No-ops once a review has already gone out.
 */
function finish(
  state: EngineState,
  lead: Lead,
  messages: ChatMessage[],
): EngineReply {
  if (state.finished) {
    return { messages, state: { ...state, lead, finished: true } };
  }

  messages.push(
    assistant(buildReviewMessage(lead), {
      kind: "review",
      quickReplies: REVIEW_REPLIES,
    }),
  );

  return {
    messages,
    state: {
      ...state,
      lead: { ...lead, confirmation: "review" },
      finished: true,
      offeredMatches: true,
      offeredPropertyIds: state.offeredPropertyIds,
      sentLinks: state.sentLinks,
    },
  };
}
