"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Calendar, Mail, MessageCircle, ArrowUpRight } from "lucide-react";
import { brand, serviceOptions } from "@/lib/data";

const initial = {
  name: "",
  email: "",
  requirement: "",
  budget: "",
  timeline: "",
  message: "",
};

export function buildWhatsAppMessage(form: typeof initial) {
  const lines = [
    `Hi ${brand.name},`,
    "",
    "I'd like to discuss a project.",
    "",
    `Name: ${form.name.trim()}`,
    `Email: ${form.email.trim()}`,
    `Requirement: ${form.requirement}`,
  ];
  if (form.budget.trim()) lines.push(`Budget: ${form.budget.trim()}`);
  if (form.timeline.trim()) lines.push(`Timeline: ${form.timeline.trim()}`);
  lines.push(
    "",
    `Message: ${form.message.trim()}`,
    "",
    "Please let me know the next steps.",
  );
  return lines.join("\n");
}

export default function Contact() {
  const [form, setForm] = useState(initial);
  const [sent, setSent] = useState(false);

  const update = (key: keyof typeof initial, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = `${brand.whatsapp}?text=${encodeURIComponent(buildWhatsAppMessage(form))}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setSent(true);
  };

  const inputClass =
    "w-full bg-transparent border-b border-[#2a2a2a] px-0 py-4 text-[#f5f3f0] placeholder:text-[#f5f3f0]/25 focus:border-[#c6ad78] outline-none transition-colors";

  const labelClass = "type-meta mb-1 block text-[#f5f3f0]/50";

  return (
    <section id="contact" className="section-pad hairline">
      <div className="shell">
        <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
          {/* Left — editorial */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-120px" }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="lg:sticky lg:top-32 lg:self-start"
          >
            <p className="eyebrow mb-7 flex items-center gap-3 text-[#c6ad78]">
              <span
                aria-hidden
                className="inline-block h-px w-10 bg-[#c6ad78]/60"
              />
              Start a Project
            </p>

            <h2 className="type-display">
              Tell us what you&apos;re{" "}
              <span className="font-serif italic text-[#c6ad78]">
                building.
              </span>
            </h2>

            <p className="type-lead mt-8 max-w-lg text-[#f5f3f0]/60">
              One service or the whole system — tell us what you need and
              we&apos;ll shape the right scope around it.
            </p>

            <div className="mt-9 space-y-px sm:mt-12">
              <a
                href={`tel:${brand.phone}`}
                className="group flex items-center justify-between gap-4 border-t border-[#2a2a2a] py-5 transition-colors sm:py-6"
              >
                <span>
                  <span className="type-meta block text-[#f5f3f0]/45">
                    Book a call
                  </span>
                  <span className="mt-1.5 block text-xl font-light transition-colors group-hover:text-[#c6ad78]">
                    {brand.whatsappNumber}
                  </span>
                </span>
                <Calendar
                  className="h-5 w-5 flex-shrink-0 text-[#c6ad78]"
                  strokeWidth={1.6}
                />
              </a>

              <a
                href={`mailto:${brand.email}`}
                className="group flex items-center justify-between gap-4 border-t border-[#2a2a2a] py-5 transition-colors sm:py-6"
              >
                <span>
                  <span className="type-meta block text-[#f5f3f0]/45">
                    Email
                  </span>
                  <span className="mt-1.5 block text-xl font-light transition-colors group-hover:text-[#c6ad78]">
                    {brand.email}
                  </span>
                </span>
                <Mail
                  className="h-5 w-5 flex-shrink-0 text-[#c6ad78]"
                  strokeWidth={1.6}
                />
              </a>

              <a
                href={brand.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-4 border-y border-[#2a2a2a] py-5 transition-colors sm:py-6"
              >
                <span>
                  <span className="type-meta block text-[#f5f3f0]/45">
                    WhatsApp
                  </span>
                  <span className="mt-1.5 block text-xl font-light transition-colors group-hover:text-[#c6ad78]">
                    {brand.whatsappNumber}
                  </span>
                </span>
                <MessageCircle
                  className="h-5 w-5 flex-shrink-0 text-[#c6ad78]"
                  strokeWidth={1.6}
                />
              </a>

              <Link
                href="/contact"
                className="group flex items-center justify-between gap-4 border-b border-[#2a2a2a] py-5 transition-colors sm:py-6"
              >
                <span>
                  <span className="type-meta block text-[#f5f3f0]/45">
                    Contact page
                  </span>
                  <span className="mt-1.5 block text-xl font-light transition-colors group-hover:text-[#c6ad78]">
                    All ways to reach us
                  </span>
                </span>
                <ArrowUpRight className="h-5 w-5 flex-shrink-0 text-[#f5f3f0]/40 transition-colors group-hover:text-[#c6ad78]" />
              </Link>
            </div>
          </motion.div>

          {/* Right — form */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-120px" }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <form
              onSubmit={handleSubmit}
              className="border border-[#2a2a2a] bg-[#0c0c0c] p-5 sm:p-8 lg:p-14"
            >
              <p className="eyebrow mb-10 text-[#f5f3f0]/35">Project enquiry</p>

              <div className="space-y-9">
                <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
                  <div>
                    <label htmlFor="name" className={labelClass}>
                      Name *
                    </label>
                    <input
                      id="name"
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      className={inputClass}
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className={labelClass}>
                      Email *
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      className={inputClass}
                      placeholder="you@company.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="requirement" className={labelClass}>
                    What do you need? *
                  </label>
                  <select
                    id="requirement"
                    required
                    value={form.requirement}
                    onChange={(e) => update("requirement", e.target.value)}
                    className={`${inputClass} scheme-dark bg-[#0c0c0c]`}
                  >
                    <option
                      value=""
                      disabled
                      className="bg-charcoal text-off-white"
                    >
                      Select a service
                    </option>
                    {serviceOptions.map((option) => (
                      <option
                        key={option}
                        value={option}
                        className="bg-charcoal text-off-white"
                      >
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
                  <div>
                    <label htmlFor="budget" className={labelClass}>
                      Budget{" "}
                      <span className="text-[#f5f3f0]/30">(optional)</span>
                    </label>
                    <input
                      id="budget"
                      value={form.budget}
                      onChange={(e) => update("budget", e.target.value)}
                      className={inputClass}
                      placeholder="e.g. ₹75,000 – ₹1.5L"
                    />
                  </div>
                  <div>
                    <label htmlFor="timeline" className={labelClass}>
                      Timeline{" "}
                      <span className="text-[#f5f3f0]/30">(optional)</span>
                    </label>
                    <input
                      id="timeline"
                      value={form.timeline}
                      onChange={(e) => update("timeline", e.target.value)}
                      className={inputClass}
                      placeholder="e.g. Next 4 weeks"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className={labelClass}>
                    Message *
                  </label>
                  <textarea
                    id="message"
                    required
                    rows={4}
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    className={`${inputClass} resize-none`}
                    placeholder="Tell us about your project"
                  />
                </div>

                <button
                  type="submit"
                  className="group flex w-full items-center justify-center gap-3 bg-[#c6ad78] px-10 py-5 text-base font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f]"
                >
                  <MessageCircle className="h-5 w-5" />
                  Send via WhatsApp
                  <span
                    aria-hidden
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </button>

                <p className="type-meta text-center text-[#f5f3f0]/40">
                  {sent
                    ? "WhatsApp should have opened in a new tab. Nothing is sent without your confirmation."
                    : `This opens WhatsApp at ${brand.whatsappNumber} with your details pre-filled. Nothing is sent until you press send there.`}
                </p>
              </div>
            </form>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
