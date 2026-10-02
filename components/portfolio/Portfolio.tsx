'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { PortfolioProject } from '@/lib/data';
import ProjectMedia from './ProjectMedia';

export default function Portfolio({ projects }: { projects: PortfolioProject[] }) {
  const reduce = useReducedMotion();

  return (
    <section id="work" className="section-pad hairline">
      <div className="shell">
        {/* Section masthead — deliberately wide, not a narrow text column */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-120px' }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-gap grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end"
        >
          <div>
            <p className="eyebrow mb-7 text-[#c6ad78]">Selected Work</p>
            <h2 className="type-display">
              Real estate,
              <br />
              <span className="font-serif italic text-[#c6ad78]">presented properly.</span>
            </h2>
          </div>
          <p className="type-lead max-w-lg text-[#f5f3f0]/60 lg:pb-3">
            Four live websites, captured as built. Every frame below is the real site — open any
            one and browse what we shipped.
          </p>
        </motion.div>

        {/* Editorial grid: one column on mobile, two from tablet up. The imagery
            is sized to dominate each card, with metadata kept deliberately quiet. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-16 md:grid-cols-2 md:gap-x-10 md:gap-y-24 lg:gap-x-16 lg:gap-y-32">
          {projects.map((project, index) => (
            <motion.article
              key={project.id}
              initial={reduce ? false : { opacity: 0, y: 34 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-90px' }}
              transition={{
                duration: 0.8,
                delay: (index % 2) * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              /* Staggered second column keeps the grid from reading as a template */
              className={index % 2 === 1 ? 'md:mt-16 lg:mt-24' : ''}
            >
              <Link href={`/project/${project.id}`} className="group block">
                <ProjectMedia
                  src={project.cover}
                  alt={`${project.name} — ${project.category} website, ${project.location}`}
                  className="aspect-[16/10]"
                  sizes="(max-width: 768px) 100vw, (max-width: 1520px) 46vw, 660px"
                  /* The hero above is text-only, so when a visitor lands straight
                     on /#work (from the nav, or from a 404) this first cover is
                     the LCP. Eager-load that one; the rest stay lazy. */
                  priority={index === 0}
                />

                <div className="pt-7 md:pt-9">
                  <div className="mb-4 flex items-baseline gap-4">
                    <span className="eyebrow text-[#c6ad78]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-[#f5f3f0]/10" />
                    <span className="eyebrow text-[#f5f3f0]/40">
                      {project.category} · {project.location}
                    </span>
                  </div>

                  <h3 className="type-title transition-colors duration-300 group-hover:text-[#c6ad78]">
                    {project.name}
                  </h3>

                  <p className="type-body mt-4 max-w-xl text-[#f5f3f0]/55">
                    {project.tagline}
                  </p>

                  <span className="type-meta mt-6 inline-flex items-center gap-2 text-[#f5f3f0]/60 transition-colors duration-300 group-hover:text-[#c6ad78]">
                    View Project
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
