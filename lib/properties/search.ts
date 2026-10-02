import { PROPERTIES, propertiesByIds, type Property } from '@/lib/data/properties';

export type PropertyQuery = {
  location?: string;
  bhk?: string | number;
  budget?: number;
  kind?: string;
  /** Free text, matched against the property name (e.g. "Dwarka Heights"). */
  name?: string;
};

const bhkNumber = (bhk: string | number | undefined): number | undefined => {
  if (bhk == null) return undefined;
  if (typeof bhk === 'number') return bhk;
  const m = String(bhk).match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
};

const sameText = (a: string, b: string) =>
  a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

/**
 * Search the fictional demo inventory. This is the single source of truth the
 * assistant is allowed to recommend from — it never invents availability.
 *
 * A stated requirement is a hard filter: if the caller says "2 BHK in Dwarka",
 * results from other sizes or localities are excluded rather than merely ranked
 * lower.
 */
export function searchProperties(query: PropertyQuery): Property[] {
  const wantedBhk = bhkNumber(query.bhk);

  const scored = PROPERTIES.map((property) => {
    const locationMatch = query.location
      ? sameText(property.location, query.location)
      : false;
    const cityMatch = query.location ? sameText(property.city, query.location) : false;
    const bhkMatch = wantedBhk != null ? property.bhk === wantedBhk : false;
    const nameMatch = query.name ? nameSimilarity(property.name, query.name) : 0;

    let score = 0;
    if (locationMatch) score += 4;
    else if (cityMatch) score += 2;
    if (bhkMatch) score += 3;
    if (query.kind && property.kind.toLowerCase() === query.kind.toLowerCase()) score += 1;
    if (query.budget != null && property.price <= query.budget) score += 2;
    score += nameMatch;

    return { property, score, locationMatch, cityMatch, bhkMatch, nameMatch };
  })
    .filter(({ property, score, locationMatch, cityMatch, bhkMatch, nameMatch }) => {
      if (score <= 0) return false;
      // A named property is a hard filter, like a stated size or locality.
      if (query.name) return nameMatch >= 6;
      if (query.location && !locationMatch && !cityMatch) return false;
      if (wantedBhk != null && !bhkMatch) return false;
      if (query.budget != null && property.price > query.budget * 1.15) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score || a.property.price - b.property.price);

  return scored.map((entry) => entry.property);
}

export function getPropertyDetails(id: string): Property | undefined {
  return PROPERTIES.find((property) => property.id === id);
}

/**
 * What the inventory has nearby when the caller's exact requirement is not met.
 *
 * Used to answer honestly — "I have a 1 BHK in Dwarka at ₹52L, but that's not the
 * 2 BHK you asked for" — instead of silently relaxing a stated requirement.
 *
 * @param relaxed which stated filters to drop in order to find the near miss.
 */
export type NearMiss = {
  property: Property;
  /** Which of the caller's stated requirements this listing does not meet. */
  mismatches: string[];
};

export function findNearMisses(
  query: PropertyQuery,
  options: { relax?: ('bhk' | 'budget' | 'location' | 'kind')[]; limit?: number } = {},
): NearMiss[] {
  const relax = options.relax ?? ['budget'];
  const limit = options.limit ?? 3;
  const wantedBhk = bhkNumber(query.bhk);

  return PROPERTIES.map((property) => {
    const mismatches: string[] = [];

    if (query.location && !sameText(property.location, query.location) && !sameText(property.city, query.location))
      mismatches.push('location');
    if (wantedBhk != null && property.bhk !== wantedBhk) mismatches.push('bhk');
    if (query.kind && property.kind.toLowerCase() !== query.kind.toLowerCase())
      mismatches.push('kind');
    if (query.budget != null && property.price > query.budget * 1.15)
      mismatches.push('budget');

    // A near miss must only differ on the filters we were willing to relax.
    const blocking = mismatches.filter(
      (field) => !relax.includes(field as 'bhk' | 'budget' | 'location' | 'kind'),
    );
    if (blocking.length) return undefined;
    if (mismatches.length === 0) return undefined;

    return { property, mismatches };
  })
    .filter((entry): entry is NearMiss => Boolean(entry))
    .sort(
      (a, b) =>
        a.mismatches.length - b.mismatches.length ||
        Math.abs(a.property.price - (query.budget ?? a.property.price)) -
          Math.abs(b.property.price - (query.budget ?? b.property.price)),
    )
    .slice(0, limit);
}

export function getPropertiesByIds(ids: string[]): Property[] {
  return propertiesByIds(ids);
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * How strongly free text resembles a property name. Higher is a closer match.
 *
 * Matching is done on whole words, never on substrings. A substring test looks
 * harmless until you notice that "hi" is inside "Rohini Enclave": a plain
 * greeting was being read as naming a property, so the assistant dropped a
 * listing on the customer before it knew anything about their requirement. Word
 * matching also stops a locality like "Dwarka" from silently picking one of
 * several listings in that locality — a stated area is qualification input, not
 * a property name.
 */
function nameSimilarity(name: string, query: string): number {
  const a = normalise(name);
  const b = normalise(query);
  if (!a || !b) return 0;
  if (a === b) return 10;

  const nameWords = a.split(' ');
  const queryWords = b.split(' ');
  const nameSet = new Set(nameWords);
  const querySet = new Set(queryWords);

  // The query contains the whole name — "tell me about rohini enclave".
  if (nameWords.every((word) => querySet.has(word))) return 8;
  // The name contains the whole query, but only when the query is more than one
  // word, so a single generic word can never stand in for a full listing name.
  if (queryWords.length >= 2 && queryWords.every((word) => nameSet.has(word)))
    return 8;

  const overlap = queryWords.filter((word) => nameSet.has(word));
  return overlap.length * 3;
}

/**
 * Find the inventory property a customer is naming, if any. Used when someone
 * asks about a specific listing by name rather than by requirements.
 */
export function findPropertyByName(text: string): Property | undefined {
  const normalised = normalise(text);
  let best: { property: Property; score: number } | undefined;

  for (const property of PROPERTIES) {
    let score = nameSimilarity(property.name, text);
    // Fall back to the locality, so "tell me about the Dwarka one" still works
    // when a locality has exactly one listing.
    const inLocation = normalised.includes(normalise(property.location));
    const locationCount = PROPERTIES.filter((p) => p.location === property.location).length;
    if (inLocation && locationCount === 1) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { property, score };
  }

  return best && best.score >= 6 ? best.property : undefined;
}
