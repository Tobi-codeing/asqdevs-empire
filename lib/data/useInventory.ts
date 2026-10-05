"use client";

import { useEffect, useState } from "react";
import { getActiveProperties, setActiveInventory } from "./inventory";
import type { Property } from "./properties";

/**
 * Hydrate the shared inventory cache in the browser.
 *
 * The admin owns one inventory persisted on the server. A client component
 * cannot read that file, so it loads the same active set from
 * `GET /api/properties` and publishes it into `lib/data/inventory`, which is the
 * one place every channel reads properties from. Until the request resolves the
 * cache holds the seed inventory, so nothing ever renders empty.
 *
 * The returned array is state so a component re-renders once the admin-added
 * properties arrive — that is what makes a property an admin just saved appear
 * in the WhatsApp chat and the phone lead panel.
 */
export function useInventory(): Property[] {
  const [inventory, setInventory] = useState<Property[]>(() =>
    getActiveProperties(),
  );

  useEffect(() => {
    let alive = true;
    fetch("/api/properties", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { properties?: Property[] } | null) => {
        if (!alive || !data || !Array.isArray(data.properties)) return;
        setActiveInventory(data.properties);
        setInventory(data.properties);
      })
      .catch(() => {
        /* keep the seed inventory if the request fails */
      });
    return () => {
      alive = false;
    };
  }, []);

  return inventory;
}

/** Look several properties up in a hydrated inventory list. */
export function pickProperties(
  inventory: Property[],
  ids: string[] | undefined,
): Property[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => inventory.find((property) => property.id === id))
    .filter((property): property is Property => Boolean(property));
}
