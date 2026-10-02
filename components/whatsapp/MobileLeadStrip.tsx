"use client";

import { ChevronUp } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { budgetSummaryText } from "@/lib/leads/format";

const temperatureColor: Record<Lead["temperature"], string> = {
  HOT: "border-[#c6ad78] text-[#c6ad78]",
  WARM: "border-[#e8c34a] text-[#e8c34a]",
  COLD: "border-[#2a2a2a] text-[#f5f3f0]/50",
};

/**
 * A compact summary of what the assistant has understood so far, pinned under the
 * composer on small screens. The full panel is still available as a drawer, but
 * the essentials stay visible while the visitor types.
 */
export default function MobileLeadStrip({
  lead,
  onOpen,
  canOpenSummary,
}: {
  lead: Lead;
  onOpen: () => void;
  canOpenSummary?: boolean;
}) {
  const facts = [
    ["Intent", lead.intent],
    ["Size", lead.bhk],
    [
      "Area",
      lead.preferredLocations.length > 1
        ? lead.preferredLocations.join(" or ")
        : lead.location,
    ],
    ["Budget", budgetSummaryText(lead)],
    ["Timeline", lead.timeline],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return (
    <button
      onClick={onOpen}
      className="w-full border-t border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3.5 text-left transition-colors hover:bg-[#111] lg:hidden"
      aria-label="Open full lead panel"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="eyebrow text-[#f5f3f0]/45">
          Live lead {canOpenSummary ? "· summary ready" : ""}
        </span>
        <span className="flex items-center gap-2.5">
          <span
            className={`border px-2 py-0.5 text-[11px] font-medium ${temperatureColor[lead.temperature]}`}
          >
            {lead.temperature}
          </span>
          <span className="type-meta text-[#f5f3f0]/60">{lead.score}/100</span>
          <ChevronUp className="h-3.5 w-3.5 text-[#f5f3f0]/40" />
        </span>
      </div>

      {facts.length ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {facts.map(([label, value]) => (
            <span key={label} className="type-meta text-[#f5f3f0]/70">
              <span className="text-[#f5f3f0]/35">{label} </span>
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="type-meta text-[#f5f3f0]/40">
          Details appear here as the conversation progresses.
        </p>
      )}
    </button>
  );
}
