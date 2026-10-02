import { detectAction, extractLeadFields, isQuestion } from "@/lib/ai/extract";
import { resolveDate, resolveTime } from "@/lib/ai/dates";
import { broadenSearchFor } from "@/lib/leads/match";
import {
  findPropertyByName,
  getPropertiesByIds,
} from "@/lib/properties/search";
import { applyExtraction, changedFields, recompute } from "@/lib/leads/update";
import {
  emptyLead,
  missingFields,
  type CoreField,
  type Lead,
} from "@/lib/leads/types";
import { budgetSummaryText } from "@/lib/leads/format";
import {
  AFTER_HANDOFF,
  MATCH_FOLLOWUPS,
  NO_MATCH_ACTIONS,
  RESTART_REPLIES,
  suggestedReplies,
} from "@/lib/whatsapp/options";
import {
  additionalMatchesMessage,
  broadenedMessage,
  finalRecapMessage,
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
  /** A message that should read as the end-of-conversation recap. */
  kind?: "recap";
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
        "Welcome to Delhi Homes. Please select your preferred language. Press 1 for Hindi. Press 2 for English. Press 3 for another language.",
        { quickReplies: ["1 · Hindi", "2 · English", "3 · Another language"] },
      ),
    ];
  }

  return [];
}

/**
 * Did the customer explicitly ask to see properties?
 *
 * Requirement-noun form: "show me 2 bhk options", "send me the listings".
 */
const asksForProperties = (text: string) =>
  /\b(?:show|send|share|view|see|give|push|link|forward|browse)\b[^.?]{0,40}\b(?:propert|option|listing|match|result|place|home|flat|apartment)\b|\b(?:more|other|any more|additional)\s+(?:option|propert|listing|choice|match)|details of\b|\bwhat have you got\b|\bwhat do you have\b/i.test(
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

  // Restart
  if (detectAction(text) === "restart") {
    const fresh = createEngineState(state.lead.source);
    messages.push(...openingMessages());
    return { messages, state: fresh };
  }

  const action = detectAction(text);
  const before = state.lead;
  let lead = applyExtraction(before, extractLeadFields(text));

  // Explicit actions take priority over further qualification.
  if (action === "advisor") {
    lead = recompute({ ...lead, advisorRequested: true });
    messages.push(
      assistant(
        "Of course — I'll connect you with a property advisor who can take this further. I've passed on everything you've shared.",
        { quickReplies: AFTER_HANDOFF },
      ),
    );
    return finish(state, lead, messages);
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
    lead = recompute({ ...lead, callbackRequested: true });
    messages.push(
      assistant(
        "Noted — I'll have an advisor call you back. They'll already have your requirements.",
        { quickReplies: AFTER_HANDOFF },
      ),
    );
    return finish(state, lead, messages);
  }

  if (action === "siteVisit") {
    /*
     * The requested slot is resolved from what the customer actually said and
     * stored as requested — never as booked, and never swapped for a different
     * day or time. Hard-coding a convenient slot here would make the assistant
     * quietly move an appointment the customer agreed to, which is exactly what
     * a real assistant must never do.
     */
    const slot = resolveDate(text)?.label;
    const time = resolveTime(text);
    const requested = slot && time ? `${slot}, ${time}` : (slot ?? "Date requested");
    lead = recompute({
      ...lead,
      siteVisit: time ? `${requested} — requested` : `${requested} — time to confirm`,
    });
    messages.push(
      assistant(
        time
          ? `Perfect, I've requested a site visit for ${requested}. Our advisor will confirm the time with you shortly.`
          : `Perfect, I've noted you'd like to visit ${requested}. What time would suit you?`,
        { quickReplies: time ? AFTER_HANDOFF : ["Morning", "Afternoon", "Evening"] },
      ),
    );
    if (time) return finish(state, lead, messages);
    return { messages, state: { ...state, lead } };
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
        assistant(copy, { quickReplies: MATCH_FOLLOWUPS, links: [link] }),
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
                hasSelectedProperty: true,
              })
            : MATCH_FOLLOWUPS,
        },
      ),
    );
    return { messages, state };
  }

  const missing = missingFields(lead);
  const learned = changedFields(before, lead);
  const canonicalBudget = budgetSummaryText(lead);
  const DASH = "\u2014";

  /** Acknowledge only what is genuinely new, so nothing is ever restated. */
  const learnt = () => {
    if (canonicalBudget && learned.includes(canonicalBudget))
      return `Got it ${DASH} ${canonicalBudget}.`;
    if (learned.length) return `Got it ${DASH} ${learned.join(", ")}.`;
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
   * "Just exploring" is a real answer, not a gap to be pushed on. Someone who
   * has said they are only browsing gets a low-pressure way in rather than
   * being asked to commit to buy or rent.
   */
  if (lead.timeline === "Just exploring" && !lead.bhk && !lead.budget) {
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
    action === "moreOptions" || asksForProperties(text) || asksForOptions(text);
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

  if (missing.length && !wantsProperties && action !== "broaden") {
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
  if ((action === "broaden" || wantsProperties) && !matches.length) {
    const widened = broadenSearchFor(lead);
    const fresh = widened.properties.filter(
      (property) =>
        action === "broaden" || !state.offeredPropertyIds.includes(property.id),
    );
    const built = fresh.length ? broadenedMessage(fresh, widened.relaxed) : undefined;

    if (built) return offer(fresh, built.links, built.text, MATCH_FOLLOWUPS);

    messages.push(assistant(NO_EXACT_MATCH, { quickReplies: NO_MATCH_ACTIONS }));
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
        { quickReplies: MATCH_FOLLOWUPS },
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
        quickReplies: MATCH_FOLLOWUPS,
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
    if (extra)
      return offer(
        getPropertiesByIds(extra.links.map((link) => link.propertyId)),
        extra.links,
        extra.text,
        MATCH_FOLLOWUPS,
      );

    messages.push(
      assistant(
        "That's everything I have matching your requirement right now. An advisor may know of options I can't see \u2014 would you like me to arrange that?",
        { quickReplies: ["Talk to an advisor", "Schedule a site visit"] },
      ),
    );
    return { messages, state: { ...state, lead } };
  }

  messages.push(
    isQuestion(text)
      ? assistant(
          "That's a detail I can't confirm from here without guessing \u2014 an advisor can check it properly. Would you like me to arrange that?",
          { quickReplies: ["Talk to an advisor", "Schedule a site visit"] },
        )
      : assistant(
          "I've noted that. Would you like to arrange a site visit, or speak with an advisor?",
          { quickReplies: MATCH_FOLLOWUPS },
        ),
  );
  return { messages, state: { ...state, lead } };
}

/**
 * Close the conversation: mark it finished and append the one concise recap of
 * the requirement, the matched property links and the decided next action.
 * No-ops if a recap was already sent, so the customer never gets it twice.
 */
function finish(
  state: EngineState,
  lead: Lead,
  messages: ChatMessage[],
): EngineReply {
  if (state.finished) {
    return { messages, state: { ...state, lead, finished: true } };
  }

  const matches = getPropertiesByIds(lead.matchedPropertyIds);
  const recap = finalRecapMessage(lead, matches);
  messages.push(
    assistant(recap.text, {
      kind: "recap",
      links: recap.links,
    }),
  );

  return {
    messages,
    state: {
      ...state,
      lead,
      finished: true,
      offeredMatches: true,
      offeredPropertyIds: mergeIds(
        state.offeredPropertyIds,
        recap.links.map((link) => link.propertyId),
      ),
      sentLinks: mergeLinks(state.sentLinks, recap.links),
    },
  };
}
