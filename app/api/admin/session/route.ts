import { NextResponse } from "next/server";
import { adminConfigured, isAdminRequest } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: isAdminRequest(request),
    configured: adminConfigured(),
  });
}
