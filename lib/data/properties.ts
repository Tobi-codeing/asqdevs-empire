// Fictional demo inventory — the single source of truth for property matching.
// These are NOT real listings. Replace with real inventory before launch.

export type PropertyImage = {
  src: string;
  alt: string;
};

export type Property = {
  id: string;
  name: string;
  bhk: number;
  kind: "Apartment" | "Villa" | "Studio" | "Penthouse" | "Builder Floor";
  location: string;
  city: string;
  price: number; // in rupees
  priceLabel: string;
  furnishing: "Unfurnished" | "Semi-furnished" | "Furnished";
  availability: string;
  amenities: string[];
  /** Cover image, shown on cards. */
  image: string;
  /** Larger crops used on the property detail page, in page order. */
  gallery: PropertyImage[];
  /** Short marketing line. */
  summary: string;
  /** Longer body copy for the detail page. */
  description: string;
  /**
   * Canonical path to this property's detail page on the showcase site. Every
   * link the assistant sends is derived from this — links are never authored
   * by hand in the conversation.
   */
  detailPageUrl: string;
  /**
   * Named aspects the assistant may surface as "key details". Sourced from the
   * structured fields above so nothing is invented.
   */
  keyDetails: string[];
};

export const PROPERTIES: Property[] = [
  {
    id: "dwarka-heights",
    name: "Dwarka Heights",
    bhk: 2,
    kind: "Apartment",
    location: "Dwarka",
    city: "Delhi",
    price: 9_200_000,
    priceLabel: "₹92L",
    furnishing: "Semi-furnished",
    availability: "Ready to move",
    amenities: ["Covered parking", "Lift", "24x7 security", "Power backup"],
    image: "/properties/dwarka-heights.jpg",
    gallery: [
      {
        src: "/projects/asquaredevs-real-estate/03.jpg",
        alt: "Living area with natural light",
      },
      {
        src: "/projects/asquaredevs-real-estate/04.jpg",
        alt: "Open-plan kitchen and dining",
      },
      {
        src: "/projects/asquaredevs-real-estate/05.jpg",
        alt: "Bedroom with built-in wardrobe",
      },
    ],
    summary:
      "A well-connected 2 BHK in Dwarka with covered parking and 24x7 security.",
    description:
      "A practical 2 BHK in the heart of Dwarka, a short walk from the metro and daily conveniences. The semi-furnished layout keeps upfront costs low while still giving you a lift, covered parking and 24x7 security in the same society.",
    detailPageUrl: "/demo/properties/dwarka-heights",
    keyDetails: [
      "Vastu-compliant layout",
      "East-facing balcony",
      "Society with 24x7 security",
    ],
  },
  {
    id: "sky-residency",
    name: "Sky Residency",
    bhk: 2,
    kind: "Apartment",
    location: "Dwarka",
    city: "Delhi",
    price: 9_600_000,
    priceLabel: "₹96L",
    furnishing: "Furnished",
    availability: "Ready to move",
    amenities: ["Covered parking", "Gym", "Clubhouse", "Power backup"],
    image: "/properties/sky-residency.jpg",
    gallery: [
      {
        src: "/projects/azura/01.jpg",
        alt: "Living room in a furnished 2 BHK",
      },
      {
        src: "/projects/azura/02.jpg",
        alt: "Complex clubhouse and shared amenities",
      },
      { src: "/projects/azura/03.jpg", alt: "Bedroom with built-in storage" },
    ],
    summary:
      "A furnished 2 BHK in Dwarka with a gym and clubhouse in the complex.",
    description:
      "A move-in-ready 2 BHK that comes fully furnished, so you can settle in without buying a thing. Residents get a gym, a clubhouse and covered parking inside a gated complex in Dwarka.",
    detailPageUrl: "/demo/properties/sky-residency",
    keyDetails: [
      "Fully furnished",
      "Gym and clubhouse in complex",
      "Gated society",
    ],
  },
  {
    id: "dwarka-lofts",
    name: "Dwarka Studio Lofts",
    bhk: 1,
    kind: "Studio",
    location: "Dwarka",
    city: "Delhi",
    price: 5_200_000,
    priceLabel: "₹52L",
    furnishing: "Furnished",
    availability: "Ready to move",
    amenities: ["Lift", "Security", "Power backup"],
    image: "/properties/dwarka-lofts.jpg",
    gallery: [
      {
        src: "/projects/maison-noor/01.jpg",
        alt: "Compact furnished studio interiors",
      },
      {
        src: "/projects/maison-noor/02.jpg",
        alt: "Studio kitchenette and dining nook",
      },
      {
        src: "/projects/maison-noor/03.jpg",
        alt: "Sleeping area with storage",
      },
    ],
    summary:
      "A compact furnished studio in Dwarka, suited to first-time buyers.",
    description:
      "An efficient furnished studio in Dwarka that works well as a first home or a low-maintenance let-out. Lift, security and power backup are in place, and the metro is close by.",
    detailPageUrl: "/demo/properties/dwarka-lofts",
    keyDetails: ["Ideal first home", "Low maintenance", "Close to the metro"],
  },
  {
    id: "green-valley-estate",
    name: "Green Valley Estate",
    bhk: 3,
    kind: "Apartment",
    location: "Dwarka",
    city: "Delhi",
    price: 13_500_000,
    priceLabel: "₹1.35Cr",
    furnishing: "Semi-furnished",
    availability: "Ready to move",
    amenities: [
      "Covered parking",
      "Gym",
      "Landscaped garden",
      "Kids play area",
    ],
    image: "/properties/green-valley.jpg",
    gallery: [
      {
        src: "/projects/asquaredevs-real-estate/01.jpg",
        alt: "Spacious living area in a 3 BHK",
      },
      {
        src: "/projects/asquaredevs-real-estate/02.jpg",
        alt: "Landscaped gardens within the complex",
      },
      {
        src: "/projects/asquaredevs-real-estate/03.jpg",
        alt: "Dining space adjoining the kitchen",
      },
    ],
    summary:
      "A spacious 3 BHK in Dwarka with landscaped gardens and a kids play area.",
    description:
      "A generous 3 BHK built for family living, set in a Dwarka society with landscaped gardens and a dedicated kids play area. Semi-furnished and ready to move.",
    detailPageUrl: "/demo/properties/green-valley-estate",
    keyDetails: ["Family-sized 3 BHK", "Landscaped gardens", "Kids play area"],
  },
  {
    id: "rohini-enclave",
    name: "Rohini Enclave",
    bhk: 2,
    kind: "Apartment",
    location: "Rohini",
    city: "Delhi",
    price: 7_800_000,
    priceLabel: "₹78L",
    furnishing: "Unfurnished",
    availability: "Ready to move",
    amenities: ["Covered parking", "Lift", "Security"],
    image: "/properties/rohini-enclave.jpg",
    gallery: [
      {
        src: "/projects/sahil-real-estate/01.jpg",
        alt: "Living area of a value 2 BHK",
      },
      {
        src: "/projects/sahil-real-estate/02.jpg",
        alt: "Bedroom with adjoining balcony",
      },
      {
        src: "/projects/sahil-real-estate/03.jpg",
        alt: "Building entrance and parking area",
      },
    ],
    summary: "A value 2 BHK in Rohini with covered parking and a lift.",
    description:
      "A sensibly priced 2 BHK in Rohini with covered parking, a lift and security — an easy entry point into the locality without stretching the budget.",
    detailPageUrl: "/demo/properties/rohini-enclave",
    keyDetails: ["Value pricing", "Covered parking", "Ready to move"],
  },
  {
    id: "rohini-heights",
    name: "Rohini Heights",
    bhk: 3,
    kind: "Builder Floor",
    location: "Rohini",
    city: "Delhi",
    price: 10_500_000,
    priceLabel: "₹1.05Cr",
    furnishing: "Semi-furnished",
    availability: "Ready to move",
    amenities: ["Parking", "Lift", "Power backup"],
    image: "/properties/rohini-heights.jpg",
    gallery: [
      {
        src: "/projects/sahil-real-estate/04.jpg",
        alt: "Builder-floor living area",
      },
      {
        src: "/projects/sahil-real-estate/05.jpg",
        alt: "Bedroom with dedicated parking below",
      },
      { src: "/projects/azura/04.jpg", alt: "Independent floor entrance" },
    ],
    summary:
      "A semi-furnished 3 BHK builder floor in Rohini with dedicated parking.",
    description:
      "An independent 3 BHK builder floor in Rohini that gives you more space and privacy than a typical apartment, with dedicated parking and a lift.",
    detailPageUrl: "/demo/properties/rohini-heights",
    keyDetails: ["Independent floor", "Dedicated parking", "Semi-furnished"],
  },
  {
    id: "south-delhi-grand",
    name: "South Delhi Grand",
    bhk: 3,
    kind: "Apartment",
    location: "South Delhi",
    city: "Delhi",
    price: 18_500_000,
    priceLabel: "₹1.85Cr",
    furnishing: "Furnished",
    availability: "Ready to move",
    amenities: ["Covered parking", "Gym", "Swimming pool", "Concierge"],
    image: "/properties/south-delhi-grand.jpg",
    gallery: [
      {
        src: "/projects/maison-noor/01.jpg",
        alt: "Furnished living room in South Delhi",
      },
      { src: "/projects/maison-noor/04.jpg", alt: "Swimming pool and deck" },
      {
        src: "/projects/asquaredevs-real-estate/02.jpg",
        alt: "Landscaped common areas",
      },
    ],
    summary:
      "A furnished 3 BHK in South Delhi with a pool and concierge service.",
    description:
      "A premium furnished 3 BHK in South Delhi with a swimming pool, gym and concierge service — a turnkey home for buyers who want everything handled.",
    detailPageUrl: "/demo/properties/south-delhi-grand",
    keyDetails: [
      "Premium South Delhi address",
      "Pool and gym",
      "Concierge service",
    ],
  },
  {
    id: "saket-residences",
    name: "Saket Residences",
    bhk: 4,
    kind: "Penthouse",
    location: "South Delhi",
    city: "Delhi",
    price: 22_000_000,
    priceLabel: "₹2.2Cr",
    furnishing: "Furnished",
    availability: "Ready to move",
    amenities: ["Covered parking", "Terrace", "Concierge", "Power backup"],
    image: "/properties/saket-residences.jpg",
    gallery: [
      { src: "/projects/maison-noor/02.jpg", alt: "Penthouse living space" },
      {
        src: "/projects/maison-noor/03.jpg",
        alt: "Private terrace with seating",
      },
      { src: "/projects/azura/05.jpg", alt: "Furnished bedroom suite" },
    ],
    summary:
      "A furnished penthouse in Saket with a private terrace and concierge.",
    description:
      "A furnished 4 BHK penthouse in Saket with a private terrace, concierge and power backup. The largest home in the current inventory, built for buyers who want space and privacy.",
    detailPageUrl: "/demo/properties/saket-residences",
    keyDetails: [
      "Private terrace",
      "Concierge service",
      "Largest home in inventory",
    ],
  },
  {
    id: "noida-skyline",
    name: "Noida Skyline",
    bhk: 3,
    kind: "Apartment",
    location: "Noida",
    city: "Noida",
    price: 12_500_000,
    priceLabel: "₹1.25Cr",
    furnishing: "Semi-furnished",
    availability: "Under construction",
    amenities: ["Covered parking", "Gym", "Pool", "Metro nearby"],
    image: "/properties/noida-skyline.jpg",
    gallery: [
      { src: "/projects/azura/01.jpg", alt: "Noida apartment living area" },
      {
        src: "/projects/azura/04.jpg",
        alt: "Pool and clubhouse planned for the complex",
      },
      {
        src: "/projects/azura/05.jpg",
        alt: "Metro connectivity near the site",
      },
    ],
    summary:
      "A semi-furnished 3 BHK in Noida close to the metro, under construction.",
    description:
      "A semi-furnished 3 BHK in Noida minutes from the metro, currently under construction. Buying off-plan here means an early price and a say in the finishing.",
    detailPageUrl: "/demo/properties/noida-skyline",
    keyDetails: ["Under construction", "Metro nearby", "Pool and gym planned"],
  },
  {
    id: "gurugram-vista",
    name: "Gurugram Vista",
    bhk: 4,
    kind: "Villa",
    location: "Gurugram",
    city: "Gurugram",
    price: 24_000_000,
    priceLabel: "₹2.4Cr",
    furnishing: "Semi-furnished",
    availability: "Ready to move",
    amenities: ["Private parking", "Garden", "Clubhouse", "Security"],
    image: "/properties/gurugram-vista.jpg",
    gallery: [
      {
        src: "/projects/asquaredevs-real-estate/01.jpg",
        alt: "Villa living room opening to the garden",
      },
      {
        src: "/projects/asquaredevs-real-estate/02.jpg",
        alt: "Private garden and outdoor seating",
      },
      { src: "/projects/sahil-real-estate/01.jpg", alt: "Villa bedroom suite" },
    ],
    summary: "A semi-furnished 4 BHK villa in Gurugram with a private garden.",
    description:
      "A semi-furnished 4 BHK villa in Gurugram with its own garden, private parking and clubhouse access — the largest format in the inventory for buyers who want a house rather than a flat.",
    detailPageUrl: "/demo/properties/gurugram-vista",
    keyDetails: ["Private garden", "Independent villa", "Clubhouse access"],
  },
];

