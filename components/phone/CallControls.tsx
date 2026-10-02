"use client";

import { Mic, MicOff, Grid3x3, PhoneOff } from "lucide-react";

export default function CallControls({
  muted,
  onToggleMute,
  onToggleKeypad,
  keypadOpen,
  onEnd,
  disabled,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onToggleKeypad: () => void;
  keypadOpen: boolean;
  onEnd: () => void;
  disabled?: boolean;
}) {
  const secondary =
    "flex flex-col items-center gap-2 text-sm text-[#f5f3f0]/65 transition-colors hover:text-[#c6ad78] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-start justify-center gap-8 border-t border-[#1f1f1f] bg-[#0b0b0b] px-4 py-5 sm:gap-14 sm:px-6 sm:py-6">
      <button className={secondary} onClick={onToggleMute} disabled={disabled}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[#2a2a2a] sm:h-16 sm:w-16">
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </span>
        {muted ? "Unmute" : "Mute"}
      </button>

      <button
        className={secondary}
        onClick={onToggleKeypad}
        disabled={disabled}
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full border sm:h-16 sm:w-16 ${
            keypadOpen ? "border-lime text-lime" : "border-[#2a2a2a]"
          }`}
        >
          <Grid3x3 className="h-6 w-6" />
        </span>
        Keypad
      </button>

      <button
        className="flex flex-col items-center gap-2 text-sm text-off-white/65 transition-colors hover:text-[#e05a5a]"
        onClick={onEnd}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e05a5a] text-white sm:h-16 sm:w-16">
          <PhoneOff className="h-6 w-6" />
        </span>
        End call
      </button>
    </div>
  );
}
