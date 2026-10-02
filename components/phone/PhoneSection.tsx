'use client';

import { motion, useReducedMotion } from 'framer-motion';
import PhoneConsole from './PhoneConsole';

const states = ['Connecting', 'Connected', 'Listening', 'Speaking', 'Ended'];

const behaviours = [
  { k: 'Understands', v: 'Hindi, English and Hinglish callers' },
  { k: 'Collects', v: 'Only the details still missing' },
  { k: 'Answers with', v: 'Verified inventory — never invented' },
  { k: 'Escalates', v: 'Site visits, callbacks, human hand-off' },
];

export default function PhoneSection() {
  const reduce = useReducedMotion();

  return (
    <section id="phone" className="section-pad hairline">
      <div className="shell">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-120px' }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-gap grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end"
        >
          <div>
            <p className="eyebrow mb-7 flex items-center gap-3 text-[#c6ad78]">
              <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
              AI Phone Receptionist
            </p>
            <h2 className="type-display">
              The call is answered.
              <br />
              <span className="font-serif italic text-[#c6ad78]">The enquiry is understood.</span>
            </h2>
          </div>

          <div>
            <p className="type-lead mb-9 max-w-xl text-[#f5f3f0]/65">
              A missed call is a lost customer. This receptionist answers every inbound enquiry,
              handles the language, and passes your team a qualified lead with the full transcript.
            </p>

            {/* Call state rail */}
            <div className="mb-9 flex flex-wrap items-center gap-x-5 gap-y-3">
              {states.map((state, i) => (
                <span key={state} className="flex items-center gap-3">
                  <span className="type-meta text-[#f5f3f0]/70">{state}</span>
                  {i < states.length - 1 && (
                    <span aria-hidden className="text-[#c6ad78]/50">
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-6">
              {behaviours.map((item) => (
                <div key={item.k}>
                  <dt className="eyebrow mb-2 text-[#f5f3f0]/35">{item.k}</dt>
                  <dd className="type-meta text-[#f5f3f0]/80">{item.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 34 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <PhoneConsole />
        </motion.div>

        <p className="type-meta mt-6 text-[#f5f3f0]/40">
          Real voice runs over the Gemini Live API using a short-lived token minted on the server.
          If voice isn&apos;t configured, the same conversation runs as a text call. Not connected to
          any live phone system.
        </p>
      </div>
    </section>
  );
}
