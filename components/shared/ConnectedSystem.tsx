"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Globe,
  MessageCircle,
  Phone,
  Users,
} from "lucide-react";

const flow = [
  {
    key: "Website",
    caption: "A clear place to discover the property.",
    Icon: Globe,
  },
  {
    key: "WhatsApp",
    caption: "Instant answers, in the customer’s own words.",
    Icon: MessageCircle,
  },
  { key: "Phone", caption: "Every call answered and understood.", Icon: Phone },
  {
    key: "Qualified Lead",
    caption: "Intent, budget and timing in one record.",
    Icon: BadgeCheck,
  },
  {
    key: "Sales Team",
    caption: "A person takes the next step with context.",
    Icon: Users,
  },
];

export default function ConnectedSystem() {
  const reduce = useReducedMotion();

  return (
    <section
      id="system"
      className="section-pad hairline relative overflow-hidden"
    >
      <div
        aria-hidden
        className="grid-lines pointer-events-none absolute inset-0 opacity-40"
      />

      <div className="shell relative">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-120px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-gap grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end"
        >
          <div>
            <p className="eyebrow mb-7 flex items-center gap-3 text-lime">
              <span aria-hidden className="inline-block h-px w-10 bg-lime/60" />
              The Connected System
            </p>
            <h2 className="type-display">
              Three channels.
              <br />
              <span className="font-serif italic text-lime">
                One sales workflow.
              </span>
            </h2>
          </div>
          <p className="type-lead max-w-lg text-off-white/60 lg:pb-3">
            A customer can find you anywhere. What matters is that the enquiry
            arrives somewhere structured — with context, a score and a next
            step.
          </p>
        </motion.div>

        <div className="grid gap-0 pt-10 lg:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,1.1fr)_44px_minmax(0,1fr)] lg:pt-0">
          {flow.map(({ key, caption, Icon }, index) => (
            <div key={key} className="contents">
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{
                  duration: 0.6,
                  delay: index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`flex min-h-36 flex-col justify-between border border-[#242424] bg-[#0e0e0e] p-5 transition-colors hover:border-lime/50 sm:min-h-40 sm:p-6 ${
                  index === flow.length - 1 ? "border-lime/60 bg-lime/6" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif text-2xl italic text-lime/70">
                    0{index + 1}
                  </span>
                  <Icon className="h-7 w-7 text-lime" strokeWidth={1.5} />
                </div>
                <div className="mt-7">
                  <h3 className="text-lg font-medium sm:text-xl">{key}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-off-white/55">
                    {caption}
                  </p>
                </div>
              </motion.div>
              {index < flow.length - 1 && (
                <div
                  key={`${key}-connector`}
                  aria-hidden
                  className="flex h-12 items-center justify-center text-lime/65 lg:h-auto"
                >
                  <ArrowDown className="h-5 w-5 lg:hidden" />
                  <ArrowRight className="hidden h-5 w-5 lg:block" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
