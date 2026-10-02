import Link from 'next/link';
import { brand } from '@/lib/data';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="hairline">
      <div className="shell py-16 lg:py-20">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-md">
            <p className="text-2xl font-semibold tracking-[0.1em]">{brand.name}</p>
            <p className="type-body mt-4 text-[#f5f3f0]/50">{brand.tagline}</p>
          </div>

          <nav className="flex flex-wrap gap-x-10 gap-y-4" aria-label="Footer">
            <Link href="/#work" className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#c6ad78]">
              Work
            </Link>
            <Link href="/#whatsapp" className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#c6ad78]">
              WhatsApp
            </Link>
            <Link href="/#phone" className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#c6ad78]">
              AI Receptionist
            </Link>
            <Link href="/contact" className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#c6ad78]">
              Contact
            </Link>
            <a
              href={brand.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="type-meta text-[#f5f3f0]/60 transition-colors hover:text-[#c6ad78]"
            >
              {brand.whatsappNumber}
            </a>
          </nav>
        </div>

        <div className="type-meta mt-14 flex flex-col gap-3 border-t border-[#1f1f1f] pt-8 text-[#f5f3f0]/40 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}. All rights reserved.
          </p>
          <p>
            Interactive demos are simulated. Property details shown are fictional examples.
          </p>
        </div>
      </div>
    </footer>
  );
}
