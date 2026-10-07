import { describe, expect, it } from "vitest";
import {
  advanceConfirmation,
  buildReviewMessage,
  extractPhone,
  isAffirmative,
  isCorrection,
  readName,
} from "@/lib/leads/confirmation";
import { formatPhone, normalisePhone } from "@/lib/leads/normalise";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { recompute } from "@/lib/leads/update";
import { runTurn } from "@/lib/whatsapp/turn";

/**
 * The end-of-conversation confirmation is the one place the customer sees the
 * whole record before it reaches the business, so it has to be exercised on its
 * own and through a real turn.
 */

const base = (overrides: Partial<Lead> = {}): Lead =>
  recompute({
    ...emptyLead("WhatsApp"),
    intent: "Buy",
    location: "Rohini",
    bhk: "2 BHK",
    budget: 9_000_000,
    budgetLabel: "₹90L",
    timeline: "3–6 months",
    siteVisit: "Saturday 3 October, 10:00 AM",
    ...overrides,
  });

describe("phone numbers", () => {
  it("accepts the forms people actually say", () => {
    expect(normalisePhone("9876543210")).toBe("9876543210");
    expect(normalisePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalisePhone("09876543210")).toBe("9876543210");
    expect(normalisePhone("98765-43210")).toBe("9876543210");
    // 9-digit spoken number (e.g. STT swallowed a digit or user spoke 9 digits)
    expect(normalisePhone("748586309")).toBe("748586309");
    expect(normalisePhone("+91 748586309")).toBe("748586309");
    // A landline, a short number or a garbled string is not a mobile.
    expect(normalisePhone("011 2345 6789")).toBeUndefined();
    expect(normalisePhone("12345")).toBeUndefined();
    expect(normalisePhone("")).toBeUndefined();
    // Devanagari numerals
    expect(normalisePhone("७४८५८२६३०९")).toBe("7485826309");
  });

  it("reads a number out of a sentence", () => {
    expect(extractPhone("you can reach me on 98 76 54 32 10")).toBe("9876543210");
    expect(extractPhone("mera number 9876543210 hai")).toBe("9876543210");
    expect(extractPhone("748586309")).toBe("748586309");
    expect(extractPhone("Ashhu 7485826309 2 bhk in dwarka 90L")).toBe("7485826309");
    expect(extractPhone("mera number 7485826309 hai kal 2 baje call karna")).toBe("7485826309");
    expect(extractPhone("७४८५८२६३०९")).toBe("7485826309");
    expect(extractPhone("मेरा नंबर ७४८५८२६३०९ है")).toBe("7485826309");
    expect(extractPhone("सात चार आठ पांच आठ दो छह तीन शून्य नौ")).toBe("7485826309");
    expect(
      extractPhone(
        "तो आशीष जी, रोहिणी एन्क्लेव में 2 BHK अपार्टमेंट के लिए बुधवार 7 अक्टूबर सुबह 10 बजे की विजिट और आपका मोबाइल नंबर 748586309 — क्या यह सब सही है?",
      ),
    ).toBe("748586309");
    expect(extractPhone("my budget is 50 lakh")).toBeUndefined();
  });

  it("reads a number back in a human way", () => {
    expect(formatPhone("9876543210")).toBe("98765 43210");
    expect(formatPhone("748586309")).toBe("74858 6309");
  });
});

describe("yes and correction", () => {
  it("reads a clean confirmation", () => {
    expect(isAffirmative("Yes")).toBe(true);
    expect(isAffirmative("yes, that's correct")).toBe(true);
    expect(isAffirmative("sahi hai")).toBe(true);
    expect(isAffirmative("हां")).toBe(true);
    expect(isAffirmative("A")).toBe(true);
    expect(isAffirmative("a")).toBe(true);
    expect(isAffirmative("सही है")).toBe(true);
    expect(isAffirmative("सब सही है")).toBe(true);
    expect(isAffirmative("Call on this number")).toBe(false);
  });

  it("does not read 'that's correct' as a request to change", () => {
    expect(isCorrection("yes, that's correct")).toBe(false);
    expect(isCorrection("Change something")).toBe(true);
    expect(isCorrection("budget galat hai")).toBe(true);
    expect(isCorrection("no, change the area")).toBe(true);
  });
});

