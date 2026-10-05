import { describe, expect, it } from "vitest";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { recompute } from "@/lib/leads/update";
import { applyToolResult } from "@/lib/demo/phone-lead";
import { patchFromUtterance, reconcilePatch } from "@/lib/calls/transcript";
import { PROPERTIES } from "@/lib/data/properties";
import {
  applyConfirmationReply,
  confirmationPrompt,
  evaluateCompletion,
  isGoodbye,
  needsConfirmation,
} from "@/lib/calls/completion";

const property = (id: string) => {
  const found = PROPERTIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown property ${id}`);
  return found;
};

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

describe("the call is not over until the caller confirms", () => {
  it("asks for the name first, then the number, then the read-back", () => {
    const lead = booked();
    expect(needsConfirmation(lead)).toBe(true);
    expect(confirmationPrompt(lead)).toMatch(/name/i);

    const named: Lead = { ...lead, name: "Rahul" };
    expect(confirmationPrompt(named)).toMatch(/contact number/i);

    const numbered: Lead = { ...named, phone: "9876543210" };
    const prompt = confirmationPrompt(numbered);
    expect(prompt).toMatch(/read the whole requirement back/i);

    const done: Lead = { ...numbered, confirmation: "done" };
    expect(needsConfirmation(done)).toBe(false);
  });
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

describe("phone tool results keep the record internally consistent", () => {
  it("keeps matches already found when a later search finds nothing", () => {
    // The reported bug: the admin showed "Selected property: Rohini Enclave"
    // next to "No matching listings" because an empty search overwrote the
    // matched list that getPropertyDetails had populated.
    const searched = applyToolResult(
      emptyLead("Phone"),
      "searchProperties",
      {},
      { ok: true, properties: [property("rohini-enclave")] },
    );
    expect(searched.matchedPropertyIds).toEqual(["rohini-enclave"]);

    const afterEmpty = applyToolResult(
      searched,
      "searchProperties",
      {},
      { ok: true, properties: [] },
    );
    expect(afterEmpty.matchedPropertyIds).toEqual(["rohini-enclave"]);
  });

  it("carries spoken Hindi amenities from the transcript into the lead", () => {
    const patch = patchFromUtterance("आसपास जिम हो, स्कूल वगैरह हो") ?? {};
    const next = reconcilePatch(emptyLead("Phone"), patch);
    expect(next.preferences).toEqual(
      expect.arrayContaining(["Gym", "Near school"]),
    );
  });

  it("names a property the caller asked about and keeps it matched", () => {
    const discussed = applyToolResult(
      emptyLead("Phone"),
      "getPropertyDetails",
      { id: "rohini-enclave" },
      { ok: true, property: property("rohini-enclave") },
    );
    expect(discussed.selectedPropertyId).toBe("rohini-enclave");
    expect(discussed.matchedPropertyIds).toContain("rohini-enclave");
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
    expect(isGoodbye("शुक्रिया! आपका दिन शुभ हो।")).toBe(true);
    expect(isGoodbye("शुक्रिया आशीष जी, दिल्ली होम्स में संपर्क करने के लिए धन्यवाद। आपका दिन शुभ हो!")).toBe(true);
    expect(isGoodbye("शुक्रिया पास्सो जी, दिल्ली होम्स में संपर्क करने के लिए धन्यवाद। आपका दिन शुभ हो!")).toBe(true);
    expect(isGoodbye("दिल्ली होम्स में कॉल करने के लिए धन्यवाद!")).toBe(true);
    expect(isGoodbye("धन्यवाद, फिर मिलेंगे।")).toBe(true);
    expect(isGoodbye("आपका दिन अच्छा रहे!")).toBe(true);
    expect(isGoodbye("बहुत-बहुत धन्यवाद!")).toBe(true);
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

describe("the closing read-back confirms the record and applies any change", () => {
  const ready = (): Lead => ({
    ...booked(),
    name: "Rahul",
    phone: "9876543210",
  });

  it("finalises only on a clean agreement", () => {
    const decision = applyConfirmationReply(
      ready(),
      "confirm",
      "Yes, that's correct",
    );
    expect(decision.kind).toBe("advance");
    if (decision.kind !== "advance") return;
    expect(decision.lead.confirmation).toBe("done");
    expect(needsConfirmation(decision.lead)).toBe(false);
  });

  it("updates the budget and asks again when the caller changes it", () => {
    // The reported gap: a caller who corrects a detail at the end must have
    // that correction land in the record and must hear the updated record back,
    // not close on the version they just rejected.
    const decision = applyConfirmationReply(
      ready(),
      "confirm",
      "No, make the budget 90 lakh",
    );
    expect(decision.kind).toBe("reread");
    if (decision.kind !== "reread") return;
    expect(decision.lead.budget).toBe(9_000_000);
    expect(decision.lead.confirmation).not.toBe("done");
  });

  it("treats 'yes but change x' as a change, not as consent", () => {
    const decision = applyConfirmationReply(
      ready(),
      "confirm",
      "Yes but the budget should be 1 crore",
    );
    expect(decision.kind).toBe("reread");
    if (decision.kind !== "reread") return;
    expect(decision.lead.budget).toBe(10_000_000);
    expect(decision.lead.confirmation).not.toBe("done");
  });

  it("reads a corrected number without ending the call", () => {
    const decision = applyConfirmationReply(
      ready(),
      "confirm",
      "Please change the number to 9812345678",
    );
    expect(decision.kind).toBe("reread");
    if (decision.kind !== "reread") return;
    expect(decision.lead.phone).toBe("9812345678");
    expect(decision.lead.confirmation).not.toBe("done");
  });

  it("takes the name and the number at their own steps", () => {
    const named = applyConfirmationReply(booked(), "name", "Anita");
    expect(named.kind).toBe("advance");
    if (named.kind !== "advance") return;
    expect(named.lead.name).toBe("Anita");

    const numbered = applyConfirmationReply(
      named.lead,
      "phone",
      "98765 43210",
    );
    expect(numbered.kind).toBe("advance");
    if (numbered.kind !== "advance") return;
    expect(numbered.lead.phone).toBe("9876543210");
  });

  it("does not treat a stray acknowledgement as consent", () => {
    const decision = applyConfirmationReply(ready(), "confirm", "uh huh");
    expect(decision.kind).toBe("none");
  });
});
