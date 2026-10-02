import { describe, expect, it } from "vitest";
import {
  bookingLabel,
  resolveDate,
  resolveTime,
} from "@/lib/ai/dates";
import { checkSlot } from "@/lib/demo/slots";

const FRIDAY = new Date(2026, 9, 2, 10, 0, 0); // Fri 2 Oct 2026

describe("date and time resolution", () => {
  it("resolves relative dates against the real clock", () => {
    const tomorrow = resolveDate("can I visit tomorrow?", FRIDAY);
    expect(tomorrow?.ok).toBe(true);
    expect(tomorrow?.date.getDate()).toBe(3);
    expect(tomorrow?.label).toContain("tomorrow");
  });

  it("treats 'kal' as tomorrow on a booking call", () => {
    const kal = resolveDate("kal subah", FRIDAY);
    expect(kal?.date.getDate()).toBe(3);
  });

  it("resolves spoken times", () => {
    expect(resolveTime("tomorrow at 8 am")).toBe("8:00 AM");
    expect(resolveTime("let's say 8:30 pm")).toBe("8:30 PM");
    expect(resolveTime("evening")).toBe("6:00 PM");
  });

  it("returns nothing when no date was actually stated", () => {
    expect(resolveDate("maybe sometime", FRIDAY)).toBeUndefined();
    expect(resolveTime("whenever works")).toBeUndefined();
  });
});

describe("site-visit slots", () => {
  it("rejects a time outside advisor hours, never silently moving it", () => {
    const early = checkSlot("Saturday 3 October", "8:00 AM");
    expect(early.available).toBe(false);
    expect(early.alternatives.length).toBeGreaterThan(0);
    expect(early.requested).toBe("Saturday 3 October, 8:00 AM");
  });

  it("accepts a slot inside advisor hours", () => {
    expect(checkSlot("Saturday 3 October", "11:00 AM").available).toBe(true);
  });

  it("builds a single booking label", () => {
    expect(bookingLabel("tomorrow", "8:00 AM")).toContain("8:00 AM");
  });
});