describe("advanceConfirmation", () => {
  it("walks review → name → phone → phoneConfirm → final", () => {
    let lead = base({ confirmation: "review" });

    let step = advanceConfirmation(lead, "Yes, that's correct");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.confirmation).toBe("name");
    lead = step.lead;

    step = advanceConfirmation(lead, "Rahul");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.name).toBe("Rahul");
    expect(step.lead.confirmation).toBe("phone");
    lead = step.lead;

    step = advanceConfirmation(lead, "9876543210");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.phone).toBe("9876543210");
    expect(step.lead.confirmation).toBe("phoneConfirm");
    expect(step.text).toMatch(/98765 43210/);
    lead = step.lead;

    step = advanceConfirmation(lead, "Call on this number");
    expect(step.kind).toBe("final");
    if (step.kind !== "final") throw new Error("expected final");
    expect(step.lead.confirmation).toBe("done");
  });

  it("lets the caller change the number before finishing", () => {
    let lead = base({ name: "Rahul", phone: "9876543210", confirmation: "phoneConfirm" });

    let step = advanceConfirmation(lead, "Change number");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.confirmation).toBe("phone");
    lead = step.lead;

    step = advanceConfirmation(lead, "9123456780");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.phone).toBe("9123456780");
  });

  it("handles name and phone given in one single message", () => {
    let lead = base({ confirmation: "name" });
    let step = advanceConfirmation(lead, "Ashhu 7485826309");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.lead.name).toBe("Ashhu");
    expect(step.lead.phone).toBe("7485826309");
    expect(step.lead.confirmation).toBe("phoneConfirm");
  });

  it("preserves phone when caller says a general negative in phoneConfirm", () => {
    let lead = base({ name: "Ashhu", phone: "7485826309", confirmation: "phoneConfirm" });
    let step = advanceConfirmation(lead, "nahi kal call karna");
    // Does NOT wipe phone
    expect(step.kind).not.toBe("none");
    if (step.kind !== "none") {
      expect(step.lead.phone).toBe("7485826309");
    }
  });

  it("hands a correction back to the ordinary turn", () => {
    const step = advanceConfirmation(base({ confirmation: "review" }), "my budget is 80 lakh");
    expect(step.kind).toBe("change");
    if (step.kind !== "change") throw new Error("expected change");
    expect(step.lead.confirmation).toBeUndefined();
  });

  it("asks what to change when the reply carries no new fact", () => {
    const step = advanceConfirmation(base({ confirmation: "review" }), "Change something");
    expect(step.kind).toBe("reply");
    if (step.kind !== "reply") throw new Error("expected reply");
    expect(step.text).toMatch(/tell me what to change/i);
    // Still in review, so their next message is read as the correction.
    expect(step.lead.confirmation).toBe("review");
  });
});

describe("readName", () => {
  it("reads a bare name and a stated one", () => {
    expect(readName("Rahul")).toBe("Rahul");
    expect(readName("my name is Priya")).toBe("Priya");
    expect(readName("मेरा नाम आशीष है")).toBe("आशीष");
  });

  it("does not mistake an acknowledgement or transcript noise for a name", () => {
    expect(readName("yes")).toBeUndefined();
    expect(readName("ok thanks")).toBeUndefined();
    // Short function words a phone transcript constantly produces.
    expect(readName("is")).toBeUndefined();
    expect(readName("A")).toBeUndefined();
    expect(readName("un")).toBeUndefined();
    // Languages chosen at the start of call are NEVER names:
    expect(readName("हिंदी")).toBeUndefined();
    expect(readName("Hindi")).toBeUndefined();
    expect(readName("English")).toBeUndefined();
    expect(readName("अंग्रेजी")).toBeUndefined();
    expect(readName("Rohini")).toBeUndefined();
  });
});

describe("review read-back", () => {
  it("states every fact on the record", () => {
    const text = buildReviewMessage(base({ name: "Rahul", phone: "9876543210" }));
    expect(text).toMatch(/Rohini/);
    expect(text).toMatch(/2 BHK/);
    expect(text).toMatch(/₹90L/);
    expect(text).toMatch(/within 3/);
    expect(text).toMatch(/Rahul/);
    expect(text).toMatch(/98765 43210/);
  });
});

type Turn = { side: "user" | "assistant"; text: string };
type Run = { lead: Lead; history: Turn[] };

describe("WhatsApp confirmation turn", () => {
  async function step(run: Run, text: string) {
    const res = await runTurn(
      {
        text,
        lead: run.lead,
        history: run.history,
        offeredPropertyIds: [],
        sentLinks: [],
      },
      "",
    );
    return {
      lead: res.lead,
      replies: res.replies,
      history: [
        ...run.history,
        { side: "user" as const, text },
        ...res.replies.map((r) => ({ side: "assistant" as const, text: r.text })),
      ] satisfies Turn[],
    };
  }

  it("propagates a correction and re-reads it back", async () => {
    let run: Run = { lead: base(), history: [] };

    // Completing the requirement produces the read-back.
    const first = await step(run, "Actually schedule the visit for Saturday 3 October at 10am");
    expect(first.lead.confirmation).toBe("review");
    const text = first.replies.map((r) => r.text).join("\n");
    expect(text).toMatch(/₹90L/);
    run = { lead: first.lead, history: first.history };

    // The customer changes the budget; the new figure must reach the read-back.
    const corrected = await step(run, "my budget is 80 lakh now");
    expect(corrected.lead.budget).toBe(8_000_000);
    expect(corrected.lead.confirmation).toBe("review");
    expect(corrected.replies.map((r) => r.text).join("\n")).toMatch(/₹80L/);

    run = { lead: corrected.lead, history: corrected.history };

    // Confirm, name, number, confirm the number → recap.
    for (const message of [
      "Yes, that's correct",
      "Rahul",
      "9876543210",
      "Call on this number",
    ]) {
      const next = await step(run, message);
      run = { lead: next.lead, history: next.history };
    }

    expect(run.lead.name).toBe("Rahul");
    expect(run.lead.phone).toBe("9876543210");
    expect(run.lead.recapSent).toBe(true);
  });
});
