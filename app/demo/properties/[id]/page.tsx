import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BedDouble,
  CalendarDays,
  Check,
  MapPin,
  Maximize,
  Tag,
} from "lucide-react";
import Navigation from "@/components/navigation/Navigation";
import Footer from "@/components/shared/Footer";
import ProjectMedia from "@/components/portfolio/ProjectMedia";
import Reveal from "@/components/shared/Reveal";
import { CtaLink } from "@/components/shared/Cta";
import { getPropertyDetails } from "@/lib/properties/search";
import { PROPERTIES, type Property } from "@/lib/data/properties";

// Pre-render every property page in the demo inventory at build time.
export function generateStaticParams() {
  return PROPERTIES.map((property) => ({ id: property.id }));
}

// In this version of Next.js, `params` is a Promise.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const property = getPropertyDetails(id);
  if (!property) return { title: "Property not found" };

  return {
    title: `${property.name} — ${property.bhk} BHK in ${property.location}`,
    description: property.summary,
    openGraph: {
      title: `${property.name} — Delhi Homes`,
      description: property.summary,
      images: [{ url: property.gallery[0]?.src ?? property.image }],
    },
  };
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const property = getPropertyDetails(id);

  if (!property) notFound();

  const others = PROPERTIES.filter(
    (entry) => entry.id !== property.id && entry.location === property.location,
  ).slice(0, 2);

  const facts = [
    {
      icon: BedDouble,
      label: "Configuration",
      value: `${property.bhk} BHK ${property.kind}`,
    },
    {
      icon: MapPin,
      label: "Location",
      value: `${property.location}, ${property.city}`,
    },
    { icon: Tag, label: "Price", value: property.priceLabel },
    { icon: Maximize, label: "Furnishing", value: property.furnishing },
    { icon: CalendarDays, label: "Availability", value: property.availability },
    { icon: Check, label: "Type", value: property.kind },
  ];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0a0a]">
      <Navigation />

      <article className="pt-28">
        <div className="shell pb-12">
          <Link
            href="/#whatsapp"
            className="type-meta inline-flex items-center gap-2 text-[#f5f3f0]/50 transition-colors hover:text-[#c6ad78]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to the WhatsApp demo
          </Link>
        </div>

        {/* Header */}
        <header className="shell">
          <div className="grid gap-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-end lg:gap-20">
            <div>
              <p className="eyebrow mb-6 flex items-center gap-3 text-[#c6ad78]">
                <span
                  aria-hidden
                  className="inline-block h-px w-10 bg-[#c6ad78]/60"
                />
                Delhi Homes · Demo listing
              </p>
              <h1 className="type-hero break-words">{property.name}</h1>
            </div>

            <div className="lg:pb-3">
              <p className="eyebrow mb-4 text-[#f5f3f0]/40">
                {property.bhk} BHK {property.kind} · {property.location}
              </p>
              <p className="type-lead text-[#f5f3f0]/75">{property.summary}</p>
              <p className="mt-6 text-4xl font-medium text-[#c6ad78]">
                {property.priceLabel}
              </p>
            </div>
          </div>
        </header>

        {/* Hero image */}
        <section className="shell mt-12 lg:mt-16">
          <Reveal>
            <ProjectMedia
              src={property.gallery[0]?.src ?? property.image}
              alt={`${property.name} — ${property.gallery[0]?.alt ?? "primary view"}`}
              className="aspect-[16/10] lg:aspect-[16/9]"
              sizes="100vw"
              priority
              quality={86}
            />
          </Reveal>
        </section>

        {/* Facts + description */}
        <section className="section-pad hairline mt-20 lg:mt-28">
          <div className="shell grid gap-14 lg:grid-cols-[0.62fr_0.38fr] lg:gap-20">
            <Reveal>
              <h2 className="eyebrow mb-7 text-[#c6ad78]">Overview</h2>
              <p className="type-lead max-w-2xl text-[#f5f3f0]/80">
                {property.description}
              </p>

              <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="border-t border-[#1f1f1f] pt-5"
                  >
                    <p className="eyebrow mb-2 flex items-center gap-2 text-[#f5f3f0]/35">
                      <fact.icon className="h-3.5 w-3.5" />
                      {fact.label}
                    </p>
                    <p className="type-body text-[#f5f3f0]/80">{fact.value}</p>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Key details + amenities */}
            <Reveal delay={0.08}>
              <h2 className="eyebrow mb-7 text-[#f5f3f0]/40">Key details</h2>
              <ul className="mb-10">
                {property.keyDetails.map((detail) => (
                  <li
                    key={detail}
                    className="type-body flex items-start gap-3 border-b border-[#1f1f1f] py-4 text-[#f5f3f0]/70 first:border-t"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#c6ad78]" />
                    {detail}
                  </li>
                ))}
              </ul>

              <h2 className="eyebrow mb-5 text-[#f5f3f0]/40">Amenities</h2>
              <div className="flex flex-wrap gap-2.5">
                {property.amenities.map((amenity) => (
                  <span
                    key={amenity}
                    className="type-meta border border-[#2a2a2a] px-3.5 py-2 text-[#f5f3f0]/70"
                  >
                    {amenity}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* Gallery */}
        <section className="shell space-y-8 lg:space-y-16">
          {property.gallery.slice(1).map((image, i) => (
            <Reveal key={image.src} delay={i * 0.05}>
              <figure>
                <ProjectMedia
                  src={image.src}
                  alt={image.alt}
                  className={
                    i % 3 === 1
                      ? "aspect-[16/10] lg:mx-auto lg:w-[76%]"
                      : "aspect-[16/10] lg:aspect-[16/9]"
                  }
                  sizes={
                    i % 3 === 1 ? "(max-width: 1024px) 100vw, 76vw" : "100vw"
                  }
                />
                <figcaption className="type-meta mt-4 text-[#f5f3f0]/40">
                  {image.alt}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </section>

        {/* CTA — schedule visit */}
        <section className="shell mt-20 lg:mt-28">
          <Reveal>
            <div className="flex flex-col gap-8 border border-[#c6ad78]/40 bg-[#c6ad78]/[0.05] p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between lg:p-14">
              <div>
                <p className="eyebrow mb-4 text-[#c6ad78]">Next step</p>
                <h2 className="type-title max-w-2xl break-words">
                  Schedule a site visit for {property.name}.
                </h2>
                <p className="type-body mt-4 max-w-xl text-[#f5f3f0]/60">
                  Tell us when suits you and a Delhi Homes advisor will confirm
                  the slot — usually within the hour.
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-4">
                {/* Sends the visitor back into the WhatsApp demo, pre-armed with
                    this property so the conversation continues where it left off. */}
                <CtaLink
                  href={`/?property=${property.id}#whatsapp`}
                  arrow
                  size="lg"
                >
                  Schedule visit
                </CtaLink>
                <CtaLink href="/#contact" variant="outline" size="lg">
                  Talk to an advisor
                </CtaLink>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Other listings in the same locality */}
        {others.length > 0 && (
          <section className="section-pad hairline mt-20 lg:mt-28">
            <div className="shell">
              <h2 className="eyebrow mb-9 text-[#c6ad78]">
                Other listings in {property.location}
              </h2>
              <div className="grid gap-6 sm:grid-cols-2">
                {others.map((other: Property) => (
                  <Link
                    key={other.id}
                    href={other.detailPageUrl}
                    className="group flex items-center justify-between gap-6 border border-[#1f1f1f] p-6 transition-colors hover:border-[#c6ad78]/50"
                  >
                    <span className="min-w-0">
                      <span className="type-title block truncate transition-colors group-hover:text-[#c6ad78]">
                        {other.name}
                      </span>
                      <span className="type-meta mt-2 block text-[#f5f3f0]/50">
                        {other.bhk} BHK {other.kind} · {other.priceLabel}
                      </span>
                    </span>
                    <ArrowUpRight className="h-5 w-5 flex-shrink-0 text-[#f5f3f0]/40 transition-all group-hover:text-[#c6ad78]" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="shell mt-16 lg:mt-20">
          <Reveal>
            <p className="type-meta max-w-3xl text-[#f5f3f0]/35">
              This is a fictional demo listing from the Delhi Homes showcase
              inventory. It contains no real inventory data and is not an offer
              to sell.
            </p>
          </Reveal>
        </section>
      </article>

      <Footer />
    </main>
  );
}
