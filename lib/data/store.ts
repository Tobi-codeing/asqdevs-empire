/**
 * Server-side property store — the persistence layer for the single source of
 * truth.
 *
 * It loads the hardcoded seed inventory plus any admin-added properties
 * persisted in `data/inventory.json`, then hydrates the isomorphic
 * `lib/data/inventory.ts` cache with the merged, active set. Every consumer —
 * WhatsApp, Phone AI, matching, property pages, admin — reads the SAME active
 * set from that cache; nothing keeps its own array.
 *
 * This module is server-only (it uses `node:fs`). It is imported by the API
 * routes and server components that need to read or mutate inventory, and
 * importing it hydrates the shared cache for the whole process. Shared library
 * code must import `lib/data/inventory` instead, never this file, so the store
 * never leaks into the browser bundle.
 *
 * Mutations are performed only through the admin API routes, so the cache and
 * the JSON file can never disagree.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { absoluteUrl } from "@/lib/site";
import { PROPERTIES as SEED_PROPERTIES } from "./properties";
import {
  getActiveProperties as activeInventory,
  setActiveInventory,
} from "./inventory";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type PropertyStatus = "active" | "inactive" | "sold";

export type PropertyImage = {
  src: string;
  alt: string;
};

export type StoredProperty = {
  id: string;
  name: string;
  bhk: number;
  kind: "Apartment" | "Villa" | "Studio" | "Penthouse" | "Builder Floor";
  location: string;
  city: string;
  price: number;
  /** Optional range the single `price` is derived from, for the admin form. */
  priceMin?: number;
  priceMax?: number;
  priceLabel: string;
  furnishing: "Unfurnished" | "Semi-furnished" | "Furnished";
  availability: string;
  amenities: string[];
  image: string;
  gallery: PropertyImage[];
  summary: string;
  description: string;
  detailPageUrl: string;
  keyDetails: string[];
  status: PropertyStatus;
  /** Whether this came from admin (true) or seed data (false). */
  adminAdded: boolean;
  featured?: boolean;
  area?: string;
  parking?: string;
  createdAt: string;
  updatedAt: string;
};

/** The shape returned to consumers — the shared `Property` type plus status. */
export type Property = StoredProperty;

export type CreatePropertyInput = {
  name: string;
  location: string;
  city: string;
  bhk: number;
  kind: StoredProperty["kind"];
  price: number;
  priceMin?: number;
  priceMax?: number;
  furnishing?: StoredProperty["furnishing"];
  availability?: string;
  amenities?: string[];
  summary?: string;
  description?: string;
  /** Image URLs, in display order. The first becomes the cover image. */
  images?: string[];
  status?: PropertyStatus;
  featured?: boolean;
  area?: string;
  parking?: string;
};

export type UpdatePropertyInput = Partial<CreatePropertyInput>;

/* -------------------------------------------------------------------------- */
/*  Storage                                                                   */
/* -------------------------------------------------------------------------- */

