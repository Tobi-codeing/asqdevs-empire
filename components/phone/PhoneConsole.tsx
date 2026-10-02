"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, PanelRight, MessageSquare, X, Headphones } from "lucide-react";
import CallScreen from "./CallScreen";
import TextCallPane from "./TextCallPane";
import { useCallSession } from "@/lib/calls/useCallSession";
import LeadPanel from "@/components/admin/LeadPanel";
import LeadCard from "@/components/admin/LeadCard";
import { buildCallOutcome } from "@/lib/gemini/summary";
import { emptyLead, type Lead } from "@/lib/leads/types";
import { getPropertiesByIds } from "@/lib/properties/search";
import { demoCompany } from "@/lib/data";

type Mode = "idle" | "voice" | "text";

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The phone section is a full call console rendered inline on the page. Real
 * voice runs over the Gemini Live API; if that is unavailable the same
 * conversation is offered as a text call so the demo never dead-ends.
 */
export default function PhoneConsole() {
  const [mode, setMode] = useState<Mode>("idle");
  /**
   * Whether real voice can start, and — when it cannot — the specific reason,
   * so the console names the missing piece instead of one vague line.
   */
  const [voiceStatus, setVoiceStatus] = useState<{
    ready: boolean;
    reason?: string;
  } | null>(null);
  const [textLead, setTextLead] = useState<Lead>(() => emptyLead("Phone"));
  const [showLead, setShowLead] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const call = useCallSession({
    // When the conversation completes itself, show the admin overview without
    // the visitor having to press anything.
    onAutoEnd: () => setShowLead(true),
  });

  const lead = mode === "voice" ? call.lead : textLead;

  // Ask the server whether real voice is available.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gemini/session")
      .then((res) => res.json())
      .then(
        (data: { configured?: boolean; relay?: boolean; reason?: string }) => {
          // Voice is offered only when a relay is actually reachable; otherwise
          // the text call is the path. `reason` drives the explanatory message.
          if (!cancelled)
            setVoiceStatus({
              ready: Boolean(data.configured && data.relay),
              reason: data.reason,
            });
        },
      )
      .catch(() => {
        if (!cancelled)
          setVoiceStatus({ ready: false, reason: "relay_unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startVoice = async () => {
    setMode("voice");
    await call.start();
  };

  const startText = () => {
    setMode("text");
    setTextLead(emptyLead("Phone"));
  };

  const endCall = async () => {
    const hadConversation = call.transcript.some(
      (entry) => entry.role !== "system",
    );
    await call.end();
    // Show the admin overview whenever something was actually said, even if the
    // conversation never reached a full qualification.
    if (hadConversation || call.lead.score > 0) setShowLead(true);
  };

  const handleTextComplete = useCallback((completedLead: Lead) => {
    setTextLead(completedLead);
    setShowLead(true);
  }, []);

  const matches = getPropertiesByIds(lead.matchedPropertyIds);

  // The admin summary is derived from the conversation that actually happened.
  const outcome = buildCallOutcome(lead, matches, call.transcript);

  return (
    <>
      <div className="border border-[#2a2a2a] bg-[#0c0c0c]">
        {/* Console chrome */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1f1f1f] px-5 py-4 lg:px-7">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center bg-[#c6ad78] text-sm font-semibold text-[#0a0a0a]">
              {demoCompany.initials}
            </span>
            <div>
              <p className="text-base font-medium">{demoCompany.name}</p>
              <p className="type-meta text-[#f5f3f0]/45">
                AI Receptionist · inbound line
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="eyebrow hidden text-[#c6ad78]/70 sm:inline">
              Interactive Demo
            </span>
            {mode !== "idle" && (
              <button
                onClick={() => {
                  void call.end();
                  setMode("idle");
                }}
                className="type-meta border border-[#2a2a2a] px-4 py-2.5 text-[#f5f3f0]/70 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setPanelOpen(true)}
              className="type-meta flex items-center gap-2 border border-[#2a2a2a] px-4 py-2.5 text-[#f5f3f0]/70 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78] lg:hidden"
            >
              <PanelRight className="h-3.5 w-3.5" />
              Lead
            </button>
          </div>
        </div>

        <div
          className={`flex min-h-0 items-stretch ${mode === "idle" ? "" : "lg:min-h-[820px]"}`}
        >
          {/* Call pane */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mode === "idle" && (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center lg:px-14 lg:py-20">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#c6ad78]/40 bg-[#c6ad78]/10">
                  <Phone className="h-8 w-8 text-[#c6ad78]" strokeWidth={1.5} />
                </div>

                <h3 className="type-title max-w-2xl">
                  Call the{" "}
                  <span className="font-serif italic text-[#c6ad78]">
                    AI receptionist
                  </span>
                </h3>

                <p className="type-body mt-5 max-w-xl text-[#f5f3f0]/60">
                  The receptionist greets you and offers a language — press 1 for
                  Hindi, 2 for English, 3 for more. Then speak naturally: it
                  answers like a real advisor in that language and tone, and only
                  asks for what it doesn&apos;t already know.
                </p>

                {voiceStatus?.ready === false && (
                  <div className="mt-7 max-w-xl border border-[#2a2a2a] bg-[#120f0f] p-5 text-left">
                    <p className="type-meta text-[#f5f3f0]/80">
                      {voiceStatus.reason === "not_configured"
                        ? "Live voice isn't configured here — no Gemini API key is set on the server. The text call runs the same conversation and still produces a lead."
                        : "The voice relay isn't reachable. This deployment should point at one with VOICE_RELAY_URL. The text call runs the same conversation and still produces a lead."}
                    </p>
                  </div>
                )}

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  {voiceStatus?.ready !== false && (
                    <button
                      onClick={startVoice}
                      disabled={voiceStatus === null}
                      className="flex items-center gap-3 bg-[#c6ad78] px-8 py-4 text-base font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f] disabled:opacity-50"
                    >
                      <Phone className="h-5 w-5" />
                      {voiceStatus === null ? "Checking⬦" : "Start voice call"}
                    </button>
                  )}
                  <button
                    onClick={startText}
                    className={`flex items-center gap-3 px-8 py-4 text-base transition-colors ${
                      voiceStatus?.ready === false
                        ? "bg-[#c6ad78] font-medium text-[#0a0a0a] hover:bg-[#aa925f]"
                        : "border border-[#2a2a2a] text-[#f5f3f0] hover:border-[#c6ad78] hover:text-[#c6ad78]"
                    }`}
                  >
                    <MessageSquare className="h-5 w-5" />
                    Try text call
                  </button>
                </div>

                <p className="type-meta mt-6 flex items-center gap-2 text-[#f5f3f0]/40">
                  <Headphones className="h-4 w-4" />
                  Microphone access is required for real voice. Use headphones
                  for the best result.
                </p>
              </div>
            )}

            {mode === "voice" && (
              <CallScreen
                status={call.status}
                transcript={call.transcript}
                muted={call.muted}
                language={call.language}
                error={call.error}
                duration={call.duration}
                level={call.level}
                autoEnding={call.autoEnding}
                languageMenuOpen={call.languageMenuOpen}
                onSelectLanguage={call.selectLanguage}
                onToggleMute={call.toggleMute}
                onSendKey={call.sendKey}
                onEnd={endCall}
                onRetry={startVoice}
                onUseText={startText}
              />
            )}

            {mode === "text" && (
              <TextCallPane
                onLead={setTextLead}
                onComplete={handleTextComplete}
              />
            )}
          </section>

          {/* Live lead panel (desktop) */}
          <aside className="hidden w-[400px] flex-shrink-0 border-l border-[#1f1f1f] lg:block xl:w-[460px]">
            <LeadPanel
              lead={lead}
              onViewSummary={
                lead.score > 0 ? () => setShowLead(true) : undefined
              }
              className="h-full"
            />
          </aside>
        </div>
      </div>

      {/* Live lead panel (mobile) */}
      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              type: "tween",
              duration: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed inset-y-0 right-0 z-[55] w-full max-w-md border-l border-[#1f1f1f] lg:hidden"
          >
            <button
              onClick={() => setPanelOpen(false)}
              aria-label="Close lead panel"
              className="absolute right-4 top-4 z-10 p-1 text-[#f5f3f0]/50 hover:text-[#f5f3f0]"
            >
              <X className="h-5 w-5" />
            </button>
            <LeadPanel
              lead={lead}
              onViewSummary={
                lead.score > 0
                  ? () => {
                      setPanelOpen(false);
                      setShowLead(true);
                    }
                  : undefined
              }
              className="h-full"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call completed — admin overview, built from the real conversation */}
      <AnimatePresence>
        {showLead && (
          <LeadCard
            heading="Call Completed"
            lead={lead}
            matches={matches}
            summary={outcome.summary}
            onClose={() => setShowLead(false)}
            actions={[
              {
                label: showTranscript ? "Hide transcript" : "View transcript",
                onClick: () => setShowTranscript((v) => !v),
              },
              { label: "View lead" },
              { label: "Schedule visit", primary: true },
            ]}
          >
            <div className="flex flex-wrap items-center gap-6">
              {call.recordingUrl ? (
                <>
                  <span
                    aria-hidden
                    className="flex h-14 w-14 flex-shrink-0 items-center justify-center border border-[#59621a]/50 text-lg text-[#59621a]"
                  >
                    ▶
                  </span>
                  <div className="min-w-[220px] flex-1">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                      <p className="eyebrow text-[#59621a]">Call recording</p>
                      <p className="type-meta tabular-nums text-[#67685e]">
                        {formatDuration(call.duration)}
                      </p>
                    </div>
                    <audio
                      controls
                      src={call.recordingUrl}
                      className="w-full"
                      aria-label="Recording of this demo call"
                    />
                    <p className="type-meta mt-3 text-[#67685e]">
                      Caller and receptionist audio captured together in this
                      browser.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="flex h-14 w-14 flex-shrink-0 items-center justify-center border border-[#cfccc1] text-lg text-[#85867a]"
                  >
                    ▶
                  </span>
                  <div className="min-w-[220px] flex-1">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                      <p className="eyebrow text-[#747569]">Demo recording</p>
                      <p className="type-meta tabular-nums text-[#67685e]">
                        {formatDuration(call.duration)}
                      </p>
                    </div>
                    <div className="flex h-6 items-end gap-[3px]">
                      {Array.from({ length: 56 }).map((_, i) => (
                        <span
                          key={i}
                          className="w-[3px] flex-1 bg-[#f5f3f0]/15"
                          style={{ height: `${20 + ((i * 13) % 80)}%` }}
                        />
                      ))}
                    </div>
                    <p className="type-meta mt-3 text-[#67685e]">
                      Audio was not captured in this browser. The transcript
                      below is the real conversation.
                    </p>
                  </div>
                </>
              )}
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="type-meta flex flex-shrink-0 items-center gap-2 border border-[#2a2a2a] px-5 py-3 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
              >
                {showTranscript ? "Hide transcript" : "View transcript"}
                <span aria-hidden>→</span>
              </button>
            </div>

            {showTranscript && (
              <div className="demo-scroll mt-7 max-h-80 space-y-5 overflow-y-auto border-t border-[#cfccc1] pt-7">
                {call.transcript.length === 0 && (
                  <p className="type-meta text-[#747569]">
                    No transcript was captured.
                  </p>
                )}
                {call.transcript.map((entry) => (
                  <div key={entry.id}>
                    <p className="eyebrow mb-1.5 text-[#747569]">
                      {entry.role === "assistant"
                        ? "Delhi Homes"
                        : entry.role === "user"
                          ? "Caller"
                          : "System"}
                    </p>
                    <p
                      className={`type-body ${
                        entry.role === "assistant"
                          ? "text-[#465116]"
                          : "text-[#34352b]"
                      }`}
                    >
                      {entry.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </LeadCard>
        )}
      </AnimatePresence>
    </>
  );
}
