"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Lock, PanelRight, RotateCcw, Search, X } from "lucide-react";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import MobileLeadStrip from "./MobileLeadStrip";
import LeadPanel from "@/components/admin/LeadPanel";
import LeadCard from "@/components/admin/LeadCard";
import {
  assistant,
  customer,
  createEngineState,
  openingMessages,
  shouldShowLead,
  type ChatMessage,
  type EngineState,
} from "@/lib/whatsapp/engine";
import { getPropertiesByIds } from "@/lib/properties/search";
import { buildSummary } from "@/lib/ai/summarize";
import { propertyLinkMessage, type SentLink } from "@/lib/whatsapp/messages";
import { demoCompany, type Property } from "@/lib/data";
import { detectAction } from "@/lib/ai/extract";
import type { Lead } from "@/lib/leads/types";

/** Merge newly-sent links into the running record, deduped by property id. */
function mergeLinks(existing: SentLink[], incoming: SentLink[]) {
  const byId = new Map(existing.map((link) => [link.propertyId, link]));
  for (const link of incoming) byId.set(link.propertyId, link);
  return Array.from(byId.values());
}

type TurnResponse = {
  restarted?: boolean;
  replies: {
    text: string;
    quickReplies?: string[];
    propertyIds?: string[];
    links?: SentLink[];
    kind?: "recap";
  }[];
  lead: Lead;
  offeredPropertyIds: string[];
  sentLinks: SentLink[];
};

/**
 * The WhatsApp section is the centrepiece of the site, so it renders inline at
 * application scale rather than as a small preview.
 *
 * It opens with nothing but an online business header and a composer — the
 * visitor writes the first message. Everything after that is real: the visitor
 * types free text, the engine extracts from it, and the lead panel fills in.
 */
