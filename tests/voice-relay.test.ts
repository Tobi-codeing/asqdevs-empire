import { describe, expect, it } from "vitest";
import { createTicket, verifyTicket } from "../relay.mjs";
import { resolveSocketUrl } from "@/lib/gemini/live-session";
import {
  buildStateMessage,
  hasSettledCore,
  stateMessageIfChanged,
} from "@/lib/calls/completion";
import { emptyLead, type Lead } from "@/lib/leads/types";

const leadWith = (patch: Partial<Lead>): Lead => ({
  ...emptyLead("Phone"),
  ...patch,
});

describe("voice relay tickets", () => {
  it("round-trips a ticket signed with the same secret", () => {
    const secret = "test-secret";
    const { ticket, expiresAt } = createTicket(secret, 60_000);
    expect(verifyTicket(secret, ticket)).toBe(true);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a ticket signed with a different secret", () => {
    const { ticket } = createTicket("secret-a");
    expect(verifyTicket("secret-b", ticket)).toBe(false);
  });

  it("rejects tampered, expired and malformed tickets", () => {
    const secret = "test-secret";
    const { ticket } = createTicket(secret);
    const tampered = `${ticket.split(".")[0]}.deadbeef`;
    expect(verifyTicket(secret, tampered)).toBe(false);
    expect(verifyTicket(secret, createTicket(secret, -1_000).ticket)).toBe(false);
    expect(verifyTicket(secret, "")).toBe(false);
    expect(verifyTicket(secret, "no-dot")).toBe(false);
  });
});

describe("relay socket url", () => {
  it("uses the page origin when no relay is configured", () => {
    expect(
      resolveSocketUrl(
        { path: "/api/gemini/live", ticket: "abc" },
        { protocol: "https:", host: "asqdevs-empire.vercel.app" },
      ),
    ).toBe("wss://asqdevs-empire.vercel.app/api/gemini/live?ticket=abc");
  });

  it("points at the standalone relay when one is configured", () => {
    expect(
      resolveSocketUrl(
        {
          path: "/api/gemini/live",
          ticket: "abc",
          relayUrl: "https://relay.example.com/",
        },
        { protocol: "https:", host: "asqdevs-empire.vercel.app" },
      ),
    ).toBe("wss://relay.example.com/api/gemini/live?ticket=abc");
  });

  it("uses ws for a plain-http page and http relay", () => {
    expect(
      resolveSocketUrl(
        {
          path: "/api/gemini/live",
          ticket: "t",
          relayUrl: "http://localhost:8080",
        },
        { protocol: "http:", host: "localhost:3000" },
      ),
    ).toBe("ws://localhost:8080/api/gemini/live?ticket=t");
  });
});

describe("lead-state injection", () => {
  const today = "Friday 2 October 2026";

  it("marks settled fields as settled and names the next missing one", () => {
    const message = buildStateMessage(
      leadWith({ intent: "Buy", location: "Dwarka" }),
      today,
    );
    expect(message).toContain("Buy (settled");
    expect(message).toContain("Dwarka (settled");
    expect(message).toMatch(/next thing you still need is/i);
    expect(message).toMatch(/never.*ask.*again/i);
  });

  it("does not inject until at least one core field is known", () => {
    expect(hasSettledCore(emptyLead("Phone"))).toBe(false);
    expect(hasSettledCore(leadWith({ intent: "Buy" }))).toBe(true);
  });

  it("returns undefined when the state is unchanged", () => {
    const lead = leadWith({ intent: "Buy", location: "Dwarka" });
    const first = stateMessageIfChanged(lead, today, "");
    expect(first).toBeTruthy();
    expect(stateMessageIfChanged(lead, today, first as string)).toBeUndefined();
    expect(
      stateMessageIfChanged(
        leadWith({ ...lead, bhk: "2 BHK" }),
        today,
        first as string,
      ),
    ).toBeTruthy();
  });
});
