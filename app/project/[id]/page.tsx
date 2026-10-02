import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MoveRight } from "lucide-react";
import Navigation from "@/components/navigation/Navigation";
import Footer from "@/components/shared/Footer";
import ProjectMedia from "@/components/portfolio/ProjectMedia";
import { CtaLink } from "@/components/shared/Cta";
import Reveal from "@/components/shared/Reveal";
import { getNextProject, getProject, portfolioProjects } from "@/lib/data";

// Pre-render every project page at build time.
export function generateStaticParams() {
  return portfolioProjects.map((project) => ({ id: project.id }));
}

// In this version of Next.js, `params` is a Promise.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return { title: "Project not found" };

  return {
    title: `${project.name} — ${project.category}, ${project.location}`,
    description: project.tagline,
    openGraph: {
      title: `${project.name} — ASQDEVS EMPIRE`,
      description: project.tagline,
      images: [{ url: project.cover, width: 1440, height: 900 }],
    },
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProject(id);

  if (!project) notFound();

  const next = getNextProject(project.id);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0a0a]">
      <Navigation />

      <article className="pt-28">
        {/* Back */}
        <div className="shell pb-12">
          <Link
            href="/#work"
            className="type-meta inline-flex items-center gap-2 text-[#f5f3f0]/50 transition-colors hover:text-[#c6ad78]"
          >
            <ArrowLeft className="h-4 w-4" />
            All work
          </Link>
        </div>

        {/* Case-study header */}
        <header className="shell">
          <div className="grid gap-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-end lg:gap-20">
            <div>
              <p className="eyebrow mb-6 flex items-center gap-3 text-[#c6ad78]">
                <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
                Project
              </p>
              <h1 className="type-hero break-words">{project.name}</h1>
            </div>

            <div className="lg:pb-3">
              <p className="eyebrow mb-4 text-[#f5f3f0]/40">
                {project.category} · {project.location}
              </p>
              <p className="type-lead text-[#f5f3f0]/75">{project.tagline}</p>
            </div>
          </div>
        </header>

        {/* Hero image */}
        <section className="shell mt-12 lg:mt-16">
          <Reveal>
            <ProjectMedia
              src={project.hero}
              alt={`${project.name} — homepage`}
              className="aspect-[16/10] lg:aspect-[16/9]"
              sizes="100vw"
              priority
              quality={86}
            />
          </Reveal>
        </section>

        {/* Overview */}
        <section className="section-pad hairline mt-20 lg:mt-28">
          <div className="shell grid gap-10 lg:grid-cols-[0.32fr_0.68fr] lg:gap-20">
            <Reveal>
              <h2 className="eyebrow text-[#f5f3f0]/40">Overview</h2>
            </Reveal>
            <Reveal delay={0.06}>
              <p className="type-lead max-w-3xl text-[#f5f3f0]/80">{project.overview}</p>
            </Reveal>
          </div>
        </section>

        {/* Gallery — large, alternating widths so it reads as a designed page */}
        <section className="shell space-y-8 lg:space-y-16">
          {project.gallery.map((image, i) => (
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
                  sizes={i % 3 === 1 ? "(max-width: 1024px) 100vw, 76vw" : "100vw"}
                />
                <figcaption className="type-meta mt-4 text-[#f5f3f0]/40">
                  {image.alt}
                </figcaption>
              </figure>
            </Reveal>
          ))}

          {/* The narrow-viewport treatment of the same site */}
          <Reveal>
            <figure className="grid items-center gap-8 border-t border-[#1f1f1f] pt-10 lg:grid-cols-[0.32fr_0.68fr] lg:gap-20 lg:pt-14">
              <figcaption>
                <p className="eyebrow mb-4 text-[#c6ad78]">Responsive</p>
                <p className="type-body max-w-xs text-[#f5f3f0]/60">
                  The same page on a narrow viewport — the layout reflows rather than simply
                  scaling down.
                </p>
              </figcaption>
              <ProjectMedia
                src={project.mobile.src}
                alt={project.mobile.alt}
                className="aspect-[430/932] w-full max-w-[320px]"
                sizes="(max-width: 1024px) 100vw, 320px"
              />
            </figure>
          </Reveal>
        </section>

        {/* What we built */}
        <section className="section-pad hairline mt-20 lg:mt-32">
          <div className="shell">
            <Reveal className="masthead-gap max-w-3xl">
              <p className="eyebrow mb-7 text-[#c6ad78]">What we built</p>
              <h2 className="type-display">
                The thinking behind{" "}
                <span className="font-serif italic text-[#c6ad78]">the build.</span>
              </h2>
            </Reveal>

            <div className="grid gap-14 lg:grid-cols-[0.6fr_0.4fr] lg:gap-20">
              <Reveal>
                <p className="type-lead max-w-2xl text-[#f5f3f0]/75">{project.built}</p>
              </Reveal>

              <Reveal delay={0.08}>
                <h3 className="eyebrow mb-7 text-[#f5f3f0]/40">Included</h3>
                <ul>
                  {project.scope.map((item) => (
                    <li
                      key={item}
                      className="type-body border-b border-[#1f1f1f] py-4 text-[#f5f3f0]/70 first:border-t"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            {/* Project highlights */}
            <div className="mt-16 border-t border-[#1f1f1f] pt-12 lg:mt-24 lg:pt-16">
              <Reveal>
                <h3 className="eyebrow mb-9 text-[#c6ad78]">Project highlights</h3>
              </Reveal>
              <div className="grid gap-x-14 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
                {project.highlights.map((item, i) => (
                  <Reveal key={item} delay={i * 0.05}>
                    <p className="type-body text-[#f5f3f0]/70">{item}</p>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Live website CTA */}
        <section className="shell">
          <Reveal>
            <div className="flex flex-col gap-8 border border-[#c6ad78]/40 bg-[#c6ad78]/[0.05] p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between lg:p-14">
              <div>
                <p className="eyebrow mb-4 text-[#c6ad78]">Live website</p>
                <h2 className="type-title max-w-2xl break-words">
                  See {project.name} as a customer would.
                </h2>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-4">
                {/* The exact live URL, opened in a new tab. */}
                <CtaLink href={project.url} external arrow size="lg">
                  Visit Live Website
                </CtaLink>
                <CtaLink href="/#contact" variant="outline" size="lg">
                  Start a similar project
                </CtaLink>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Next project */}
        {next && (
          <section className="shell mt-20 lg:mt-28">
            <Reveal>
              <Link
                href={`/project/${next.id}`}
                className="group flex items-center justify-between gap-6 border-t border-[#1f1f1f] pt-8"
              >
                <span className="flex items-baseline gap-4">
                  <span className="eyebrow text-[#f5f3f0]/40">Next Project</span>
                  <span className="type-title transition-colors duration-300 group-hover:text-[#c6ad78]">
                    {next.name}
                  </span>
                </span>
                <MoveRight className="h-6 w-6 flex-shrink-0 text-[#f5f3f0]/40 transition-all duration-300 group-hover:translate-x-1 group-hover:text-[#c6ad78]" />
              </Link>
            </Reveal>
          </section>
        )}

        {/* Back to the full portfolio */}
        <section className="shell mt-16 lg:mt-20">
          <Reveal>
            <Link
              href="/#work"
              className="type-meta inline-flex items-center gap-2 text-[#f5f3f0]/50 transition-colors hover:text-[#c6ad78]"
            >
              <ArrowUpRight className="h-4 w-4" />
              See all four projects
            </Link>
          </Reveal>
        </section>
      </article>

      <Footer />
    </main>
  );
}