export default function WhatsAppWorkbench() {
  const [state, setState] = useState<EngineState>(() =>
    createEngineState("WhatsApp"),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    openingMessages(),
  );
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [retryText, setRetryText] = useState<string>();

  const stateRef = useRef(state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  // Lock body scroll while the admin overlay is open.
  useEffect(() => {
    if (showLead) document.body.classList.add("scroll-locked");
    else document.body.classList.remove("scroll-locked");
    return () => document.body.classList.remove("scroll-locked");
  }, [showLead]);

  /**
   * A customer message is "read" once the assistant has answered it — which is
   * what the ticks mean in WhatsApp. Deriving it from the message order means
   * the state can never drift out of sync with the transcript.
   */
  const readUpTo = useMemo(() => {
    const lastAssistant = messages.reduce(
      (index, message, position) => (message.side === "assistant" ? position : index),
      -1,
    );
    return lastAssistant;
  }, [messages]);

  const send = async (text: string) => {
    if (pending || !text.trim()) return;
    const retrying =
      text.trim().toLowerCase() === "retry" && Boolean(retryText);
    const userText = retrying ? retryText! : text.trim();
    if (detectAction(userText) === "restart") {
      restart();
      return;
    }
    setPending(true);
    setRetryText(undefined);
    if (!retrying) setMessages((prev) => [...prev, customer(userText)]);
    setTyping(true);

    try {
      const currentState = stateRef.current;
      const response = await fetch("/api/whatsapp/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userText,
          lead: currentState.lead,
          history: messages.slice(-16).map(({ side, text: messageText }) => ({
            side,
            text: messageText,
          })),
          offeredPropertyIds: currentState.offeredPropertyIds,
          sentLinks: currentState.sentLinks,
        }),
      });
      if (!response.ok) throw new Error("chat_request_failed");
      const data = (await response.json()) as TurnResponse;

      if (data.restarted) {
        restart();
        return;
      }
      if (!data.replies?.length || !data.lead) throw new Error("invalid_chat_response");

      const nextState: EngineState = {
        ...currentState,
        lead: data.lead,
        offeredMatches:
          currentState.offeredMatches ||
          data.replies.some((message) => message.propertyIds?.length),
        offeredPropertyIds:
          data.offeredPropertyIds ?? currentState.offeredPropertyIds,
        sentLinks: mergeLinks(currentState.sentLinks, data.sentLinks ?? []),
      };
      stateRef.current = nextState;
      setState(nextState);

      setMessages((prev) => [
        ...prev,
        ...data.replies.map((message) =>
          assistant(message.text, {
            quickReplies: message.quickReplies,
            propertyIds: message.propertyIds,
            links: message.links,
            kind: message.kind,
          }),
        ),
      ]);
      setTyping(false);
      setPending(false);

      if (shouldShowLead(nextState) && !autoOpened.current) {
        autoOpened.current = true;
        setTimeout(() => setShowLead(true), 900);
      }
    } catch {
      setTyping(false);
      setPending(false);
      setRetryText(userText);
      setMessages((prev) => [
        ...prev,
        assistant("I'm having trouble responding right now. Please try again.", {
          quickReplies: ["Retry"],
        }),
      ]);
    }
  };

  // "View property" inside the chat sends the real detail link, exactly as the
  // assistant would, and records it against the lead.
  const viewProperty = (property: Property) => {
    // The link is already absolute on the canonical domain (`lib/site`), so the
    // panel and the assistant send the exact same URL instead of whatever host
    // the browser happens to be on.
    const { link, text } = propertyLinkMessage(property);
    setState((prev) => ({
      ...prev,
      lead: { ...prev.lead, selectedPropertyId: property.id },
      offeredPropertyIds: Array.from(
        new Set([...prev.offeredPropertyIds, property.id]),
      ),
      sentLinks: mergeLinks(prev.sentLinks, [link]),
    }));
    setMessages((prev) => [
      ...prev,
      assistant(text, {
        links: [link],
        quickReplies: [
          "Property details",
          "Amenities",
          "Location",
          "Book a site visit",
        ],
      }),
    ]);
  };

  const restart = () => {
    const fresh = createEngineState("WhatsApp");
    stateRef.current = fresh;
    autoOpened.current = false;
    setState(fresh);
    setMessages(openingMessages());
    setShowLead(false);
    setPending(false);
    setTyping(false);
    setRetryText(undefined);
  };

  const matches = getPropertiesByIds(state.lead.matchedPropertyIds);
  const isEmpty = messages.length === 0 && !typing;

  return (
    <>
      <div className="overflow-hidden border border-[#1f1f1f] bg-[#0c0c0c]">
        {/* Window chrome — reads as a real WhatsApp application */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1a1a1a] px-5 py-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#25d366] text-sm font-bold text-white">
              {demoCompany.initials}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium">
                <span className="truncate">{demoCompany.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-normal text-[#25d366]">
                  <span className="soft-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#25d366]" />
                  online
                </span>
              </p>
              <p className="type-meta truncate text-[#f5f3f0]/40">
                WhatsApp Business · replies instantly
              </p>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            <span className="eyebrow hidden text-[#c6ad78]/60 md:inline">
              Interactive Demo
            </span>
            <button
              onClick={restart}
              aria-label="Restart demo"
              title="Restart demo"
              className="type-meta flex items-center gap-2 border border-[#2a2a2a] px-4 py-2.5 text-[#f5f3f0]/60 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Restart</span>
            </button>
            <button
              onClick={() => setPanelOpen(true)}
              className="type-meta flex items-center gap-2 border border-[#2a2a2a] px-4 py-2.5 text-[#f5f3f0]/60 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78] lg:hidden"
            >
              <PanelRight className="h-3.5 w-3.5" />
              Lead
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col lg:h-[820px] lg:flex-row">
          {/* Chat pane */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className="wa-bg demo-scroll flex h-[58vh] min-h-[380px] flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:h-auto lg:min-h-0 lg:px-10 lg:py-10"
            >
              {isEmpty && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[#25d366]/25 bg-[#25d366]/[0.07]">
                    <Lock
                      className="h-5 w-5 text-[#25d366]"
                      strokeWidth={1.5}
                    />
                  </span>
                  <div>
                    <p className="type-body text-[#f5f3f0]/80">
                      Start the conversation
                    </p>
                    <p className="type-meta mt-1.5 max-w-xs text-[#f5f3f0]/40">
                      Write to {demoCompany.name} as you would on WhatsApp. Type
                      freely — the assistant asks only for what it doesn&apos;t
                      already know.
                    </p>
                  </div>
                </div>
              )}

              {messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  properties={
                    message.propertyIds && message.kind !== "recap"
                      ? getPropertiesByIds(message.propertyIds)
                      : undefined
                  }
                  read={message.side === "user" && index < readUpTo}
                  onQuickReply={send}
                  onViewProperty={viewProperty}
                  disabled={pending}
                />
              ))}

              {typing && (
                <div className="flex justify-start">
                  <div
                    className="rounded-lg border border-[#1f2f1f] bg-[#1a2c1a] px-5 py-4"
                    role="status"
                    aria-label={`${demoCompany.name} is typing`}
                  >
                    <div className="flex gap-1.5">
                      {[0, 0.2, 0.4].map((delay) => (
                        <motion.span
                          key={delay}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, delay }}
                          className="h-2 w-2 rounded-full bg-[#25d366]/60"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Composer onSend={send} disabled={pending} />

            {/* Mobile lead strip — the key facts stay visible without a drawer */}
            <MobileLeadStrip
              lead={state.lead}
              onOpen={() => setPanelOpen(true)}
              canOpenSummary={shouldShowLead(state)}
            />
          </section>

          {/* Live lead panel (desktop) */}
          <aside className="hidden w-[420px] flex-shrink-0 border-l border-[#1a1a1a] lg:block xl:w-[460px]">
            <LeadPanel
              lead={state.lead}
              sentLinks={state.sentLinks}
              onViewSummary={
                shouldShowLead(state) ? () => setShowLead(true) : undefined
              }
              className="h-full"
            />
          </aside>
        </div>
      </div>

      {/* Live lead panel (mobile overlay) */}
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[54] bg-black/60 lg:hidden"
              onClick={() => setPanelOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{
                type: "tween",
                duration: 0.3,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="fixed inset-y-0 right-0 z-[55] flex w-full max-w-md flex-col border-l border-[#1f1f1f] bg-[#0d0d0d] lg:hidden"
            >
              <button
                onClick={() => setPanelOpen(false)}
                aria-label="Close lead panel"
                className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center border border-[#2a2a2a] text-[#f5f3f0]/50 transition-colors hover:border-[#c6ad78] hover:text-[#f5f3f0]"
              >
                <X className="h-5 w-5" />
              </button>
              <LeadPanel
                lead={state.lead}
                sentLinks={state.sentLinks}
                onViewSummary={
                  shouldShowLead(state)
                    ? () => {
                        setPanelOpen(false);
                        setShowLead(true);
                      }
                    : undefined
                }
                className="h-full"
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Admin overview — the hand-off into the sales system */}
      <AnimatePresence>
        {showLead && (
          <LeadCard
            heading="New Lead — WhatsApp"
            lead={state.lead}
            matches={matches}
            sentLinks={state.sentLinks}
            summary={buildSummary(state.lead, matches, "WhatsApp")}
            onClose={() => setShowLead(false)}
            actions={[
              { label: "View conversation", onClick: () => setShowLead(false) },
              { label: "View lead" },
              { label: "Schedule visit", primary: true },
            ]}
          >
            <div className="grid gap-8 lg:grid-cols-[1.45fr_0.85fr]">
              <section>
                <p className="eyebrow mb-5 text-[#747569]">
                  Conversation{messages.length ? ` (${messages.length})` : ""}
                </p>
                {/*
                  * The whole conversation, not a tail of it. Sales reads this
                  * record to decide what to say next, and the last five messages
                  * routinely cut off the requirement the customer stated first.
                  */}
                <div className="demo-scroll max-h-[420px] space-y-4 overflow-y-auto pr-2">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`border-l-2 pl-4 ${
                        message.side === "user"
                          ? "border-[#818b3b]"
                          : "border-[#c8c5b9]"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="eyebrow text-[#747569]">
                          {message.side === "user" ? "Customer" : "Delhi Homes"}
                        </p>
                        <p className="text-xs tabular-nums text-[#85867a]">
                          {message.at}
                        </p>
                      </div>
                      <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-[#34352b]">
                        {message.text}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
              <aside className="flex items-start gap-4 border-t border-[#d9d6cc] pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#cfccc1] text-[#59621a]">
                  <Search className="h-5 w-5" />
                </span>
                <div>
                  <p className="eyebrow mb-2 text-[#747569]">Lead source</p>
                  <p className="text-base leading-relaxed text-[#34352b]">
                    WhatsApp Business API · enquiry qualified automatically
                  </p>
                  <p className="mt-4 flex items-center gap-2 text-sm text-[#59621a]">
                    <Check className="h-4 w-4" />
                    Synced to CRM
                  </p>
                </div>
              </aside>
            </div>
          </LeadCard>
        )}
      </AnimatePresence>
    </>
  );
}
