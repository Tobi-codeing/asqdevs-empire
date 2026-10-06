import {
  asksForPropertyList,
  detectAction,
  extractLeadFields,
} from "@/lib/ai/extract";
import { resolveDate, resolveTime } from "@/lib/ai/dates";
import {
  formatBudget,
  formatBudgetRange,
  type Property,
} from "@/lib/data/properties";
import {
  getKnownLocations,
  getPropertiesByIds,
} from "@/lib/data/inventory";
import { applyExtraction, recompute } from "@/lib/leads/update";
import {
  advanceConfirmation,
  buildReviewMessage,
  REVIEW_REPLIES,
} from "@/lib/leads/confirmation";
import { deliverLead } from "@/lib/leads/delivery";
import { recordLead, syncLeadToRelay } from "@/lib/leads/store";
import { missingFields, type Lead } from "@/lib/leads/types";
import { broadenSearchFor } from "@/lib/leads/match";
import { nextActionKey } from "@/lib/leads/view";
import { findPropertyByName } from "@/lib/properties/search";
import {
  fieldQuestion,
  isConversationComplete,
  isVisitTimePending,
  respond,
  visitTimeSelection,
  withVisitTime,
  type EngineState,
} from "@/lib/whatsapp/engine";
import {
  generateTurn,
  providerCoolingDown,
  providerStatus,
  type HistoryItem,
} from "@/lib/whatsapp/gemini";
import { inventoryContext, searchForLead, sentLinkFor, MAX_MATCHES } from "@/lib/whatsapp/inventory";
import { parseNextStep, safeLead, validatedExtraction } from "@/lib/whatsapp/lead-guard";
import {
  additionalMatchesMessage,
  broadenedMessage,
  finalRecapMessage,
  NO_EXACT_MATCH,
  type SentLink,
} from "@/lib/whatsapp/messages";
import { reconcileReplies } from "@/lib/whatsapp/options";

export type TurnInput = {
  text: string;
  lead?: Partial<Lead>;
  history: HistoryItem[];
  offeredPropertyIds: string[];
  sentLinks: SentLink[];
};

/** One outgoing assistant message. A single turn may send more than one. */
export type OutgoingMessage = {
  text: string;
  quickReplies?: string[];
  propertyIds?: string[];
  links?: SentLink[];
  /** The closing recap / confirmation read-back. */
  kind?: "recap" | "review";
};

export type TurnResult = {
  restarted?: true;
  /** Assistant messages to append, in order. */
  replies: OutgoingMessage[];
  lead: Lead;
  offeredPropertyIds: string[];
  sentLinks: SentLink[];
};

/**
 * How long a turn is willing to wait for the model before answering from the
 * deterministic engine instead.
 *
 * A healthy model replies in a second or two, so this is a backstop against a
 * hung or overloaded provider, not a target — anything the model returns inside
 * the budget is a real model turn. What it prevents is the worst case: a stalled
 * request holding the customer's reply for ten or twenty seconds while the
 * fallback engine was ready immediately. The WhatsApp demo is judged on how
 * quickly it answers, so the wait has to be bounded.
 */
const MODEL_BUDGET_MS = 8_000;

/** Reject once `ms` elapse, so one slow provider cannot eat the whole turn. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("model_budget_exceeded")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** "Gurugram" everywhere; the inventory and the panel both use that spelling. */
const normaliseArea = (value: string) => value.replace(/gurgaon/gi, "Gurugram").trim();

/** Localities the inventory actually has, detected in the customer's own words. */
function mentionedLocations(text: string): string[] {
  const normalised = text.replace(/gurgaon/gi, "Gurugram").toLowerCase();
  return getKnownLocations().filter((location) =>
    normalised.includes(location.toLowerCase()),
  );
}

/**
 * Merge the caller's own words into the lead.
 *
 * The deterministic parser runs first because it cannot be talked out of a
 * plain fact: "90 lakh" in a message is ₹90L whether or not the model felt
 * like reporting it. The model then refines what is genuinely contextual.
 */
