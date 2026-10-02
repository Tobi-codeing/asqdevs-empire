"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Globe, MessageCircle, Phone } from "lucide-react";
import { CtaLink } from "@/components/shared/Cta";
import { brand } from "@/lib/data";

/**
 * Hero right-hand system visualisation — shows the full conversion funnel at
 * a scale large enough to read instantly. Each stage is a prominent block
 * connected by an animated spine.
 */
const stages = [
  {
    key: "Website",
    subtitle: "Property showcase",
    Icon: Globe,
  },
  {
    key: "WhatsApp",
    subtitle: "Instant qualification",
    Icon: MessageCircle,
  },
  {
    key: "Phone",
    subtitle: "Call answered",
    Icon: Phone,
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.14, delayChildren: 0.3 } },
};

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative overflow-hidden pt-28 pb-16 lg:pt-28 lg:pb-16">
      {/* Quiet structural backdrop */}
      <div
        aria-hidden
        className="grid-lines pointer-events-none absolute inset-0 opacity-50"
      />

      <div className="shell relative">
        <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 xl:gap-20">
          {/* Editorial headline — left column */}
          <div>
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="eyebrow mb-8 flex items-center gap-3 text-lime"
            >
              <span aria-hidden className="inline-block h-px w-10 bg-lime/60" />
              {brand.name}
            </motion.p>

            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="type-hero"
            >
              Digital systems
              <br />
              <span className="font-serif italic text-lime">
                built for real estate.
              </span>
            </motion.h1>

            <motion.p
              initial={reduce ? false : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.18,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="type-lead mt-7 max-w-[38ch] text-off-white/70"
            >
              {brand.name} builds premium property websites, WhatsApp assistants
              and AI phone reception — so every enquiry becomes a conversation,
              and every conversation becomes a qualified lead.
            </motion.p>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.3,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="mt-9 flex flex-wrap items-center gap-4"
            >
              <CtaLink
                href="#work"
                arrow
                size="lg"
                className="w-full sm:w-auto"
              >
                Explore our work
              </CtaLink>
              <CtaLink
                href="#whatsapp"
                variant="outline"
                size="lg"
                arrow
                className="w-full sm:w-auto"
              >
                Try the demos
              </CtaLink>
            </motion.div>

            <motion.dl
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.45 }}
              className="mt-10 flex flex-wrap gap-x-10 gap-y-5 border-t border-[#1f1f1f] pt-6"
            >
              {[
                { k: "Entry points", v: "Website · WhatsApp · Phone" },
                { k: "Outcome", v: "One structured lead record" },
                { k: "Built with", v: "Next.js · Realtime AI" },
              ].map((item) => (
                <div key={item.k}>
                  <dt className="eyebrow mb-2 text-off-white/30">{item.k}</dt>
                  <dd className="type-meta text-off-white/70">{item.v}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          {/* System visualisation — right column */}
          <motion.div
            variants={container}
            initial={reduce ? false : "hidden"}
            animate="show"
            className="relative"
          >
            <div className="relative border border-[#1f1f1f] bg-[#0c0c0c]/90 p-5 backdrop-blur-sm sm:p-7">
              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <p className="eyebrow text-off-white/30">Live system</p>
                <span className="type-meta flex items-center gap-2 text-lime">
                  <span className="soft-pulse inline-block h-1.5 w-1.5 rounded-full bg-lime" />
                  Active
                </span>
              </div>

              {/* Entry stages */}
              <div className="space-y-0">
                {stages.map(({ key, subtitle, Icon }, i) => (
                  <motion.div key={key} variants={rise} className="relative">
                    <div className="flex items-center gap-4 border border-[#1c1c1c] bg-[#101010] px-4 py-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-lime/30 bg-lime/6 text-lime">
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-medium">{key}</p>
                        <p className="text-sm leading-snug text-off-white/45">
                          {subtitle}
                        </p>
                      </div>
                    </div>

                    {/* Connector line between stages */}
                    {i < stages.length - 1 && (
                      <div className="flex items-center justify-center py-1">
                        <div
                          aria-hidden
                          className="relative h-5 w-px overflow-hidden bg-[#1c1c1c]"
                        >
                          <span
                            className="flow-dot absolute inset-x-0 top-0 h-2 bg-lime"
                            style={{ animationDelay: `${i * 0.5}s` }}
                          />
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* Connector to qualified lead */}
              <div className="flex items-center justify-center py-1">
                <div
                  aria-hidden
                  className="relative h-5 w-px overflow-hidden bg-[#1c1c1c]"
                >
                  <span
                    className="flow-dot absolute inset-x-0 top-0 h-2 bg-lime"
                    style={{ animationDelay: "1.5s" }}
                  />
                </div>
              </div>

              {/* Qualified lead */}
              <motion.div
                variants={rise}
                className="border border-lime bg-lime/[0.07] p-5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="eyebrow text-lime">Qualified Lead</p>
                  <span className="border border-lime px-3 py-1 text-xs font-medium text-lime">
                    HOT
                  </span>
                </div>

                <p className="text-xl font-light">Rahul Sharma</p>

                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-lime/20 pt-4 sm:grid-cols-4">
                  {[
                    { k: "Intent", v: "Buy" },
                    { k: "Size", v: "2 BHK" },
                    { k: "Area", v: "Dwarka" },
                    { k: "Budget", v: "₹90L–1Cr" },
                  ].map((f) => (
                    <div key={f.k}>
                      <p className="eyebrow mb-1.5 text-off-white/30">{f.k}</p>
                      <p className="type-meta text-off-white">{f.v}</p>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Hand-off */}
              <motion.div
                variants={rise}
                className="mt-3 flex items-center justify-between gap-4 border border-[#1c1c1c] bg-[#101010] px-4 py-3"
              >
                <p className="type-meta text-off-white/55">
                  Passed to the sales team with full context
                </p>
                <ArrowRight className="h-4 w-4 shrink-0 text-lime" />
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
