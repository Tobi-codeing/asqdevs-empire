"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Phone } from "lucide-react";
import Keypad from "./Keypad";
import LiveTranscript from "./LiveTranscript";
import CallControls from "./CallControls";
import LanguagePicker from "./LanguagePicker";
import {
  FAILURE_MESSAGE,
  type CallFailure,
  type CallStatus,
} from "@/lib/realtime/live-events";
import type { TranscriptEntry } from "@/lib/calls/transcript";
import type { Language, LanguageCode } from "@/lib/gemini/languages";

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  connected: "Connected",
  listening: "Listening",
  processing: "Processing",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Call unavailable",
};

const formatTime = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function CallScreen({
  status,
  transcript,
  muted,
  language,
  error,
  duration,
  level,
  autoEnding,
  languageMenuOpen,
  onToggleMute,
  onSendKey,
  onSelectLanguage,
  onEnd,
  onRetry,
  onUseText,
}: {
  status: CallStatus;
  transcript: TranscriptEntry[];
  muted: boolean;
  language: Language | null;
  languageMenuOpen: boolean;
  error?: CallFailure;
  duration: number;
  level: number;
  autoEnding?: boolean;
  onToggleMute: () => void;
  onSendKey: (key: string) => void;
  onSelectLanguage: (code: LanguageCode) => void;
  onEnd: () => void;
  onRetry: () => void;
  onUseText: () => void;
}) {
  const [keypadOpen, setKeypadOpen] = useState(true);

  const live =
    status === "connected" ||
    status === "listening" ||
    status === "processing" ||
    status === "speaking";

  const speaking = status === "speaking";
  const listening = status === "listening";
  // Mic level drives the meter when the caller speaks; otherwise it idles.
  const meterScale = muted ? 0 : 0.35 + Math.min(1, level * 3) * 0.65;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="relative flex flex-none flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#171a10_0%,#0d0e0b_58%,#0b0b0b_100%)] px-5 py-5 text-center sm:px-8 sm:py-6">
        <motion.div
          animate={
            live
              ? { scale: speaking ? [1, 1.06, 1] : 1 }
              : { scale: status === "connecting" ? [1, 1.05, 1] : 1 }
          }
          transition={{
            duration: 1.6,
            repeat: speaking || status === "connecting" ? Infinity : 0,
          }}
          className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-[#c6ad78]/50 bg-[#c6ad78]/10 shadow-[0_0_70px_rgba(198,173,120,0.08)] sm:h-16 sm:w-16"
        >
          {(speaking || listening) && (
            <span
              aria-hidden
              className="soft-pulse absolute inset-[-7px] rounded-full border border-[#c6ad78]/25"
            />
          )}
          <Phone className="h-7 w-7 text-[#c6ad78]" strokeWidth={1.4} />
        </motion.div>

        <p className="mt-3 text-lg font-medium text-[#c6ad78]">
          {autoEnding ? "Wrapping up" : STATUS_LABEL[status]}
        </p>

        {autoEnding && (
          <p className="type-meta mt-3 max-w-md border border-[#c6ad78]/30 bg-[#c6ad78]/[0.06] px-4 py-3 text-[#c6ad78]">
            Requirement captured — the receptionist is closing the call and the
            lead is being prepared.
          </p>
        )}
        {live && (
          <p className="mt-1 font-mono text-sm tabular-nums text-[#f5f3f0]/60">
            {formatTime(duration)}
          </p>
        )}
        {language && (
          <p className="eyebrow mt-2 text-[#f5f3f0]/45">
            Language · {language.label} · {language.native}
          </p>
        )}

        {live && !language && (
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#f5f3f0]/75 sm:text-lg">
            Speak naturally — Hindi, English or a mix.
            <span className="mt-1 block text-[#f5f3f0]/50">
              The receptionist answers in the same language and keeps the same
              tone throughout the call.
            </span>
          </p>
        )}

        {live && (
          <div
            className="mt-3 flex h-9 items-center gap-[3px]"
            aria-label={
              muted
                ? "Microphone muted"
                : speaking
                  ? "Receptionist speaking"
                  : listening
                    ? "Listening to caller"
                    : "Call audio connected"
            }
          >
            {Array.from({ length: 28 }).map((_, i) => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full bg-[#c6ad78]/70"
                animate={{
                  // Height follows the live microphone level while listening,
                  // and pulses while the receptionist speaks.
                  height: speaking
                    ? [7, 30, 12]
                    : listening
                      ? [7, 7 + meterScale * 26, 9]
                      : 7,
                }}
                transition={{
                  duration: speaking ? 0.9 : 0.45,
                  repeat: listening || speaking ? Infinity : 0,
                  delay: i * 0.03,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="mt-7 max-w-xl border border-[#723f36] bg-[#231512] p-5 text-left">
            <p className="type-body text-[#f5f3f0]/85">
              {FAILURE_MESSAGE[error ?? "generic"]}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={onRetry}
                className="min-h-12 border border-[#3a3a32] px-5 py-3 text-sm transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
              >
                Try again
              </button>
              <button
                onClick={onUseText}
                className="min-h-12 bg-[#c6ad78] px-5 py-3 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f]"
              >
                Try text demo
              </button>
            </div>
          </div>
        )}

        {languageMenuOpen && live && (
          <div className="mt-7 flex w-full justify-center">
            <LanguagePicker
              onSelect={onSelectLanguage}
              current={language?.code ?? null}
            />
          </div>
        )}

        {keypadOpen && live && !languageMenuOpen && (
          <div className="mt-4 w-full max-w-[292px]">
            <Keypad onPress={onSendKey} />
          </div>
        )}
      </section>

      <section className="flex h-[200px] shrink-0 flex-col overflow-hidden border-t border-[#1f1f1f] sm:h-[220px]">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#1f1f1f] px-5 py-3 sm:px-7">
          <p className="eyebrow text-[#f5f3f0]/45">Live transcript</p>
          <span className="type-meta text-[#f5f3f0]/35">
            Conversation appears here
          </span>
        </div>
        <LiveTranscript entries={transcript} active={speaking} />
      </section>

      <CallControls
        muted={muted}
        onToggleMute={onToggleMute}
        onToggleKeypad={() => setKeypadOpen((v) => !v)}
        keypadOpen={keypadOpen}
        onEnd={onEnd}
        disabled={!live}
      />
    </div>
  );
}