const DATA_DIR = join(process.cwd(), "data");
const INVENTORY_FILE = join(DATA_DIR, "inventory.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** The seed inventory, converted once to the stored shape. */
const SEED_STORED: StoredProperty[] = SEED_PROPERTIES.map((p) => ({
  ...p,
  // The seed's `image` field points at cover files that are not shipped; the
  // gallery entries are the real, existing assets, so the cover is derived from
  // the first of those rather than rendered as a broken image.
  image: p.gallery?.[0]?.src ?? p.image,
  status: "active" as PropertyStatus,
  adminAdded: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));

/* -------------------------------------------------------------------------- */
/*  In-memory store                                                           */
/* -------------------------------------------------------------------------- */

/** Admin-added / admin-edited properties, loaded from disk. */
let adminProperties: StoredProperty[] = [];

/** The merged set (seed + admin overrides), recomputed on every change. */
let allProperties: StoredProperty[] = SEED_STORED;

let loaded = false;

function persist() {
  ensureDataDir();
  writeFileSync(INVENTORY_FILE, JSON.stringify(adminProperties, null, 2), "utf-8");
  recompute();
}

/** Recompute the merged set and publish it to the shared inventory cache. */
function recompute() {
  const seedIds = new Set(SEED_STORED.map((p) => p.id));
  const adminOverrides = new Set(
    adminProperties.filter((p) => seedIds.has(p.id)).map((p) => p.id),
  );
  allProperties = [
    ...SEED_STORED.filter((p) => !adminOverrides.has(p.id)),
    ...adminProperties,
  ];
  setActiveInventory(allProperties);
}

function load() {
  if (loaded) return;
  loaded = true;

  ensureDataDir();

  try {
    if (existsSync(INVENTORY_FILE)) {
      const raw = readFileSync(INVENTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        adminProperties = parsed as StoredProperty[];
      }
    }
  } catch {
    // File missing or corrupt — start fresh from the seed inventory.
    adminProperties = [];
  }

  recompute();
}

// Importing this module hydrates the shared cache for the whole process, so a
// server route that touches inventory gets the admin changes even if it only
// imported the shared library indirectly.
load();

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ALL active properties — seed + admin-added, filtered to active status.
 *
 * Delegates to the shared cache so the server and the browser read one set.
 */
export function getActiveProperties(): Property[] {
  load();
  // The cache is typed against the static seed shape; after hydration it holds
  // the stored shape (every entry has a status), so this is the same objects.
  return activeInventory() as StoredProperty[];
}

/** ALL properties including inactive, for the admin overview. */
export function getAllProperties(): Property[] {
  load();
  return allProperties;
}

/** Get one property by ID (active only). */
export function getPropertyById(id: string): Property | undefined {
  return getActiveProperties().find((p) => p.id === id);
}

/** Get one property by ID (including inactive, for admin). */
export function getPropertyByIdAdmin(id: string): Property | undefined {
  return getAllProperties().find((p) => p.id === id);
}

/** Known locations from the live inventory. */
export function getKnownLocations(): string[] {
  return Array.from(new Set(getActiveProperties().map((p) => p.location)));
}

/** Slug from name: "Gurgaon Heights" → "gurgaon-heights" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Format price to label. */
function priceToLabel(price: number): string {
  if (price >= 10_000_000) {
    const cr = price / 10_000_000;
    return `₹${Number(cr.toFixed(2))}Cr`;
  }
  if (price >= 100_000) {
    const l = price / 100_000;
    return `₹${Number(l.toFixed(l < 10 ? 1 : 0))}L`;
  }
  return `₹${price.toLocaleString("en-IN")}`;
}

/** The next id that is not already taken, appending -2, -3, … as needed. */
function uniqueId(name: string): string {
  const base = slugify(name) || `property-${Date.now()}`;
  const taken = new Set(getAllProperties().map((p) => p.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Add a new property. Returns the created property. */
export function addProperty(input: CreatePropertyInput): Property {
  load();

  const id = uniqueId(input.name);
  const now = new Date().toISOString();

  const gallery: PropertyImage[] = (input.images ?? []).map((src, i) => ({
    src,
    alt: `${input.name} — image ${i + 1}`,
  }));

  const property: StoredProperty = {
    id,
    name: input.name,
    bhk: input.bhk,
    kind: input.kind,
    location: input.location,
    city: input.city,
    price: input.price,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    priceLabel: priceToLabel(input.price),
    furnishing: input.furnishing ?? "Semi-furnished",
    availability: input.availability ?? "Ready to move",
    amenities: input.amenities ?? [],
    image: gallery[0]?.src ?? "/projects/azura/01.jpg",
    gallery,
    summary:
      input.summary ??
      `A ${input.bhk} BHK ${input.kind} in ${input.location}, ${input.city}.`,
    description:
      input.description ??
      `A ${input.bhk} BHK ${input.kind} located in ${input.location}, ${input.city}. Priced at ${priceToLabel(input.price)}.`,
    detailPageUrl: `/demo/properties/${id}`,
    keyDetails: [
      `${input.bhk} BHK ${input.kind}`,
      input.location,
      priceToLabel(input.price),
    ],
    status: input.status ?? "active",
    adminAdded: true,
    featured: input.featured,
    area: input.area,
    parking: input.parking,
    createdAt: now,
    updatedAt: now,
  };

  adminProperties = adminProperties.filter((p) => p.id !== id);
  adminProperties.push(property);
  persist();

  return property;
}

/** Update an existing property (seed or admin). */
export function updateProperty(
  id: string,
  input: UpdatePropertyInput,
): Property | null {
  load();

  const seedProp = SEED_STORED.find((p) => p.id === id);
  const adminProp = adminProperties.find((p) => p.id === id);
  const existing = adminProp ?? seedProp ?? null;

  if (!existing) return null;

  const now = new Date().toISOString();

  let gallery = existing.gallery;
  if (input.images) {
    gallery = input.images.map((src, i) => ({
      src,
      alt: `${input.name ?? existing.name} — image ${i + 1}`,
    }));
  }

  const updated: StoredProperty = {
    ...existing,
    ...(input.name != null && { name: input.name }),
    ...(input.location != null && { location: input.location }),
    ...(input.city != null && { city: input.city }),
    ...(input.bhk != null && { bhk: input.bhk }),
    ...(input.kind != null && { kind: input.kind }),
    ...(input.price != null && {
      price: input.price,
      priceLabel: priceToLabel(input.price),
    }),
    ...(input.priceMin != null && { priceMin: input.priceMin }),
    ...(input.priceMax != null && { priceMax: input.priceMax }),
    ...(input.furnishing != null && { furnishing: input.furnishing }),
    ...(input.availability != null && { availability: input.availability }),
    ...(input.amenities != null && { amenities: input.amenities }),
    ...(input.summary != null && { summary: input.summary }),
    ...(input.description != null && { description: input.description }),
    ...(input.status != null && { status: input.status }),
    ...(input.featured != null && { featured: input.featured }),
    ...(input.area != null && { area: input.area }),
    ...(input.parking != null && { parking: input.parking }),
    gallery,
    image: gallery[0]?.src ?? existing.image,
    adminAdded: true,
    updatedAt: now,
  };

  updated.keyDetails = [
    `${updated.bhk} BHK ${updated.kind}`,
    updated.location,
    updated.priceLabel,
  ];

  adminProperties = adminProperties.filter((p) => p.id !== id);
  adminProperties.push(updated);
  persist();

  return updated;
}

/** Remove a property (marks as inactive — never hard deletes). */
export function removeProperty(id: string): boolean {
  load();

  const seedProp = SEED_STORED.find((p) => p.id === id);
  const adminProp = adminProperties.find((p) => p.id === id);

  if (!seedProp && !adminProp) return false;

  if (adminProp) {
    adminProp.status = "inactive";
    adminProp.updatedAt = new Date().toISOString();
  } else if (seedProp) {
    const stored: StoredProperty = {
      ...seedProp,
      status: "inactive",
      adminAdded: true,
      updatedAt: new Date().toISOString(),
    };
    adminProperties.push(stored);
  }

  persist();
  return true;
}

/** Restore a removed property. */
export function restoreProperty(id: string): boolean {
  load();

  const adminProp = adminProperties.find((p) => p.id === id);
  if (!adminProp) return false;

  adminProp.status = "active";
  adminProp.updatedAt = new Date().toISOString();
  persist();
  return true;
}

/** Properties by IDs (active only). */
export function propertiesByIds(ids: string[]): Property[] {
  const active = getActiveProperties();
  return ids
    .map((id) => active.find((p) => p.id === id))
    .filter((p): p is Property => Boolean(p));
}

/** Canonical detail-page path for a property. */
export function propertyDetailUrl(property: Pick<Property, "id">): string {
  return `/demo/properties/${property.id}`;
}

/** Absolute detail-page URL. */
export function absolutePropertyUrl(property: Pick<Property, "id">): string {
  return absoluteUrl(propertyDetailUrl(property));
}
