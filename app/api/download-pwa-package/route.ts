import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import {
  getBuildRecordByRunId,
  insertOperationLogOnce,
  syncAuthUserProfile,
} from "@/lib/build/storage";

function getPwaUrlFromRecord(record: {
  artifactUrl: string | null;
  storeId?: string | null;
}) {
  const artifactUrl = String(record.artifactUrl || "").trim();

  if (artifactUrl) {
    return artifactUrl;
  }

  const storeId = String(record.storeId || "").trim();

  if (!storeId) {
    return "";
  }

  const baseUrl =
    process.env.PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "";

  if (!baseUrl) {
    return "";
  }

  return `${baseUrl.replace(/\/+$/, "")}/pwa/${encodeURIComponent(storeId)}`;
}

function sanitizeFileName(value: string) {
  const normalized = value.trim() || "Think-it-Done-PWA";
  return normalized
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function createContentDispositionFileName(fileName: string) {
  const asciiFallback = fileName
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim() || "Think-it-Done-PWA-Package.zip";

  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC download-pwa-package: failed to sync profile", profileError);
    }

    const runId = request.nextUrl.searchParams.get("runId")?.trim() || "";

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing runId.",
        },
        { status: 400 },
      );
    }

    const record = await getBuildRecordByRunId(supabase, runId);

    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          error: "Build record not found.",
        },
        { status: 404 },
      );
    }

    if (record.status !== "success") {
      return NextResponse.json(
        {
          ok: false,
          error: "PWA package is not ready yet.",
        },
        { status: 409 },
      );
    }

    const pwaUrl = getPwaUrlFromRecord(record);

    if (!pwaUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "PWA URL is missing.",
        },
        { status: 409 },
      );
    }

    await insertOperationLogOnce(
      supabase,
      {
        userId: user.id,
        buildId: record.id,
        runId,
        eventName: "download_clicked",
        pagePath: "/api/download-pwa-package",
        metadata: {
          source: "download_pwa_package",
          runId,
          storeId: record.storeId || "",
          pwaUrl,
        },
      },
      { dedupeSeconds: 5 },
    ).catch(() => null);

    const qrCodeBuffer = await QRCode.toBuffer(pwaUrl, {
      type: "png",
      margin: 2,
      width: 640,
      errorCorrectionLevel: "M",
    });

    const zip = new JSZip();

    zip.file(
      "START-HERE.txt",
      [
        "Think it Done PWA Package",
        "",
        `App Name: ${record.appName}`,
        `Store ID: ${record.storeId || ""}`,
        `PWA URL: ${pwaUrl}`,
        "",
        "Open the PWA URL on a mobile browser.",
        "Use the QR code to share the app with customers.",
        "Use the same Store ID when renewing cloud service from the History page.",
        "",
      ].join("\n"),
    );

    zip.file(
      "PWA访问链接.txt",
      [
        `App Name: ${record.appName}`,
        `Store ID: ${record.storeId || ""}`,
        `PWA URL: ${pwaUrl}`,
        "",
      ].join("\n"),
    );

    zip.file("PWA访问二维码.png", qrCodeBuffer);

    zip.file(
      "安装到手机桌面说明.txt",
      [
        "Android Chrome:",
        "1. Open the PWA URL in Chrome.",
        "2. Tap the menu button.",
        "3. Tap Add to Home screen or Install app.",
        "",
        "iPhone Safari:",
        "1. Open the PWA URL in Safari.",
        "2. Tap the Share button.",
        "3. Tap Add to Home Screen.",
        "",
      ].join("\n"),
    );

    zip.file(
      "云端续费说明.txt",
      [
        `Store ID: ${record.storeId || ""}`,
        "",
        "Cloud renewal is bound to this Store ID.",
        "Open the History page on the Think it Done website.",
        "Find this build record.",
        "Use the Renew Cloud button to extend cloud service for this Store ID.",
        "",
      ].join("\n"),
    );

    zip.file(
      "注意事项.txt",
      [
        "1. Do not delete or change the Store ID.",
        "2. The QR code points to the current PWA app entrance.",
        "3. If cloud service expires, write operations may stop until renewed.",
        "4. Keep this package for future reference.",
        "",
      ].join("\n"),
    );

    const zipArrayBuffer = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6,
      },
    });

    const fileName = `${sanitizeFileName(record.appName)}-PWA-Package.zip`;

    return new NextResponse(zipArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": createContentDispositionFileName(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to download PWA package.",
      },
      { status: 500 },
    );
  }
}
