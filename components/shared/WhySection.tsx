'use client';

import { motion, useReducedMotion } from 'framer-motion';

const problems = [
  {
    statement: 'Too many enquiries never become conversations.',
    system: 'WhatsApp Assistant',
    href: '#whatsapp',
  },
  {
    statement: 'Salespeople repeat information customers already provided.',
    system: 'Structured lead records',
    href: '#whatsapp',
  },
  {
    statement: 'Calls get missed.',
    system: 'AI Phone Receptionist',
    href: '#phone',
  },
  {
    statement: 'Follow-ups disappear between messages and spreadsheets.',
    system: 'One connected workflow',
    href: '#system',
  },
];

export default function WhySection() {
  const reduce = useReducedMotion();

  return (
    <section className="section-pad hairline">
      <div className="shell">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-120px' }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-gap max-w-4xl"
        >
          <p className="eyebrow mb-7 flex items-center gap-3 text-[#c6ad78]">
            <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
            Why this matters
          </p>
          <h2 className="type-display">
            The gap is never the listing.
            <br />
            <span className="font-serif italic text-[#c6ad78]">It&apos;s the follow-through.</span>
          </h2>
        </motion.div>

        {/* Editorial problem / system pairs */}
        <div className="space-y-px">
          {problems.map((problem, i) => (
            <motion.div
              key={problem.statement}
              initial={reduce ? false : { opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-70px' }}
              transition={{ delay: i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="group grid items-baseline gap-5 border-t border-[#2a2a2a] py-10 lg:grid-cols-[auto_1fr_auto] lg:gap-10 lg:py-12"
            >
              <span className="font-serif text-lg italic text-[#c6ad78]/60">{`0${i + 1}`}</span>

              <p className="type-title max-w-3xl text-[#f5f3f0]/80 transition-colors duration-300 group-hover:text-[#f5f3f0]">
                {problem.statement}
              </p>

              <a
                href={problem.href}
                className="type-meta flex items-center gap-3 text-[#f5f3f0]/45 transition-colors duration-300 hover:text-[#c6ad78] lg:justify-end"
              >
                <span
                  aria-hidden
                  className="hidden h-px w-8 bg-[#2a2a2a] transition-colors duration-300 group-hover:bg-[#c6ad78]/60 lg:block"
                />
                {problem.system}
              </a>
            </motion.div>
          ))}
          <div className="border-t border-[#2a2a2a]" />
        </div>

        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="type-lead mt-16 max-w-3xl text-[#f5f3f0]/55"
        >
          We don&apos;t promise results. We build the systems that make these gaps smaller — one
          enquiry, one conversation, one call at a time.
        </motion.p>
      </div>
    </section>
  );
}