function localFacts(text: string): ReturnType<typeof extractLeadFields> {
  const facts = extractLeadFields(text);
  const areas = mentionedLocations(text);
  if (areas.length) {
    facts.location = areas[0];
    if (areas.length > 1) facts.preferredLocations = areas;
  }
  return facts;
}

/**
 * "Show me something suitable", "show me anything".
 *
 * Deliberately separate from `asksForProperties`, which needs a noun like
 * "property" or "options". Someone who asks for "something" has asked to see
 * listings just as clearly, and treating that as a no-op is how the assistant
 * ends up mid-conversation while the customer waits for homes.
 */
const asksForOptions = (text: string) =>
  /\b(?:show|see|view|give|send|share|browse)\s+me\b/i.test(text) &&
  /\b(?:something|anything|whatever|suitable|available|matches?|what you have|couple of|a few)\b/i.test(
    text,
  );

const isWrapUp = (text: string) =>
  /\b(?:thanks|thank you|thats all|that.s all|bye|goodbye|done|anything else|what next|whats next|next step)\b/i.test(
    text,
  );

export async function runTurn(input: TurnInput, apiKey: string): Promise<TurnResult> {
  const { text, history } = input;
  let priorLead = safeLead(input.lead);
  const action = detectAction(text);

  if (action === "restart") return { restarted: true } as TurnResult;

  /*
   * Opt-out is handled before anything else and is terminal: the customer asked
   * not to be contacted again, so there is no recap, no question and no CTA. The
   * flag travels with the delivered lead so no follow-up sequence can ignore it.
   */
  if (action === "optOut") {
    const optedOut = recompute({
      ...priorLead,
      optOut: true,
      nextAction: "opted_out",
    });
    const optOutLead = {
      lead: optedOut,
      matches: getPropertiesByIds(optedOut.matchedPropertyIds),
      transcript: asTurns(history),
    };
    recordLead(optOutLead);
    await deliverLead(optOutLead);
    return {
      replies: [
        {
          text: "You're unsubscribed — we won't send you any follow-up messages. Message here any time if you'd like help again.",
        },
      ],
      lead: optedOut,
      offeredPropertyIds: input.offeredPropertyIds,
      sentLinks: input.sentLinks,
    };
  }

  /*
   * End-of-conversation confirmation.
   *
   * Once the read-back is pending, the whole turn belongs to that flow: the
   * customer's reply is a confirmation, a correction, or the name/number we
   * asked for. Handling it here keeps it identical on the model path and the
   * deterministic fallback, and means a correction merges through the ordinary
   * `applyExtraction` path below — so it lands in the admin record too.
   */
  if (priorLead.confirmation) {
    const step = advanceConfirmation(priorLead, text);

    if (step.kind === "final") {
      const finalMatches = getPropertiesByIds(step.lead.matchedPropertyIds);
      const finalLead = recompute(
        { ...step.lead, recapSent: true, confirmation: "done" },
        { keepMatches: true },
      );
      const built = finalRecapMessage(finalLead, finalMatches);
      const links = built.links
        .map((link) => getPropertiesByIds([link.propertyId])[0])
        .filter((property): property is Property => Boolean(property))
        .map((property) => sentLinkFor(property));
      await deliverIfFinished(priorLead, finalLead, history, finalMatches);
      return {
        replies: [{ text: built.text, kind: "recap", links }],
        lead: finalLead,
        offeredPropertyIds: input.offeredPropertyIds,
        sentLinks: Array.from(
          new Map(
            [...input.sentLinks, ...links].map((link) => [link.propertyId, link]),
          ).values(),
        ),
      };
    }

    if (step.kind === "reply") {
      return {
        replies: [{ text: step.text, quickReplies: step.quickReplies }],
        lead: step.lead,
        offeredPropertyIds: input.offeredPropertyIds,
        sentLinks: input.sentLinks,
      };
    }

    if (step.kind === "change") {
      // The customer is correcting something: clear the stage and let the
      // ordinary turn merge their words, which re-reads back on completion.
      priorLead = step.lead;
    }
  }

  let lead = applyExtraction(priorLead, localFacts(text));

  /* ---------------------------------------------------------------------
   * Explicit actions the application completes itself.
   *
   * These are recorded but deliberately do NOT force the closing recap: a
   * summary after every CTA is what made the assistant look like it was looping
   * back. The recap is reserved for a genuine wrap-up.
   * ------------------------------------------------------------------- */

  if (action === "advisor") {
    lead = recompute({
      ...lead,
      advisorRequested: true,
      nextAction: "human_handoff",
    });
  }

  if (action === "callback" && !lead.callbackRequested) {
    lead = recompute({ ...lead, callbackRequested: true, nextAction: "callback" });
  }

  if (action === "siteVisit" && !lead.siteVisit) {
    lead = recompute({
      ...lead,
      siteVisit: visitRequestLabel(text),
      nextAction: "site_visit",
    });
  }

  /*
   * Resume a pending visit-time answer. "Afternoon" is the answer to the
   * question the assistant just asked, so it is recorded here rather than being
   * handed to the model as an unrecognised turn.
   */
  if (isVisitTimePending(priorLead) && !action) {
    const chosen = visitTimeSelection(text);
    if (chosen) {
      lead = recompute(
        { ...withVisitTime(lead, chosen), nextAction: "site_visit" },
        { keepMatches: true },
      );
    }
  }

  if (action === "adjustBudget") {
    // The customer asked to change the budget, so the old figure is obsolete.
    lead = recompute({
      ...lead,
      budget: undefined,
      budgetMin: undefined,
      budgetMax: undefined,
      budgetLabel: undefined,
      matchedPropertyIds: [],
    });
  }

  /* ---------------------------------------------------------------------
   * Search. The application owns this — the model only ever sees the result.
   * ------------------------------------------------------------------- */

  const named = findPropertyByName(text);
  if (named) lead = { ...lead, selectedPropertyId: named.id };

  const before = searchForLead(priorLead);
  const after = searchForLead(lead);

  // Becoming searchable on this turn is itself a reason to show something: the
  // alternative is the assistant acknowledging a complete requirement and then
  // saying nothing about the homes it just matched.
  const becameSearchable = !before.ready && after.ready && after.matches.length > 0;

  if (after.ready) {
    lead = recompute(
      { ...lead, matchedPropertyIds: after.matches.map((property) => property.id) },
      { keepMatches: true },
    );
  }

  const selected = lead.selectedPropertyId
    ? getPropertiesByIds([lead.selectedPropertyId])
    : [];

  /* ---------------------------------------------------------------------
   * The conversational turn.
   * ------------------------------------------------------------------- */

  const inventory = inventoryContext(lead, after.areas, selected.length ? selected : after.matches);
  const askedForMore = action === "moreOptions";

  let reply = "";
  let modelQuickReplies: string[] | undefined;
  let modelNextStep = "continue";
  let modelAvailable = false;

  if (apiKey && !providerCoolingDown()) {
    try {
      const turn = await withDeadline(
        generateTurn(apiKey, text, lead, history, inventory),
        MODEL_BUDGET_MS,
      );
      reply = turn.reply;
      modelQuickReplies = turn.quickReplies;
      modelNextStep = parseNextStep(turn.nextStep);

      const patch = validatedExtraction(turn.extracted, text);
      if (lead.timeline && patch.timeline && patch.timeline !== lead.timeline) {
        // The deterministic parser already read the timeline; the model does not
        // get to overturn it with a vaguer reading of the same sentence.
        delete patch.timeline;
      }
      lead = applyExtraction(lead, patch);
      modelAvailable = true;

      /*
       * The model may decide that a question is outside what it can answer and
       * ask for a hand-off. That becomes a real recorded action here: an advisor
       * receives the whole conversation, and the customer stops being offered
       * options the assistant cannot actually help with.
       */
      if (modelNextStep === "human_handoff" && !lead.advisorRequested) {
        lead = recompute({
          ...lead,
          advisorRequested: true,
          nextAction: "human_handoff",
        });
      }
    } catch (error) {
      /*
       * A failure is expected behaviour on a free tier, not an incident. It is
       * logged once per cooldown window with the reason, and then the breaker
       * keeps this quiet — turning every turn into a stack of provider errors is
       * how a working fallback still looks broken in the logs.
       */
      if (providerStatus() === "cooldown") {
        console.warn(
          "WhatsApp: Gemini unavailable, using the deterministic engine",
          error instanceof Error ? error.message.slice(0, 200) : "unknown error",
        );
      }
    }
  }


  /*
   * When the model is unreachable the whole turn is produced by the
   * deterministic engine instead. It is a genuine state machine over the same
   * lead, the same inventory and the same recap — so the visitor still gets a
   * working conversation, just a less fluent one. Silently degrading to a few
   * canned strings would be a worse demo than an honest fallback.
   */
  if (!modelAvailable) {
    const result = localTurn(input, priorLead);
    await deliverIfFinished(priorLead, result.lead, input.history);
    return result;
  }

  // "Actually Gurgaon also works" is an addition, not a replacement.
  if (priorLead.location && lead.location && lead.location !== priorLead.location && /\b(?:also|too|works|bhi|or)\b/i.test(text)) {
    lead.preferredLocations = Array.from(
      new Set([...priorLead.preferredLocations, priorLead.location, lead.location]),
    );
  }
  if (lead.location) lead.location = normaliseArea(lead.location);
  lead.preferredLocations = Array.from(
    new Set(
      (lead.preferredLocations.length
        ? lead.preferredLocations
        : lead.location
          ? [lead.location]
          : []
      ).map(normaliseArea),
    ),
  );
  if (lead.budget != null) {
    // Preserve a stated range — flattening "₹50L–₹55L" to a single figure made
    // the admin record disagree with what the customer actually said.
    lead.budgetLabel =
      lead.budgetMin != null &&
      lead.budgetMax != null &&
      lead.budgetMin !== lead.budgetMax
        ? formatBudgetRange(lead.budgetMin, lead.budgetMax)
        : formatBudget(lead.budget);
  }

  // Re-run the search: the model's extraction may have opened up or narrowed
  // the requirement, and the links must match what is now on the lead.
  const finalSearch = searchForLead(lead);
  const matches = finalSearch.matches;

  /* ---------------------------------------------------------------------
   * What to put in the message: property cards and real links.
   * ------------------------------------------------------------------- */

  const alreadyShown = input.offeredPropertyIds;
  let replyLinks: SentLink[] = [];
  let replyPropertyIds: string[] = [];
  /** Set when this turn answers with a list of matches instead of prose. */
  let listReply: { text: string; links: SentLink[] } | undefined;

  const sendProperties = (properties: Property[]) => {
    replyPropertyIds = properties.map((property) => property.id);
    replyLinks = properties.map((property) => sentLinkFor(property));
  };

  if (named) {
    // They asked about a specific home by name — that link goes out now.
    sendProperties([named]);
  } else if (action === "propertyDetails" && selected.length) {
    sendProperties(selected);
  } else if (
    becameSearchable ||
    asksForPropertyList(text) ||
    asksForOptions(text) ||
    modelNextStep === "show_properties"
  ) {
    const fresh = matches.filter((property) => !alreadyShown.includes(property.id));
    if (fresh.length) sendProperties(fresh.slice(0, MAX_MATCHES));
    else if (selected.length) sendProperties(selected);
    else if (matches.length) sendProperties(matches.slice(0, MAX_MATCHES));
  } else if (askedForMore) {
    const more = additionalMatchesMessage(matches, alreadyShown);
    if (more) {
      listReply = {
        text: more.text,
        links: more.links
          .map((link) => getPropertiesByIds([link.propertyId])[0])
          .filter((property): property is Property => Boolean(property))
          .map((property) => sentLinkFor(property)),
      };
      replyPropertyIds = more.links.map((link) => link.propertyId);
      replyLinks = listReply.links;
    }
  } else if (action === "broaden") {
    /*
     * Widening the search is a real action with a real result: it reports which
     * of the customer's stated requirements it dropped, so a near miss is never
     * dressed up as a match.
     */
    const widened = broadenSearchFor(lead);
    const built = widened.properties.length
      ? broadenedMessage(widened.properties, widened.relaxed)
      : undefined;
    if (built) {
      listReply = {
        text: built.text,
        links: widened.properties.map((property) => sentLinkFor(property)),
      };
      replyPropertyIds = widened.properties.map((property) => property.id);
      replyLinks = listReply.links;
    } else {
      reply = NO_EXACT_MATCH;
    }
  }

  // Nothing was surfaced by the turn, but they asked about a property and we
  // could not resolve it — say so honestly rather than staying silent.
  if (action === "propertyDetails" && !replyPropertyIds.length && !reply) {
    reply = "I don't have a listing matching that in front of me right now — an advisor can look into it for you.";
  }

  /* ---------------------------------------------------------------------
   * Recap. Sent once, when the conversation has genuinely served its purpose.
   * ------------------------------------------------------------------- */

  /*
   * Completion is a property of the record, not of a turn counter: either an
   * explicit hand-off (advisor or callback), or every core field captured with a
   * real next step agreed (a visit with its time). The moment that is true the
   * closing recap goes out once and the conversation is over — continuing to ask
   * after that is exactly the loop customers complained about.
   */
  const completedThisTurn = isConversationComplete(lead);
  const wrapUp =
    !priorLead.recapSent &&
    !priorLead.confirmation &&
    (completedThisTurn || (lead.status === "Qualified" && isWrapUp(text)));

  /*
   * The requirement is settled. Rather than closing straight away, the customer
   * is shown a read-back of everything collected and asked to confirm it; the
   * name, the contact number and the number read-back follow, and only then is
   * the closing recap sent. The recap replaces this turn's property list rather
   * than following it, so the same homes are never shown twice.
   */
  let review: OutgoingMessage | undefined;
  if (wrapUp) {
    review = {
      text: buildReviewMessage(lead),
      kind: "review",
      quickReplies: REVIEW_REPLIES,
    };
    replyPropertyIds = [];
  }

  const links = Array.from(
    new Map([...replyLinks].map((link) => [link.propertyId, link])).values(),
  );

  /* ---------------------------------------------------------------------
   * Buttons and the returned state.
   * ------------------------------------------------------------------- */

  const offeredPropertyIds = Array.from(new Set([...alreadyShown, ...replyPropertyIds]));
  const sentLinks = Array.from(
    new Map([...input.sentLinks, ...links].map((link) => [link.propertyId, link])).values(),
  );

  /*
   * Once the recap has gone out the conversation is closed, so no buttons are
   * built at all — tapping a property option after a hand-off is what kept the
   * old loop alive. The customer can still type freely, and the assistant
   * answers in one line.
   */
  const quickReplies = priorLead.recapSent
    ? []
    : review
      ? REVIEW_REPLIES
      : reconcileReplies(modelQuickReplies, lead, {
          hasMatches: matches.length > 0 || Boolean(named),
          hasSelectedProperty: Boolean(named) || Boolean(lead.selectedPropertyId),
          finished: wrapUp,
          matchNames: matches.slice(0, 2).map((property) => property.name),
          history: input.history,
        });

  lead = recompute(
    {
      ...lead,
      confirmation: priorLead.confirmation ?? (wrapUp ? "review" : undefined),
      nextAction: nextActionForTurn(lead, modelNextStep, matches.length > 0),
      recapSent: priorLead.recapSent,
    },
    { keepMatches: true },
  );

  /*
   * If a site visit was requested and time is still open, ensure we ask for
   * the time slot (morning / afternoon / evening / weekend) before moving on.
   */
  if (isVisitTimePending(lead) && !review && !listReply) {
    if (!/morning|afternoon|evening|weekend|time|day|slot|कब|समय/i.test(reply)) {
      reply = reply.trim()
        ? `${reply.trim()} What day and time works best for your visit — morning, afternoon, or evening?`
        : "We would be glad to arrange a site visit! What day and time works best for you — morning, afternoon, or evening?";
    }
  }

  /*
   * On the turn the first matches go out, the one core field still open has to
   * be asked too. Otherwise the model, having decided the requirement looked
   * complete enough to search with, simply never asks the timeline — and the
   * customer is shown homes while a question they were owed silently disappears.
   * The question is only appended when the model did not already ask something.
   */
  if (!review && !listReply && !isVisitTimePending(lead) && (becameSearchable || replyPropertyIds.length > 0)) {
    const stillMissing = missingFields(lead);
    if (stillMissing.length && !/\?\s*$/.test(reply.trim())) {
      const question = fieldQuestion[stillMissing[0]];
      reply = reply.trim() ? `${reply.trim()} ${question}` : question;
    }
  }

  /*
   * The model is asked to collect the name, but name is not a core field so it
   * routinely skipped it and every lead reached the admin as "Name: Not shared
   * yet". The application guarantees the ask instead — once per conversation,
   * only on a turn where the assistant is not already asking something else.
   */
  const nameAlreadyAsked = history.some(
    (item) => item.side === "assistant" && /\bname\b|नाम/i.test(item.text),
  );
  const wantsName =
    !lead.name &&
    !nameAlreadyAsked &&
    !review &&
    !lead.confirmation &&
    !isVisitTimePending(lead) &&
    replyPropertyIds.length > 0 &&
    !/\?\s*$/.test(reply.trim());
  if (wantsName) {
    reply = `${reply.trim()} Also, what name should I use for you?`.trim();
  }

  // On a confirmation turn the read-back is the whole message; anything the
  // model said on the way to it is dropped rather than printed above it.
  const replies: OutgoingMessage[] = review
    ? [review]
    : listReply
      ? [{ text: listReply.text, links: listReply.links, quickReplies }]
      : [
          {
            text: reply,
            quickReplies,
            propertyIds: replyPropertyIds,
            links: replyLinks,
          },
        ];

  // Whenever the turn has gathered actionable customer info (phone, name, site visit,
  // callback, advisor request, qualifying location/budget, or high score), ensure the
  // admin console has this lead recorded immediately so it never waits for full completion.
  const hasActionableInfo =
    Boolean(lead.phone) ||
    Boolean(lead.name) ||
    Boolean(lead.siteVisit) ||
    Boolean(lead.callbackRequested) ||
    Boolean(lead.advisorRequested) ||
    lead.status === "Qualified" ||
    lead.score >= 25 ||
    Boolean(lead.confirmation) ||
    Boolean(lead.recapSent) ||
    Boolean(lead.optOut);

  if (hasActionableInfo) {
    const rec = recordLead({
      lead,
      matches: matches.length ? matches : getPropertiesByIds(lead.matchedPropertyIds),
      transcript: asTurns(history),
      optOut: lead.optOut,
    });
    void syncLeadToRelay(rec).catch(() => undefined);
  }

  await deliverIfFinished(priorLead, lead, history, matches);

  return {
    replies,
    lead,
    offeredPropertyIds,
    sentLinks,
  };
}

