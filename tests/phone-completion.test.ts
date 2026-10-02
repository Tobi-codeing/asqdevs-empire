import { describe, expect, it } from "vitest";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { recompute } from "@/lib/leads/update";
import { evaluateCompletion, isGoodbye } from "@/lib/calls/completion";

/** A call whose site visit has actually been booked, timeline never given. */
const booked = (): Lead =>
  recompute({
    ...emptyLead("Phone"),
    intent: "Buy",
    location: "Rohini",
    bhk: "2 BHK",
    budget: 7_500_000,
    budgetLabel: "₹75L",
    siteVisit: "Saturday 3 October, 10:00 AM",
  });

describe("a booked visit ends the call", () => {
  it("completes even though the caller never gave a timeline", () => {
    const result = evaluateCompletion(booked());
    expect(result.complete).toBe(true);
    expect(result.reason).toBe("qualified_with_next_step");
  });

  it("does not complete while the slot is only a request", () => {
    const pending = recompute({
      ...booked(),
      siteVisit: "Saturday 3 October, 10:00 AM — requested, not yet booked",
    });
    expect(evaluateCompletion(pending).complete).toBe(false);
  });

  it("does not complete before the requirement is captured", () => {
    const thin = recompute({
      ...emptyLead("Phone"),
      siteVisit: "Saturday 3 October, 10:00 AM",
    });
    expect(evaluateCompletion(thin).complete).toBe(false);
  });
});

describe("Hindi sign-offs end the call", () => {
  it("recognises a Hindi thank-you or goodbye", () => {
    // The reported bug: the booking was confirmed with "शुक्रिया!" and the call
    // stayed open because that was not read as a sign-off.
    expect(isGoodbye("ठीक है, आपकी साइट विजिट शनिवार, 3 अक्टूबर को फिक्स कर दी गई है। शुक्रिया!")).toBe(
      true,
    );
    expect(isGoodbye("आपका दिन शुभ हो!")).toBe(true);
    expect(isGoodbye("धन्यवाद, फिर मिलेंगे।")).toBe(true);
  });

  it("still recognises the English sign-offs", () => {
    expect(isGoodbye("Thank you for calling Delhi Homes. Goodbye!")).toBe(true);
  });

  it("does not end the call on a mid-conversation thank-you", () => {
    expect(isGoodbye("शुक्रिया, तो आपका बजट कितना है?")).toBe(false);
    expect(isGoodbye("Thanks - and which area are you considering?")).toBe(false);
  });

  it("never treats an ordinary line as a sign-off", () => {
    expect(isGoodbye("रोहिणी में एक 2 BHK अच्छा विकल्प है।")).toBe(false);
  });
});
