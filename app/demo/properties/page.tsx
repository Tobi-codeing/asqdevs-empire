import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import Navigation from "@/components/navigation/Navigation";
import Footer from "@/components/shared/Footer";
import ProjectMedia from "@/components/portfolio/ProjectMedia";
import Reveal from "@/components/shared/Reveal";
import { getActiveProperties } from "@/lib/data/store";

// The inventory can change from the admin at any time, so this page always
// reads the live shared set rather than a build-time snapshot.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demo Properties — Delhi Homes Showcase",
  description:
    "The fictional demo inventory behind the Delhi Homes WhatsApp and phone assistants.",
};

export default function DemoPropertiesPage() {
  const properties = getActiveProperties();

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0a0a]">
      <Navigation />

      <div className="pt-28">
        <header className="shell">
          <p className="eyebrow mb-6 flex items-center gap-3 text-[#c6ad78]">
            <span
              aria-hidden
              className="inline-block h-px w-10 bg-[#c6ad78]/60"
            />
            Delhi Homes · Demo inventory
          </p>
          <h1 className="type-hero max-w-4xl">
            Every listing the assistant can{" "}
            <span className="font-serif italic text-[#c6ad78]">
              actually send.
            </span>
          </h1>
          <p className="type-lead mt-8 max-w-2xl text-[#f5f3f0]/65">
            This is the fictional inventory the WhatsApp and phone demos match
            against. Each property below has a real detail page, and those pages
            are the exact links the assistant sends during a conversation.
          </p>
        </header>

        <section className="section-pad">
          <div className="shell grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property, i) => (
              <Reveal key={property.id} delay={i * 0.04}>
                <Link
                  href={property.detailPageUrl}
                  className="group flex h-full flex-col border border-[#1f1f1f] transition-colors hover:border-[#c6ad78]/50"
                >
                  <ProjectMedia
                    src={property.image}
                    alt={`${property.name} — ${property.bhk} BHK in ${property.location}`}
                    className="aspect-[16/10]"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                  <div className="flex flex-1 flex-col p-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="type-title transition-colors group-hover:text-[#c6ad78]">
                        {property.name}
                      </h2>
                      <span className="flex-shrink-0 text-lg font-medium text-[#c6ad78]">
                        {property.priceLabel}
                      </span>
                    </div>
                    <p className="type-meta mt-2 text-[#f5f3f0]/50">
                      {property.bhk} BHK {property.kind} · {property.location}
                    </p>
                    <p className="type-body mt-4 flex-1 text-[#f5f3f0]/60">
                      {property.summary}
                    </p>
                    <span className="type-meta mt-6 inline-flex items-center gap-2 text-[#c6ad78]">
                      View details
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="shell pb-24">
          <p className="type-meta max-w-3xl text-[#f5f3f0]/35">
            All inventory shown here is fictional and exists only to demonstrate
            the demo experience. Replace it with real inventory before launch.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