/**
 * Push a lead to the configured destination on the one turn it becomes worth
 * pushing: the turn it completes (the recap has just gone out) or the turn the
 * customer opts out. Both can only happen once, so nothing is delivered twice.
 *
 * Awaited deliberately — see `lib/leads/delivery` for why a fire-and-forget
 * fetch is lost on a serverless host.
 */
async function deliverIfFinished(
  priorLead: Lead,
  lead: Lead,
  transcript: HistoryItem[],
  matches?: Property[],
) {
  const justCompleted = !priorLead.recapSent && Boolean(lead.recapSent);
  const justOptedOut = !priorLead.optOut && Boolean(lead.optOut);
  if (!justCompleted && !justOptedOut) return;

  const input = {
    lead,
    matches: matches ?? getPropertiesByIds(lead.matchedPropertyIds),
    transcript: asTurns(transcript),
  };
  // Keep the admin's record in step with whatever the destination receives.
  const rec = recordLead(input);
  await Promise.allSettled([
    deliverLead(input),
    syncLeadToRelay(rec),
  ]);
}

/** The chat history in the shape a CRM record expects. */
function asTurns(history: HistoryItem[]) {
  return history.map((item) => ({ role: item.side, text: item.text }));
}

/**
 * What the visit request actually is, as a real date.
 *
 * "Can I visit tomorrow?" has to be stored as a date the sales team can act on,
 * not as the customer's raw words. An unstated time stays explicitly open rather
 * than being invented.
 */
