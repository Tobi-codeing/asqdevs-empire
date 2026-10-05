import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { parseUpdate } from "@/lib/admin/validate";
import { removeProperty, updateProperty } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Update a property. Changes are live for every channel at once. */
export async function PATCH(request: Request, context: Context) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = parseUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const property = updateProperty(id, parsed.value);
  if (!property) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ property });
}

/**
 * Remove a property from the active inventory.
 *
 * It is marked inactive rather than deleted, which is what makes every channel
 * stop recommending it while its detail page becomes unavailable — no stale
 * references anywhere.
 */
export async function DELETE(request: Request, context: Context) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const removed = removeProperty(id);
  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ removed: true });
}
