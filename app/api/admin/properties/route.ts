import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { parseCreate } from "@/lib/admin/validate";
import { addProperty, getAllProperties } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List every property (including inactive) for the admin inventory. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ properties: getAllProperties() });
}

/** Create a property. It immediately joins the shared active inventory. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = parseCreate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const property = addProperty(parsed.value);
  return NextResponse.json({ property }, { status: 201 });
}
