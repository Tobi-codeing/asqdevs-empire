import type { Metadata } from 'next';
import Navigation from '@/components/navigation/Navigation';
import Contact from '@/components/contact/Contact';
import Footer from '@/components/shared/Footer';
import { brand } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Start a project with ${brand.name} — real-estate websites, WhatsApp automation and AI phone reception.`,
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a]">
      <Navigation />
      <div className="shell pt-40 pb-20 lg:pt-48 lg:pb-24">
        <p className="eyebrow mb-8 flex items-center gap-3 text-[#c6ad78]">
          <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
          {brand.name}
        </p>
        <h1 className="type-hero max-w-5xl">
          Let&apos;s build the systems your{' '}
          <span className="font-serif italic text-[#c6ad78]">sales team relies on.</span>
        </h1>
        <p className="type-lead mt-9 max-w-2xl text-[#f5f3f0]/60">{brand.tagline}</p>
      </div>
      <Contact />
      <Footer />
    </main>
  );
}
