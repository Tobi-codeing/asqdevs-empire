export type Intent = "Buy" | "Rent" | "Sell" | "Enquiry";
export type Temperature = "HOT" | "WARM" | "COLD";
export type LeadStatus = "New" | "Qualifying" | "Qualified" | "Handed off";
export type LeadSource = "WhatsApp" | "Phone";

/**
 * THE canonical lead state.
 *
 * One record, written by one merge path (`lib/leads/update.ts`) from one
 * validated vocabulary (`lib/leads/normalise.ts`), and read by one admin
 * projection (`lib/leads/view.ts`). WhatsApp, the phone receptionist, property
 * matching, lead scoring, the AI summary and the next action all resolve against
 * this object and nothing else.
 *
 * There is deliberately no second copy anywhere. A channel may only ever
 * *propose* a partial patch; the application owns the merge, so the admin record
 * cannot disagree with the conversation it came from.
 */
/**
 * Where a conversation is in the end-of-conversation confirmation.
 *
 * The customer is shown a read-back of everything collected and asked whether
 * it is correct, then asked for a name and a contact number, then asked to
 * confirm that number. Only once every step is done is the lead finalised and
 * sent to the business — so the record the admin sees is always the one the
 * customer just agreed to, not a half-heard guess.
 */
export type ConfirmationStage =
  | "review"
  | "name"
  | "phone"
  | "phoneConfirm"
  | "done";

export type Lead = {
  name?: string;
  /** The contact number the customer agreed to be reached on. */
  phone?: string;
  /** Where the confirmation flow currently is, if it has started. */
  confirmation?: ConfirmationStage;
  intent?: Intent;
  /** The single location the customer is looking in. */
  location?: string;
  /** Every area they said would work, including the primary one. */
  preferredLocations: string[];
  propertyType?: string;
  bhk?: string; // canonical form, e.g. "2 BHK"
  budget?: number; // in rupees
  budgetMin?: number; // in rupees
  budgetMax?: number; // in rupees
  budgetFlexible?: boolean;
  budgetLabel?: string;
  timeline?: string;
  preferences: string[];
  matchedPropertyIds: string[];
  /** The one property the caller asked about most recently, if any. */
  selectedPropertyId?: string;
  /** The appointment, as a real resolved label. Never invented. */
  siteVisit?: string;
  /** Times offered instead, when the requested visit slot was unavailable. */
  siteVisitAlternatives?: string[];
  callbackAt?: string;
  callbackRequested?: boolean;
  advisorRequested?: boolean;
  /** Internal key; always rendered through `nextActionLabel`. */
  nextAction?: string;
  /**
   * True once the closing recap has gone out. The conversation can keep
   * qualifying after that, but the customer is only ever shown the summary
   * once — a recap repeated on every later turn is what makes a bot feel like
   * a bot.
   */
  recapSent?: boolean;
  /**
   * The customer asked not to be contacted again ("stop", "unsubscribe").
   * Travels with the delivered lead so no follow-up sequence can ignore it.
   */
  optOut?: boolean;
  score: number;
  temperature: Temperature;
  status: LeadStatus;
  source: LeadSource;
};

/** Alias used where the canonical state is passed between systems. */
export type LeadState = Lead;

export const emptyLead = (source: LeadSource): Lead => ({
  preferredLocations: [],
  preferences: [],
  matchedPropertyIds: [],
  score: 0,
  temperature: "COLD",
  status: "New",
  source,
});


/** The fields the assistant must collect, in the order it asks for them. */
export const CORE_FIELDS = [
  "intent",
  "location",
  "bhk",
  "budget",
  "timeline",
] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

export function missingFields(lead: Lead): CoreField[] {
  return CORE_FIELDS.filter((field) => {
    if (field === "budget")
      return (
        lead.budget == null && lead.budgetMin == null && lead.budgetMax == null
      );
    if (field === "bhk") return !lead.bhk;
    return !lead[field];
  });
}
