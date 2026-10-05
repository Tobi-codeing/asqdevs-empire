import { NextResponse } from "next/server";
import { getActiveProperties } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The active property inventory, as JSON.
 *
 * Public and read-only: it exposes only the fields the demo already shows on its
 * property pages. Importing the server store hydrates the shared cache first, so
 * this always reflects admin changes. The browser calls it once to hydrate
 * `lib/data/inventory` (see `useInventory`), which is how the WhatsApp and phone
 * clients see the SAME inventory as the server without bundling `node:fs`.
 */
export async function GET() {
  return NextResponse.json({ properties: getActiveProperties() });
}
