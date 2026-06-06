import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_SOURCE_ICON_BYTES = 5 * 1024 * 1024;
const ALLOWED_ICON_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function getAppCloudEnv() {
  const supabaseUrl = process.env.APP_CLOUD_SUPABASE_URL?.trim() || "";
  const secretKey =
    process.env.APP_CLOUD_SUPABASE_SECRET_KEY?.trim() ||
    process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";

  if (!supabaseUrl) {
    throw new Error("APP_CLOUD_SUPABASE_URL is required.");
  }

  if (!secretKey) {
    throw new Error("APP_CLOUD_SUPABASE_SECRET_KEY or APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    secretKey,
  };
}

function getExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function sanitizePathPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "icon";
}

async function uploadAppCloudStorageObject(input: {
  supabaseUrl: string;
  secretKey: string;
  bucket: string;
  objectPath: string;
  contentType: string;
  bytes: Buffer;
}): Promise<string> {
  const uploadBody = new Blob([new Uint8Array(input.bytes)], {
    type: input.contentType,
  });

  const response = await fetch(
    `${input.supabaseUrl}/storage/v1/object/${encodeURIComponent(input.bucket)}/${input.objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.secretKey}`,
        apikey: input.secretKey,
        "Content-Type": input.contentType,
        "x-upsert": "true",
      },
      body: uploadBody,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to upload source icon. Status=${response.status}. Bucket=${input.bucket}. Path=${input.objectPath}. Body=${text}`,
    );
  }

  return `${input.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(input.bucket)}/${input.objectPath}`;
}

export async function POST(request: NextRequest) {
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

    const formData = await request.formData();
    const iconFile = formData.get("iconFile");

    if (!(iconFile instanceof File) || iconFile.size <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "iconFile is required.",
        },
        { status: 400 },
      );
    }

    if (iconFile.size > MAX_SOURCE_ICON_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "Icon image must be 5MB or smaller.",
        },
        { status: 400 },
      );
    }

    const mimeType = (iconFile.type || "").trim().toLowerCase();

    if (!ALLOWED_ICON_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Icon image must be PNG, JPG, or WebP.",
        },
        { status: 400 },
      );
    }

    const { supabaseUrl, secretKey } = getAppCloudEnv();
    const bucket = process.env.PWA_ICON_BUCKET?.trim() || "store-images";
    const extension = getExtensionFromMimeType(mimeType);
    const fileName = sanitizePathPart(iconFile.name.replace(/\.[^.]+$/, ""));
    const now = new Date().toISOString().replace(/[^0-9]/g, "");
    const random = Math.random().toString(36).slice(2, 10);
    const objectPath = `pwa-source-icons/${user.id}/${now}-${random}-${fileName}.${extension}`;
    const bytes = Buffer.from(await iconFile.arrayBuffer());

    const iconUrl = await uploadAppCloudStorageObject({
      supabaseUrl,
      secretKey,
      bucket,
      objectPath,
      contentType: mimeType,
      bytes,
    });

    return NextResponse.json(
      {
        ok: true,
        iconUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to upload icon.",
      },
      { status: 500 },
    );
  }
}