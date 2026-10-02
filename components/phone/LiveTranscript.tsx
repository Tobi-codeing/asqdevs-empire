"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { TranscriptEntry } from "@/lib/calls/transcript";

export default function LiveTranscript({
  entries,
  active,
}: {
  entries: TranscriptEntry[];
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, active]);

  return (
    <div
      ref={ref}
      className="demo-scroll min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-5"
    >
      {entries.length === 0 && (
        <p className="type-body text-[#f5f3f0]/35">
          The live transcript will appear here as you speak.
        </p>
      )}

      {entries.map((entry) => (
        <motion.div
          key={entry.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={entry.role === "system" ? "text-center" : ""}
        >
          {entry.role === "system" ? (
            <span className="eyebrow text-[#f5f3f0]/30">{entry.text}</span>
          ) : (
            <>
              <p className="eyebrow mb-2 text-[#f5f3f0]/40">
                {entry.role === "assistant" ? "Delhi Homes" : "Caller"}
              </p>
              <p
                className={`type-body ${
                  entry.role === "assistant"
                    ? "text-[#c6ad78]"
                    : "text-[#f5f3f0]"
                }`}
              >
                {entry.text}
              </p>
            </>
          )}
        </motion.div>
      ))}

      {active && (
        <div className="flex gap-2">
          {[0, 0.2, 0.4].map((d) => (
            <motion.span
              key={d}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: d }}
              className="h-2 w-2 rounded-full bg-[#c6ad78]/70"
            />
          ))}
        </div>
      )}
    </div>
  );
}