function visitRequestLabel(text: string): string {
  const date = resolveDate(text)?.label;
  const time = resolveTime(text);
  if (date && time) return `${date}, ${time} — requested`;
  if (date) return `${date} — time to confirm`;
  return "Visit requested — time to confirm";
}

/**
 * Human-readable next step, stored on the lead so the admin view can show it.
 *
 * Delegates to the canonical projection so the key written here and the label
 * the admin view renders can never disagree — the WhatsApp path, the phone path
 * and the overview all resolve the same state to the same decision.
 */
function nextActionForTurn(lead: Lead, modelStep: string, hasMatches: boolean): string {
  if (lead.advisorRequested) return "human_handoff";
  if (lead.callbackRequested) return "callback";
  if (lead.siteVisit) return "site_visit";
  if (lead.selectedPropertyId) return "property_question";
  if (modelStep !== "continue" && modelStep !== "show_properties")
    return modelStep;
  return nextActionKey(lead, { hasMatches });
}


/**
 * The turn, produced entirely by the deterministic engine.
 *
 * Used when Gemini is unreachable or out of quota. It runs the same
 * qualification logic, the same inventory search and the same closing recap as
 * the model path, so the demo stays usable — the assistant is just less
 * conversational. Returns the identical shape as a normal turn.
 */
