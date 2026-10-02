import { describe, expect, it } from "vitest";
import {
  asksForPropertyList,
  detectAction,
  extractLeadFields,
  parseTimeline,
} from "@/lib/ai/extract";

/**
 * Free-text extraction. The assistant must understand what a customer actually
 * typed — free text, English and Hinglish — not just a tapped button.
 */
describe("extractLeadFields", () => {
  it("captures several facts from one natural sentence", () => {
    const patch = extractLeadFields(
      "Hi, I need a 2bhk in Dwarka around 90 lakh.",
    );
    expect(patch.intent).toBe("Buy");
    expect(patch.bhk).toBe("2 BHK");
    expect(patch.location).toBe("Dwarka");
    expect(patch.budget).toBe(9_000_000);
    expect(patch.budgetLabel).toBe("₹90L");
  });

  it("understands compact and ranged budgets", () => {
    expect(extractLeadFields("90L").budget).toBe(9_000_000);
    expect(extractLeadFields("up to 1 crore").budget).toBe(10_000_000);
    expect(extractLeadFields("up to 1 crore").budgetMax).toBe(10_000_000);

    const range = extractLeadFields("budget 85 to 95 lakh");
    expect(range.budgetMin).toBe(8_500_000);
    expect(range.budgetMax).toBe(9_500_000);
    expect(range.budgetLabel).toBe("₹85L–₹95L");
  });

  it("keeps more than one acceptable location", () => {
    const patch = extractLeadFields("Dwarka or Gurgaon both work");
    expect(patch.preferredLocations).toEqual(
      expect.arrayContaining(["Dwarka", "Gurugram"]),
    );
  });

  it("reads timelines in plain and Hinglish form", () => {
    expect(extractLeadFields("probably next year").timeline).toBe("12 months");
    expect(extractLeadFields("after 6 months").timeline).toBe("6–12 months");
    expect(extractLeadFields("just exploring").timeline).toBe("Just exploring");
    expect(extractLeadFields("as soon as possible").timeline).toBe(
      "Immediately",
    );
  });

  it("accepts a 2BHK when a 3BHK is also fine", () => {
    expect(extractLeadFields("2bhk but 3bhk is also okay").bhk).toBe("2 BHK");
  });

  it("detects an intent to rent", () => {
    expect(extractLeadFields("looking for a 3bhk on rent").intent).toBe("Rent");
  });

  it("never reads a polite 'please' as a lease", () => {
    // `lease` was not word-bounded, so "please" matched it and silently turned
    // a buyer's lead into a rental.
    expect(extractLeadFields("please").intent).toBeUndefined();
    expect(extractLeadFields("show me options please").intent).toBeUndefined();
  });

  it("does not read 'I don't know the area' as a timeline", () => {
    expect(parseTimeline("I don't know the area")).toBeUndefined();
    expect(parseTimeline("not sure about the location yet")).toBeUndefined();
  });

  it("parses timeline buckets directly", () => {
    expect(parseTimeline("1 year")).toBe("12 months");
    expect(parseTimeline("4 months")).toBe("3–6 months");
    expect(parseTimeline("18 months")).toBe("12 months");
  });
});

describe("asksForPropertyList", () => {
  it("recognises the plural phrasings customers actually use", () => {
    expect(asksForPropertyList("show me options")).toBe(true);
    expect(asksForPropertyList("send me the listings")).toBe(true);
    expect(asksForPropertyList("show me 2bhk properties")).toBe(true);
    expect(asksForPropertyList("what do you have")).toBe(true);
  });
});

describe("detectAction", () => {
  it("recognises the actions a customer actually asks for", () => {
    expect(detectAction("can I visit tomorrow?")).toBe("siteVisit");
    expect(detectAction("call me back tomorrow evening")).toBe("callback");
    expect(detectAction("can I talk to an advisor")).toBe("advisor");
    expect(detectAction("broaden the search please")).toBe("broaden");
    expect(detectAction("tell me more about Dwarka Heights")).toBe(
      "propertyDetails",
    );
  });

  it("does not mistake asking to see listings for booking a viewing", () => {
    // "dikhao" = "show me". Matching the bare stem made this register as a
    // site visit, which skipped the rest of the conversation.
    expect(detectAction("haan dikhao kya options hain")).toBeUndefined();
    expect(detectAction("2BHK options dikhao")).toBeUndefined();
    expect(detectAction("show me something suitable")).toBeUndefined();
  });

  it("still recognises a genuine visit request in Hinglish", () => {
    expect(detectAction("ghar dekhne aana hai")).toBe("siteVisit");
    expect(detectAction("kal flat dekhne aa sakta hoon")).toBe("siteVisit");
    expect(detectAction("aap se milna hai")).toBe("siteVisit");
  });
});