/** Known localities used by the extractor and the search tool. */
export const KNOWN_LOCATIONS = Array.from(
  new Set(PROPERTIES.map((p) => p.location)),
);

/** Canonical detail-page path for a property — never authored by hand elsewhere. */
export function propertyDetailUrl(property: Pick<Property, "id">): string {
  return `/demo/properties/${property.id}`;
}

/** Absolute detail-page URL, for anywhere a full link is needed. */
export function absolutePropertyUrl(property: Pick<Property, "id">): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return `${base}${propertyDetailUrl(property)}`;
}

export function propertiesByIds(ids: string[]): Property[] {
  return ids
    .map((id) => PROPERTIES.find((property) => property.id === id))
    .filter((p): p is Property => Boolean(p));
}

/** A compact price range label, e.g. "₹90L–₹1Cr", always ordered low to high. */
export function formatPriceBand(rupees: number[]): string | undefined {
  if (!rupees.length) return undefined;
  const low = Math.min(...rupees);
  const high = Math.max(...rupees);
  return low === high
    ? formatBudget(low)
    : `${formatBudget(low)}–${formatBudget(high)}`;
}

export function formatBudget(rupees: number): string {
  if (rupees >= 10_000_000) {
    const cr = rupees / 10_000_000;
    return `₹${Number(cr.toFixed(2))}Cr`;
  }
  if (rupees >= 100_000) {
    const l = rupees / 100_000;
    return `₹${Number(l.toFixed(l < 10 ? 1 : 0))}L`;
  }
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function formatBudgetRange(min: number, max: number): string {
  if (min === max) return formatBudget(min);
  return `${formatBudget(min)}–${formatBudget(max)}`;
}

export function formatBudgetPretty(value?: number | null): string | undefined {
  if (value == null) return undefined;
  return formatBudget(value);
}
