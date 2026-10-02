"use client";

import { motion } from "framer-motion";
import {
  OTHER_LANGUAGES,
  PRIMARY_LANGUAGES,
  type LanguageCode,
} from "@/lib/gemini/languages";

/**
 * The extended language list, shown when the caller presses 3.
 *
 * Choosing here sends the choice to the model, so the voice conversation
 * genuinely switches language rather than only relabelling the interface.
 */
export default function LanguagePicker({
  onSelect,
  current,
}: {
  onSelect: (code: LanguageCode) => void;
  current?: LanguageCode | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-[440px]"
    >
      <p className="type-meta mb-3 text-center text-[#f5f3f0]/50">
        Choose a language — the receptionist will continue in it
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[...PRIMARY_LANGUAGES, ...OTHER_LANGUAGES].map((language) => {
          const active = current === language.code;
          return (
            <button
              key={language.code}
              onClick={() => onSelect(language.code)}
              aria-pressed={active}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 border px-3 py-2.5 transition-colors ${
                active
                  ? "border-[#c6ad78] bg-[#c6ad78]/10 text-[#c6ad78]"
                  : "border-[#2a2a2a] text-[#f5f3f0]/80 hover:border-[#c6ad78]/60 hover:text-[#c6ad78]"
              }`}
            >
              <span className="text-sm font-medium">{language.native}</span>
              <span className="text-[11px] text-[#f5f3f0]/45">
                {language.label}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
