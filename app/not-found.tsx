import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import Navigation from '@/components/navigation/Navigation';
import Footer from '@/components/shared/Footer';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * Shown for any unrouted path, and for /project/<unknown-id> where the page
 * calls notFound(). Keeps the visitor inside the site rather than dropping them
 * on the framework default.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-[#0a0a0a]">
      <Navigation />

      <div className="shell flex flex-1 flex-col justify-center pt-32 pb-24">
        <p className="eyebrow mb-8 flex items-center gap-3 text-[#c6ad78]">
          <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
          404
        </p>

        <h1 className="type-display max-w-3xl">
          That page has
          <br />
          <span className="font-serif italic text-[#c6ad78]">moved on.</span>
        </h1>

        <p className="type-lead mt-8 max-w-xl text-[#f5f3f0]/60">
          The link you followed doesn&rsquo;t point anywhere. The work is still where it was.
        </p>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/#work"
            className="inline-flex items-center gap-2 bg-[#c6ad78] px-8 py-4 text-base font-medium text-[#0a0a0a] transition-colors duration-300 hover:bg-[#aa925f]"
          >
            <ArrowLeft className="h-4 w-4" />
            See the work
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 border border-[#2a2a2a] px-8 py-4 text-base font-medium text-[#f5f3f0] transition-colors duration-300 hover:border-[#c6ad78] hover:text-[#c6ad78]"
          >
            Start a project
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Footer />
    </main>
  );
}
