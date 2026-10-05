import { PROPERTIES, type Property } from "./properties";

/**
 * The active inventory, as a single mutable set.
 *
 * This module is deliberately isomorphic — it has NO server-only dependencies
 * (no `node:fs`), so it can be imported by the WhatsApp/phone client code as
 * well as by the server. That is what lets one property set feed every channel:
 *
 *  - On the server, `lib/data/store.ts` loads the seed inventory plus any
 *    admin-added properties and calls `setActiveInventory(...)` with the merged,
 *    active set. Every server module (`search`, `match`, `extract`, the tools
 *    route) reads it back from here.
 *  - In the browser, `lib/data/useInventory.ts` calls `GET /api/properties` and
 *    hydrates the same cache, so a property an admin just added renders in the
 *    WhatsApp chat and the phone lead panel without a second dataset.
 *
 * Before hydration it falls back to the static seed inventory, so nothing is
 * ever empty and the fallback engine still works.
 */

const isActive = (property: Property) => (property.status ?? "active") === "active";

let active: Property[] = PROPERTIES.filter(isActive);

/** Replace the active set. The admin store calls this after every mutation. */
export function setActiveInventory(properties: Property[]): void {
  active = properties.filter(isActive);
}

/** Every active property — seed, admin-added, and admin-edited seed. */
export function getActiveProperties(): Property[] {
  return active;
}

/** Locality names actually present in the live inventory. */
export function getKnownLocations(): string[] {
  return Array.from(new Set(active.map((property) => property.location)));
}

export function getPropertyById(id: string): Property | undefined {
  return active.find((property) => property.id === id);
}

export function getPropertiesByIds(ids: string[]): Property[] {
  return ids
    .map((id) => active.find((property) => property.id === id))
    .filter((property): property is Property => Boolean(property));
}

/** True when the inventory holds this id — used to validate untrusted input. */
export function isKnownPropertyId(id: unknown): id is string {
  return typeof id === "string" && active.some((property) => property.id === id);
}
