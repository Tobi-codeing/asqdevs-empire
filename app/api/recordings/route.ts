import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRelayUrl(): string | undefined {
  const value = process.env.VOICE_RELAY_URL?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

export async function POST(request: Request) {
  try {
    const relayUrl = getRelayUrl();
    const contentType = request.headers.get("content-type") || "";

    // If Render relay is configured, proxy the upload to Render so recordings persist
    if (relayUrl) {
      try {
        const bodyBuffer = await request.arrayBuffer();
        const relayRes = await fetch(`${relayUrl}/api/recordings`, {
          method: "POST",
          headers: {
            "Content-Type": contentType || "audio/webm",
            "X-Filename": request.headers.get("x-filename") || "",
            "X-Lead-Id": request.headers.get("x-lead-id") || "",
          },
          body: bodyBuffer,
          signal: AbortSignal.timeout(10000),
        });
        if (relayRes.ok) {
          const data = await relayRes.json();
          return NextResponse.json(data);
        }
      } catch (proxyErr) {
        console.warn("[recordings] relay upload failed, falling back to local storage:", proxyErr);
      }
    }

    // Local storage fallback (for development and standalone runs)
    let audioBuffer: Buffer;
    let filename = `rec-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.webm`;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        audioBuffer = Buffer.from(await file.arrayBuffer());
        if (file.name) filename = file.name;
      } else {
        return NextResponse.json({ error: "no_file" }, { status: 400 });
      }
    } else {
      const arrayBuf = await request.arrayBuffer();
      if (!arrayBuf || arrayBuf.byteLength === 0) {
        return NextResponse.json({ error: "empty_audio" }, { status: 400 });
      }
      audioBuffer = Buffer.from(arrayBuf);
      const reqFilename = request.headers.get("x-filename");
      if (reqFilename) filename = reqFilename;
    }

    const localDir = join(process.cwd(), "public", "uploads", "recordings");
    if (!existsSync(localDir)) {
      mkdirSync(localDir, { recursive: true });
    }
    writeFileSync(join(localDir, filename), audioBuffer);

    return NextResponse.json({
      ok: true,
      filename,
      url: `/uploads/recordings/${filename}`,
    });
  } catch (err) {
    console.error("[recordings] upload error:", err);
    return NextResponse.json({ error: "upload_failed", detail: String(err) }, { status: 500 });
  }
}
