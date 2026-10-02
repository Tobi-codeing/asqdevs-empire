// Portfolio projects shown in the Selected Work section.
//
// These are real, live client websites. The imagery in /public/projects/<id>/ is
// captured directly from each site by scripts/capture-portfolio.mjs — no
// mockups, no stand-in art. Copy is limited to what is actually on the sites;
// nothing here should be embellished with claims the projects do not make.
//
// The fictional inventory used inside the WhatsApp and phone demos lives
// separately in ./properties.ts and must stay out of this file.

export type ProjectImage = {
  src: string;
  alt: string;
};

export type PortfolioProject = {
  /** URL segment: /project/<id> */
  id: string;
  name: string;
  category: string;
  location: string;
  /** One-line description shown on the work grid card. */
  tagline: string;
  /** Opening paragraph on the case-study page. */
  overview: string;
  /** 16:10 crop of the site's own hero, used on the work grid. */
  cover: string;
  /** Taller hero crop used at the top of the case-study page. */
  hero: string;
  /** 3–5 large captures from down the live page, in page order. */
  gallery: ProjectImage[];
  /** Narrow-viewport capture, to show the responsive treatment. */
  mobile: { src: string; alt: string };
  /** Short explanation of what was built. */
  built: string;
  /** What the build includes, as a scannable list. */
  scope: string[];
  /** Project highlights. */
  highlights: string[];
  /** The exact live URL supplied by the client. */
  url: string;
};

