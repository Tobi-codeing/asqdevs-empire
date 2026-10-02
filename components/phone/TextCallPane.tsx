"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import Composer from "@/components/whatsapp/Composer";
import {
  createEngineState,
  openingMessages,
  respond,
  shouldShowLead,
  type ChatMessage,
  type EngineState,
} from "@/lib/whatsapp/engine";
import type { Lead } from "@/lib/leads/types";

const speak = (text: string, lang: string) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};

export default function TextCallPane({
  onLead,
  onComplete,
}: {
  onLead: (lead: Lead) => void;
  onComplete: (lead: Lead) => void;
}) {
  const [state, setState] = useState<EngineState>(() =>
    createEngineState("Phone"),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    openingMessages("Phone"),
  );
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);

  const stateRef = useRef(state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef(voiceOn);

  useEffect(() => {
    voiceRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    onLead(state.lead);
  }, [state.lead, onLead]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = useCallback(
    async (text: string) => {
      if (pending || !text.trim()) return;
      setPending(true);

      const result = respond(stateRef.current, text);
      const userMessage = result.messages.find((m) => m.side === "user");
      const assistantMessages = result.messages.filter(
        (m) => m.side === "assistant",
      );

      if (userMessage) setMessages((prev) => [...prev, userMessage]);
      stateRef.current = result.state;
      setState(result.state);
      setTyping(true);

      await new Promise((r) => setTimeout(r, 800));

      setTyping(false);
      setMessages((prev) => [...prev, ...assistantMessages]);
      setPending(false);

      if (voiceRef.current && assistantMessages.length) {
        speak(assistantMessages[assistantMessages.length - 1].text, "en-IN");
      }

      if (shouldShowLead(result.state)) {
        setTimeout(() => onComplete(result.state.lead), 900);
      }
    },
    [onComplete, pending],
  );

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.side === "assistant");
  const quickReplies =
    !pending && lastAssistant?.quickReplies ? lastAssistant.quickReplies : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[#1f1f1f] px-5 py-3">
        <p className="text-xs text-[#f5f3f0]/50">
          Text call — the same conversation, typed instead of spoken.
        </p>
        <button
          onClick={() => {
            setVoiceOn((v) => {
              if (v) window.speechSynthesis?.cancel();
              return !v;
            });
          }}
          className="flex items-center gap-2 border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#f5f3f0]/60 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
        >
          {voiceOn ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <VolumeX className="h-3.5 w-3.5" />
          )}
          {voiceOn ? "Voice on" : "Voice off"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="demo-scroll flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className="text-[11px] uppercase tracking-wider text-[#f5f3f0]/40">
              {message.side === "assistant" ? "Delhi Homes" : "Caller"}
            </p>
            <p
              className={`text-sm leading-relaxed whitespace-pre-line ${
                message.side === "assistant"
                  ? "text-[#c6ad78]"
                  : "text-[#f5f3f0]"
              }`}
            >
              {message.text}
            </p>
          </motion.div>
        ))}

        {typing && (
          <div className="flex gap-1.5">
            {[0, 0.2, 0.4].map((d) => (
              <motion.span
                key={d}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: d }}
                className="h-1.5 w-1.5 rounded-full bg-[#c6ad78]/70"
              />
            ))}
          </div>
        )}
      </div>

      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-[#1f1f1f] px-5 py-3">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => send(reply)}
              className="border border-[#2a2a2a] px-3 py-1.5 text-xs transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <Composer
        onSend={send}
        disabled={pending}
        placeholder="Say something — e.g. I need a 2 BHK in Dwarka around 95 lakh"
      />
    </div>
  );
}
