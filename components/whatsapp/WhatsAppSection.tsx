"use client";

import { motion, useReducedMotion } from "framer-motion";
import WhatsAppWorkbench from "./WhatsAppWorkbench";

const capability = [
  { k: "Understands", v: "Free text, English and Hinglish" },
  { k: "Extracts", v: "Intent, area, size, budget, timeline" },
  { k: "Never", v: "Asks twice for the same detail" },
  { k: "Hands off", v: "A structured lead, ready for sales" },
];

export default function WhatsAppSection() {
  const reduce = useReducedMotion();

  return (
    <section id="whatsapp" className="section-pad hairline">
      <div className="shell">
        {/* Section masthead — editorial left, features right */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-120px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-gap"
        >
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <p className="eyebrow mb-7 flex items-center gap-3 text-[#c6ad78]">
                <span
                  aria-hidden
                  className="inline-block h-px w-10 bg-[#c6ad78]/60"
                />
                WhatsApp Automation
              </p>
              <h2 className="type-display">
                Every enquiry
                <br />
                <span className="font-serif italic text-[#c6ad78]">
                  deserves a response.
                </span>
              </h2>
            </div>

            <div>
              <p className="type-lead mb-10 max-w-xl text-[#f5f3f0]/65">
                Most property enquiries arrive on WhatsApp and go cold while
                someone gets to them. This assistant answers instantly, works
                out what the customer actually needs, and hands your team a
                complete record.
              </p>

              <dl className="grid grid-cols-2 gap-x-8 gap-y-6">
                {capability.map((item) => (
                  <div key={item.k}>
                    <dt className="eyebrow mb-2 text-[#f5f3f0]/35">{item.k}</dt>
                    <dd className="type-meta text-[#f5f3f0]/75">{item.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </motion.div>

        {/* The workbench — centrepiece of the site */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 34 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <WhatsAppWorkbench />
        </motion.div>

        <p className="type-meta mt-8 text-[#f5f3f0]/35">
          Type anything, or tap a quick reply. Gemini responds using the
          fictional Delhi Homes listings.
        </p>
      </div>
    </section>
  );
}