export const portfolioProjects: PortfolioProject[] = [
  {
    id: "sahil-real-estate",
    name: "Sahil Real Estate",
    category: "Holiday Homes",
    location: "Dubai",
    tagline:
      "A Dubai holiday-homes platform built to be browsed — stays, destinations, guest reviews and a dedicated path for owners.",
    overview:
      "A short-let website for licensed holiday homes across Dubai. Visitors browse homes by destination, see what a stay actually includes, and property owners get a separate, self-contained route to list with an income estimate.",
    cover: "/projects/sahil-real-estate/cover.jpg",
    hero: "/projects/sahil-real-estate/hero.jpg",
    gallery: [
      {
        src: "/projects/sahil-real-estate/01.jpg",
        alt: "Featured holiday-home carousel with guest-favourite stays and ratings",
      },
      {
        src: "/projects/sahil-real-estate/02.jpg",
        alt: "Destinations section listing Dubai Marina, Downtown, Palm Jumeirah and JBR",
      },
      {
        src: "/projects/sahil-real-estate/03.jpg",
        alt: "Stay-experience section covering self check-in and included amenities",
      },
      {
        src: "/projects/sahil-real-estate/04.jpg",
        alt: "Property-owner section with an area-by-area income estimator",
      },
      {
        src: "/projects/sahil-real-estate/05.jpg",
        alt: "Enquiry section inviting owners to discuss their property",
      },
    ],
    mobile: {
      src: "/projects/sahil-real-estate/mobile.jpg",
      alt: "Sahil Real Estate homepage on a narrow mobile viewport",
    },
    built:
      "Two audiences, one clean split. Guests get a browse-first experience — homes, destinations, reviews and FAQs — while owners get their own section with an income estimator and a listing enquiry. Both paths end in the same place: a conversation.",
    scope: [
      "Homes carousel with guest ratings",
      "Destination-led browsing",
      "Stay details and self check-in notes",
      "Owner income estimator by area",
      "Reviews, FAQ and enquiry sections",
    ],
    highlights: [
      "Browsing treated as the primary action, not the booking form",
      "Separate guest and owner journeys on one site",
      "Warm, hospitality-led visual language",
      "Interactions kept light so imagery stays the focus",
    ],
    url: "https://sahil-real-estate.vercel.app/",
  },
  {
    id: "maison-noor",
    name: "Maison Noor",
    category: "Interior Architecture",
    location: "Dubai",
    tagline:
      "A studio site for a Dubai interior architecture and fit-out practice, built on restraint and full-bleed project imagery.",
    overview:
      "The website for an interior architecture, fit-out and design practice in Dubai. Project work leads, backed by a clear account of the studio's services and the four-stage process clients move through.",
    cover: "/projects/maison-noor/cover.jpg",
    hero: "/projects/maison-noor/hero.jpg",
    gallery: [
      {
        src: "/projects/maison-noor/01.jpg",
        alt: "Selected work section showing completed residential project photography",
      },
      {
        src: "/projects/maison-noor/02.jpg",
        alt: "Services section covering residential interior design and fit-out",
      },
      {
        src: "/projects/maison-noor/03.jpg",
        alt: "Four-stage process section, from site visit through to completion",
      },
      {
        src: "/projects/maison-noor/04.jpg",
        alt: "Journal section with notes on materials and designing for living",
      },
    ],
    mobile: {
      src: "/projects/maison-noor/mobile.jpg",
      alt: "Maison Noor homepage on a narrow mobile viewport",
    },
    built:
      "A quiet, gallery-led site that lets finished interiors carry the page. Large-format project work sits alongside a plain-spoken explanation of services and a fixed four-stage process, so a prospective client understands both the output and how the project will run.",
    scope: [
      "Full-bleed project gallery",
      "Studio introduction",
      "Services breakdown",
      "Four-stage process explainer",
      "Project enquiry section",
    ],
    highlights: [
      "Imagery given the space to be the argument",
      "Restrained typography and a light palette",
      "Process made explicit before the enquiry",
      "Slow, considered motion on scroll",
    ],
    url: "https://maison-noor-tau.vercel.app/",
  },
  {
    id: "azura",
    name: "Azura",
    category: "Property Advisory",
    location: "Dubai",
    tagline:
      "A private property office for Dubai — hand-selected homes, community guides and advisors behind every enquiry.",
    overview:
      "A property advisory site that positions itself as a private office rather than a listings portal. Curated homes, guided exploration of Dubai's key communities, a mortgage calculator and a named RERA-certified advisor for each enquiry.",
    cover: "/projects/azura/cover.jpg",
    hero: "/projects/azura/hero.jpg",
    gallery: [
      {
        src: "/projects/azura/01.jpg",
        alt: "Featured collection of hand-selected Dubai properties",
      },
      {
        src: "/projects/azura/02.jpg",
        alt: "Further featured listings with sale and rental filters",
      },
      {
        src: "/projects/azura/03.jpg",
        alt: "Communities section covering Palm Jumeirah and other Dubai addresses",
      },
      {
        src: "/projects/azura/04.jpg",
        alt: "Mortgage calculator section for UAE banks",
      },
      {
        src: "/projects/azura/05.jpg",
        alt: "Advisors section introducing the RERA-certified team",
      },
    ],
    mobile: {
      src: "/projects/azura/mobile.jpg",
      alt: "Azura homepage on a narrow mobile viewport",
    },
    built:
      "A considered, dark-toned site organised around a six-part journey — buy, rent, off-plan, areas, mortgage, contact. Listings are presented as a curated collection rather than an infinite feed, with community context and financing tools sitting alongside them.",
    scope: [
      "Curated property collection with filters",
      "Community and area guides",
      "Mortgage calculator",
      "Advisor profiles",
      "Client stories and enquiry forms",
    ],
    highlights: [
      "Advisory positioning rather than a listings feed",
      "Financing tools built into the browsing flow",
      "Named advisors instead of an anonymous form",
      "Dark, architectural visual language",
    ],
    url: "https://azura-tau.vercel.app/",
  },
  {
    id: "asquaredevs-real-estate",
    name: "ASquareDevs Real Estate",
    category: "Residential Development",
    location: "Gurugram",
    tagline:
      "A launch site for a private residential development, built around the architecture, the plans and the location.",
    overview:
      "A single-project development site for private residences in Sector 58, Gurugram. The page moves from the facade through the available residences, the plans, the location and a photography gallery in one continuous scroll.",
    cover: "/projects/asquaredevs-real-estate/cover.jpg",
    hero: "/projects/asquaredevs-real-estate/hero.jpg",
    gallery: [
      {
        src: "/projects/asquaredevs-real-estate/01.jpg",
        alt: "Facade detail of the residential towers",
      },
      {
        src: "/projects/asquaredevs-real-estate/02.jpg",
        alt: "Residences list showing available apartment types and sizes",
      },
      {
        src: "/projects/asquaredevs-real-estate/03.jpg",
        alt: "Location section mapping the site against nearby amenities",
      },
      {
        src: "/projects/asquaredevs-real-estate/04.jpg",
        alt: "Lifestyle section covering the shared amenities",
      },
      {
        src: "/projects/asquaredevs-real-estate/05.jpg",
        alt: "Photography gallery of the development",
      },
    ],
    mobile: {
      src: "/projects/asquaredevs-real-estate/mobile.jpg",
      alt: "ASquareDevs Real Estate homepage on a narrow mobile viewport",
    },
    built:
      "A long-form launch page for a single address. Residences are listed with sizes and availability, plans are presented as a first-class section, and the location is argued with distances rather than adjectives — all wrapped in a scroll-driven treatment of the building itself.",
    scope: [
      "Availability list by residence type",
      "Floor plans and areas",
      "Location and connectivity section",
      "Amenity breakdown",
      "Photography gallery",
    ],
    highlights: [
      "Scroll-driven architecture sequence",
      "Plans given the same weight as imagery",
      "Availability stated plainly, up front",
      "Long-form storytelling that stays navigable",
    ],
    url: "https://asquaredevs-realestate.vercel.app/",
  },
];

export function getProject(id: string) {
  return portfolioProjects.find((project) => project.id === id);
}

/** The next project in the set, wrapping around at the end. */
export function getNextProject(id: string) {
  const index = portfolioProjects.findIndex((project) => project.id === id);
  if (index === -1) return undefined;
  return portfolioProjects[(index + 1) % portfolioProjects.length];
}
