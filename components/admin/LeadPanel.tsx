"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import type { SentLink } from "@/lib/whatsapp/messages";
import { getPropertiesByIds } from "@/lib/properties/search";
import PropertyCard from "@/components/shared/PropertyCard";
import { leadFieldsFor } from "@/lib/leads/view";

const temperatureColor: Record<Lead["temperature"], string> = {
  HOT: "text-[#c6ad78] border-[#c6ad78]",
  WARM: "text-[#e8c34a] border-[#e8c34a]",
  COLD: "text-[#f5f3f0]/50 border-[#2a2a2a]",
};

/**
 * The rows this panel shows are the canonical admin projection.
 *
 * Reading from `lib/leads/view` rather than rebuilding a list here is what
 * keeps the live panel and the end-of-conversation overview in agreement —
 * including the human-readable next action, never its internal key.
 */
export { leadFieldsFor as fieldsFor };

export default function LeadPanel({
  lead,
  sentLinks = [],
  onViewSummary,
  className = "",
}: {
  lead: Lead;
  /** Property links already sent to the customer during the conversation. */
  sentLinks?: SentLink[];
  onViewSummary?: () => void;
  className?: string;
}) {
  const matches = getPropertiesByIds(lead.matchedPropertyIds);

  return (
    <div className={`flex flex-col bg-[#0d0d0d] ${className}`}>
      <div className="flex items-center justify-between gap-4 border-b border-[#1f1f1f] px-6 py-5">
        <div>
          <p className="eyebrow text-[#c6ad78]/70">Live lead</p>
          <p className="type-meta mt-1.5 text-[#f5f3f0]/50">
            What the system has understood so far
          </p>
        </div>
        <span
          className={`flex-shrink-0 border px-3 py-1.5 text-xs font-medium ${temperatureColor[lead.temperature]}`}
        >
          {lead.temperature}
        </span>
      </div>

      <div className="demo-scroll flex-1 overflow-y-auto px-6 py-6 pb-10">
        {/* Score */}
        <div className="mb-7">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="eyebrow text-[#f5f3f0]/40">Lead score</span>
            <span className="type-meta text-[#f5f3f0]">{lead.score}/100</span>
          </div>
          <div className="h-1.5 w-full bg-[#1f1f1f]">
            <motion.div
              className="h-full bg-[#c6ad78]"
              animate={{ width: `${lead.score}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <p className="type-meta mt-3 text-[#f5f3f0]/40">
            Status: {lead.status}
          </p>
        </div>

        {/* Fields — the same canonical rows the admin overview renders */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          {leadFieldsFor(lead).map((field) => (
            <div key={field.label}>
              <p className="eyebrow mb-1.5 text-[#f5f3f0]/35">
                {field.label}
              </p>
              <motion.p
                key={field.value ?? field.placeholder ?? "empty"}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                className={`type-meta ${field.value ? "text-[#f5f3f0]" : "text-[#f5f3f0]/35"}`}
              >
                {field.value || field.placeholder || "—"}
              </motion.p>
            </div>
          ))}
        </div>

        {/* Matches */}
        <div className="mt-8">
          <p className="eyebrow mb-4 text-[#f5f3f0]/40">
            Matched properties {matches.length > 0 && `(${matches.length})`}
          </p>
          {matches.length ? (
            <div className="space-y-3">
              {matches.slice(0, 4).map((property) => (
                <PropertyCard key={property.id} property={property} compact />
              ))}
            </div>
          ) : (
            <p className="type-meta text-[#f5f3f0]/35">
              No matches yet — matches appear once there is enough to search on.
            </p>
          )}
        </div>

        {/* Property links sent — the exact URLs the customer can open. */}
        <div className="mt-8">
          <p className="eyebrow mb-4 text-[#f5f3f0]/40">Property links sent</p>
          {sentLinks.length ? (
            <ul className="space-y-3">
              {sentLinks.map((link) => (
                <li key={link.propertyId} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#25d366]" />
                  <div className="min-w-0">
                    <p className="type-meta text-[#f5f3f0]">{link.name}</p>
                    <a
                      href={link.url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="type-meta wrap-break-word text-[#c6ad78] underline-offset-2 hover:underline"
                    >
                      {link.url || link.propertyId}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-meta text-[#f5f3f0]/35">
              No property links sent yet. Links are recorded here the moment
              they are shared.
            </p>
          )}
        </div>
      </div>

      {onViewSummary && (
        <div className="border-t border-[#1f1f1f] p-6">
          <button
            onClick={onViewSummary}
            className="w-full bg-[#c6ad78] py-4 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f]"
          >
            View lead summary
          </button>
        </div>
      )}
    </div>
  );
}
