import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { getStoredLeads } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every lead the app has recorded, newest first. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ leads: await getStoredLeads() });
}