function localTurn(input: TurnInput, priorLead: Lead): TurnResult {
  const state: EngineState = {
    lead: priorLead,
    offeredMatches: input.offeredPropertyIds.length > 0,
    finished: Boolean(priorLead.recapSent),
    offeredPropertyIds: input.offeredPropertyIds,
    sentLinks: input.sentLinks,
  };

  const result = respond(state, input.text);
  // Every assistant message is kept. The engine deliberately splits some turns
  // in two — the matches, then the question about what to do with them — and
  // collapsing that to the last line throws the matches away.
  const outgoing = result.messages.filter((message) => message.side === "assistant");

  const withLinks = (links: SentLink[]): SentLink[] =>
    links
      .map((link) => getPropertiesByIds([link.propertyId])[0])
      .filter((property): property is Property => Boolean(property))
      .map((property) => sentLinkFor(property));

  const replies: OutgoingMessage[] = outgoing.map((message) => ({
    text: message.text,
    quickReplies: message.quickReplies,
    propertyIds: message.kind === "recap" ? undefined : message.propertyIds,
    links: withLinks(message.links ?? []),
    kind: message.kind,
  }));

  const allLinks = replies.flatMap((message) => message.links ?? []);
  const lead = recompute(
    {
      ...result.state.lead,
      recapSent: priorLead.recapSent || Boolean(replies.find((m) => m.kind === "recap")),
      nextAction: localNextAction(result.state.lead),
    },
    { keepMatches: true },
  );

  return {
    replies: replies.length
      ? replies
      : [
          {
            text: "Tell me a little more about what you are looking for and I will help you find it.",
          },
        ],
    lead,
    offeredPropertyIds: result.state.offeredPropertyIds,
    sentLinks: Array.from(
      new Map([...input.sentLinks, ...allLinks].map((link) => [link.propertyId, link])).values(),
    ),
  };
}

/** The next step on the local path, derived from the same canonical state. */
function localNextAction(lead: Lead): string {
  return nextActionKey(lead);
}
