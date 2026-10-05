import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB per image
const MAX_FILES = 6;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/**
 * Store property images on disk and return their URLs.
 *
 * Images are written to `public/uploads`, so the database stores only a small
 * path (never a base64 blob) and the browser serves them like any static asset.
 * Authenticated: only a signed-in admin may upload.
 */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File)
    .slice(0, MAX_FILES);

  if (!files.length) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  try {
    const dir = join(process.cwd(), "public", "uploads");
    mkdirSync(dir, { recursive: true });

    const urls: string[] = [];
    for (const file of files) {
      const ext = EXT[file.type];
      if (!ext || file.size === 0 || file.size > MAX_BYTES) continue;

      const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext}`;
      writeFileSync(join(dir, name), Buffer.from(await file.arrayBuffer()));
      urls.push(`/uploads/${name}`);
    }

    if (!urls.length) {
      return NextResponse.json(
        { error: "no_valid_images", detail: "Use JPEG, PNG, WebP, AVIF or GIF under 6 MB." },
        { status: 400 },
      );
    }

    return NextResponse.json({ urls });
  } catch (err) {
    console.error("[upload] disk write failed:", err);
    return NextResponse.json(
      { error: "upload_failed", detail: "File uploads require a writable storage directory." },
      { status: 500 },
    );
  }
}
