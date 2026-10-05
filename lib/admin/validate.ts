import type {
  CreatePropertyInput,
  PropertyStatus,
  StoredProperty,
  UpdatePropertyInput,
} from "@/lib/data/store";

/**
 * Boundary validation for admin property mutations.
 *
 * The admin UI is a convenience, not a trust boundary: every value is
 * re-validated here before it reaches the store, so a malformed or hostile
 * request cannot write a property the rest of the system cannot render.
 */

const KINDS: StoredProperty["kind"][] = [
  "Apartment",
  "Villa",
  "Studio",
  "Penthouse",
  "Builder Floor",
];
const FURNISHINGS: StoredProperty["furnishing"][] = [
  "Unfurnished",
  "Semi-furnished",
  "Furnished",
];
const STATUSES: PropertyStatus[] = ["active", "inactive", "sold"];

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const number = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[₹,\s]/g, "");
    if (!cleaned) return undefined;
    // "90L" / "1.05Cr" accepted in the admin form.
    const cr = cleaned.match(/^(\d+(?:\.\d+)?)cr$/i);
    if (cr) return Math.round(Number(cr[1]) * 10_000_000);
    const l = cleaned.match(/^(\d+(?:\.\d+)?)l$/i);
    if (l) return Math.round(Number(l[1]) * 100_000);
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const list = (value: unknown): string[] | undefined => {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 40);
  if (typeof value === "string")
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 40);
  return undefined;
};

const images = (value: unknown): string[] | undefined => {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  return undefined;
};

export type ParseResult =
  | { ok: true; value: CreatePropertyInput }
  | { ok: false; error: string };

export function parseCreate(body: unknown): ParseResult {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const raw = body as Record<string, unknown>;

  const name = text(raw.name, 120);
  const location = text(raw.location, 80);
  const bhk = number(raw.bhk);
  const priceMax = number(raw.priceMax);
  const priceMin = number(raw.priceMin);
  const price = number(raw.price) ?? priceMax ?? priceMin;

  if (!name) return { ok: false, error: "name_required" };
  if (!location) return { ok: false, error: "location_required" };
  if (bhk == null || bhk < 1 || bhk > 20)
    return { ok: false, error: "valid_bhk_required" };
  if (price == null || price <= 0)
    return { ok: false, error: "valid_price_required" };

  const kind = text(raw.kind, 40);
  if (!kind || !KINDS.includes(kind as StoredProperty["kind"]))
    return { ok: false, error: "valid_kind_required" };

  const status = text(raw.status, 20);
  const furnishing = text(raw.furnishing, 40);

  return {
    ok: true,
    value: {
      name,
      location,
      city: text(raw.city, 80) ?? location,
      bhk,
      kind: kind as StoredProperty["kind"],
      price,
      priceMin,
      priceMax,
      furnishing: FURNISHINGS.includes(furnishing as StoredProperty["furnishing"])
        ? (furnishing as StoredProperty["furnishing"])
        : undefined,
      availability: text(raw.availability, 60),
      amenities: list(raw.amenities),
      summary: text(raw.summary, 300),
      description: text(raw.description, 2000),
      images: images(raw.images),
      status: STATUSES.includes(status as PropertyStatus)
        ? (status as PropertyStatus)
        : "active",
      featured: raw.featured === true,
      area: text(raw.area, 60),
      parking: text(raw.parking, 60),
    },
  };
}

export type ParseUpdateResult =
  | { ok: true; value: UpdatePropertyInput }
  | { ok: false; error: string };

export function parseUpdate(body: unknown): ParseUpdateResult {
  if (!body || typeof body !== "object")
    return { ok: false, error: "invalid_body" };
  const raw = body as Record<string, unknown>;
  const value: UpdatePropertyInput = {};
  let touched = false;

  const name = text(raw.name, 120);
  if (name) {
    value.name = name;
    touched = true;
  }

  const location = text(raw.location, 80);
  if (location) {
    value.location = location;
    touched = true;
  }

  const city = text(raw.city, 80);
  if (city) {
    value.city = city;
    touched = true;
  }

  const bhk = number(raw.bhk);
  if (bhk != null && bhk >= 1 && bhk <= 20) {
    value.bhk = bhk;
    touched = true;
  }

  const kind = text(raw.kind, 40);
  if (kind && KINDS.includes(kind as StoredProperty["kind"])) {
    value.kind = kind as StoredProperty["kind"];
    touched = true;
  }

  const price = number(raw.price) ?? number(raw.priceMax) ?? number(raw.priceMin);
  if (price != null && price > 0) {
    value.price = price;
    touched = true;
  }
  const priceMin = number(raw.priceMin);
  if (priceMin != null) {
    value.priceMin = priceMin;
    touched = true;
  }
  const priceMax = number(raw.priceMax);
  if (priceMax != null) {
    value.priceMax = priceMax;
    touched = true;
  }

  const furnishing = text(raw.furnishing, 40);
  if (
    furnishing &&
    FURNISHINGS.includes(furnishing as StoredProperty["furnishing"])
  ) {
    value.furnishing = furnishing as StoredProperty["furnishing"];
    touched = true;
  }

  const availability = text(raw.availability, 60);
  if (availability) {
    value.availability = availability;
    touched = true;
  }

  const amenities = list(raw.amenities);
  if (amenities) {
    value.amenities = amenities;
    touched = true;
  }

  const summary = text(raw.summary, 300);
  if (summary) {
    value.summary = summary;
    touched = true;
  }

  const description = text(raw.description, 2000);
  if (description) {
    value.description = description;
    touched = true;
  }

  const imageList = images(raw.images);
  if (imageList) {
    value.images = imageList;
    touched = true;
  }

  const status = text(raw.status, 20);
  if (status && STATUSES.includes(status as PropertyStatus)) {
    value.status = status as PropertyStatus;
    touched = true;
  }

  if (typeof raw.featured === "boolean") {
    value.featured = raw.featured;
    touched = true;
  }

  const area = text(raw.area, 60);
  if (area) {
    value.area = area;
    touched = true;
  }

  const parking = text(raw.parking, 60);
  if (parking) {
    value.parking = parking;
    touched = true;
  }

  if (!touched) return { ok: false, error: "no_fields" };
  return { ok: true, value };
}
