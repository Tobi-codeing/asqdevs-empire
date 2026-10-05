"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { brand } from "@/lib/data";

const links = [
  { href: "/#work", label: "Work" },
  { href: "/#whatsapp", label: "WhatsApp" },
  { href: "/#phone", label: "AI Receptionist" },
  { href: "/#contact", label: "Contact" },
  { href: "/admin", label: "Admin" },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || menuOpen
          ? "border-b border-[#2a2a2a] bg-[#0a0a0a]/90 backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-20 items-center justify-between">
        <Link
          href="/"
          className="text-base font-semibold tracking-[0.12em] transition-colors hover:text-[#c6ad78] sm:text-lg"
        >
          {brand.name}
        </Link>

        <nav
          className="hidden items-center gap-10 md:flex"
          aria-label="Primary"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#f5f3f0]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/#contact"
            className="type-meta hidden bg-[#c6ad78] px-6 py-3 font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f] md:inline-block"
          >
            Start a Project
          </Link>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-11 w-11 items-center justify-center text-[#f5f3f0] md:hidden"
          >
            {menuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden border-t border-[#2a2a2a] bg-[#0a0a0a]/95 backdrop-blur-md md:hidden"
            aria-label="Mobile"
          >
            <div className="flex flex-col px-6 py-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-[#1f1f1f] py-5 text-lg text-[#f5f3f0]/80 transition-colors hover:text-[#c6ad78]"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/#contact"
                onClick={() => setMenuOpen(false)}
                className="mt-6 bg-[#c6ad78] px-5 py-4 text-center text-sm font-medium text-[#0a0a0a]"
              >
                Start a Project
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
