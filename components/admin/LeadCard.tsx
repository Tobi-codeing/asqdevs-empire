"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, CalendarDays, Check, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Lead } from "@/lib/leads/types";
import type { Property } from "@/lib/data/properties";
import type { SentLink } from "@/lib/whatsapp/messages";
import { leadFieldsFor, nextActionLabel } from "@/lib/leads/view";
import PropertyCard from "@/components/shared/PropertyCard";

type Action = { label: string; primary?: boolean; onClick?: () => void };

export default function LeadCard({
  heading,
  lead,
  matches,
  sentLinks = [],
  summary,
  onClose,
  actions = [],
  children,
}: {
  heading: string;
  lead: Lead;
  matches: Property[];
  /** The exact links sent to the customer during the conversation. */
  sentLinks?: SentLink[];
  summary: string;
  onClose: () => void;
  actions?: Action[];
  children?: ReactNode;
}) {
  /*
   * The overview renders the canonical admin projection, not its own list.
   * This is what guarantees it cannot disagree with the live panel beside the
   * conversation: both read `lib/leads/view`, including the human-readable next
   * action (never the raw internal key).
   */
  const fields = leadFieldsFor(lead);
  const nextAction = nextActionLabel(lead);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-0 sm:items-center sm:p-6 lg:p-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-dialog-heading"
        className="demo-scroll flex max-h-none min-h-full w-full max-w-6xl flex-col overflow-y-auto border-0 border-[#d9d6cc] bg-[#f2f0e9] text-[#171812] shadow-[0_28px_100px_rgba(0,0,0,0.5)] sm:max-h-[92dvh] sm:min-h-0 sm:border"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#d9d6cc] bg-[#f2f0e9] px-5 py-4 sm:px-8 sm:py-5">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5 text-[#68695d]">
              ASQDEVS · LEAD INBOX
            </p>
            <h3
              id="lead-dialog-heading"
              className="text-xl font-medium sm:text-2xl"
            >
              {heading}
            </h3>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close lead overview"
            className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#cfccc1] text-[#43443a] transition-colors hover:border-[#59621a] hover:bg-[#e8e6dc] focus-visible:outline-[#59621a]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 shrink-0 lg:grid-cols-[1.35fr_0.85fr]">
          <section className="min-w-0 p-5 sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 border border-[#c7c4b9] px-3 py-2 text-sm text-[#55564b]">
                <span className="h-2 w-2 rounded-full bg-[#64721b]" />
                {lead.source} lead
              </span>
              {lead.temperature === "HOT" && (
                <span className="border border-[#a94f34]/40 bg-[#a94f34]/8 px-3 py-2 text-sm font-semibold text-[#9b422a]">
                  HOT LEAD
                </span>
              )}
              <span className="border border-[#c7c4b9] px-3 py-2 text-sm text-[#55564b]">
                {lead.status}
              </span>
            </div>

            <div className="mb-8 border-b border-[#d9d6cc] pb-8">
              <p className="eyebrow mb-2 text-[#747569]">Lead overview</p>
              <div className="flex flex-wrap items-end justify-between gap-5">
                <h4 className="font-serif text-4xl italic leading-tight sm:text-5xl">
                  {lead.name || "New enquiry"}
                </h4>
                <div className="flex items-baseline gap-2 text-[#465116]">
                  <span className="text-4xl font-medium tabular-nums">
                    {lead.score}
                  </span>
                  <span className="text-sm text-[#747569]">/ 100 lead score</span>
                </div>
              </div>
            </div>

            <div>
              <h5 className="eyebrow mb-5 text-[#747569]">
                Customer requirements
              </h5>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 sm:gap-x-8">
                {fields.map((field) => (
                  <div key={field.label}>
                    <dt className="eyebrow mb-2 text-[#747569]">
                      {field.label}
                    </dt>
                    <dd
                      className={`wrap-break-word text-base font-medium sm:text-lg ${
                        field.value ? "text-[#202119]" : "text-[#747569]"
                      }`}
                    >
                      {field.value || field.placeholder || "Not shared yet"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="mt-9 border-t border-[#d9d6cc] pt-7">
              <h5 className="eyebrow mb-4 text-[#747569]">
                Matched properties {matches.length ? `(${matches.length})` : ""}
              </h5>
              {matches.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {matches.slice(0, 4).map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      compact
                    />
                  ))}
                </div>
              ) : (
                <p className="text-base text-[#747569]">
                  No matching listings in the demo inventory yet.
                </p>
              )}
            </div>

            {/* The exact links the customer received — what sales must be able to
                honour if they open the same listing on the call. */}
            <div className="mt-9 border-t border-[#d9d6cc] pt-7">
              <h5 className="eyebrow mb-4 text-[#747569]">Property links sent</h5>
              {sentLinks.length ? (
                <ul className="space-y-2.5">
                  {sentLinks.map((link) => (
                    <li key={link.propertyId} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#59621a]" />
                      <div className="min-w-0">
                        <p className="text-base font-medium text-[#202119]">
                          {link.name}
                        </p>
                        <a
                          href={link.url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="wrap-break-word text-sm text-[#59621a] underline-offset-2 hover:underline"
                        >
                          {link.url || link.propertyId}
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-[#747569]">
                  No property links were sent in this conversation.
                </p>
              )}
            </div>
          </section>

          <aside className="border-t border-[#d9d6cc] bg-[#e9e7df] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-9">
            <div className="mb-8">
              <h5 className="eyebrow mb-4 text-[#59621a]">AI summary</h5>
              <p className="text-lg leading-relaxed text-[#34352b]">
                {summary}
              </p>
            </div>

            <div className="border-t border-[#cfccc1] py-7">
              <h5 className="eyebrow mb-3 text-[#747569]">
                Recommended next action
              </h5>
              <p className="text-xl font-medium leading-snug text-[#202119]">
                {nextAction}
              </p>
              <div className="mt-6 flex items-start gap-3 text-sm text-[#67685e]">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-[#59621a]" />
                <span>
                  Offer two available site-visit slots and confirm the preferred
                  time.
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[#cfccc1] pt-7">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick ?? onClose}
                  className={
                    action.primary
                      ? "flex min-h-12 items-center justify-center gap-2 bg-[#59621a] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#465016]"
                      : "flex min-h-12 items-center justify-center gap-2 border border-[#c5c2b7] px-5 py-3 text-sm text-[#34352b] transition-colors hover:border-[#7a842b] hover:bg-[#deddd3]"
                  }
                >
                  {action.primary && <Check className="h-4 w-4" />}
                  {action.label}
                  {!action.primary && <ArrowUpRight className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </aside>
        </div>

        {children && (
          <div className="border-t border-[#d9d6cc] px-5 py-6 sm:px-8 lg:px-10">
            {children}
          </div>
        )}
      </motion.div>
    </div>
  );
}
