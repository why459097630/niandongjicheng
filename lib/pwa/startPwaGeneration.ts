import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertBuildRecord, insertOperationLogOnce } from "@/lib/build/storage";
import type { BuildPriority, BuildRequest, StartBuildResponse } from "@/lib/build/types";

function normalizePlan(plan: string): string {
  const value = plan.trim().toLowerCase();
  if (!value) return "pro";
  return value;
}

function normalizeBuildPriority(
  value: BuildPriority | undefined,
  plan: string,
): BuildPriority {
  if (value === "admin") return "admin";
  if (value === "paid") return "paid";
  if (value === "free") return "free";
  return normalizePlan(plan) === "free" ? "free" : "paid";
}

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
}

function getPwaBaseUrl(): string {
  const value =
    process.env.PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "";

  if (value) {
    return value.replace(/\/+$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim() || "";
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/+$/, "")}`;
  }

  throw new Error("PWA_BASE_URL is required.");
}

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

function getDefaultPwaLogoUrl(): string {
  const explicitLogoUrl =
    process.env.PWA_DEFAULT_LOGO_URL?.trim() ||
    process.env.NEXT_PUBLIC_PWA_DEFAULT_LOGO_URL?.trim() ||
    "";

  if (explicitLogoUrl) {
    return explicitLogoUrl;
  }

  const pwaBaseUrl = getPwaBaseUrl();

  return `${pwaBaseUrl}/icons/icon-512.png`;
}

function parseDataUrl(value: string | null | undefined): {
  mimeType: string;
  extension: string;
  bytes: Buffer;
} | null {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  const mimeType = match[1].trim().toLowerCase();
  const base64Content = match[2].trim();

  let extension = "png";

  if (mimeType === "image/png") {
    extension = "png";
  } else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    extension = "jpg";
  } else if (mimeType === "image/webp") {
    extension = "webp";
  } else if (mimeType === "image/svg+xml") {
    extension = "svg";
  }

  return {
    mimeType,
    extension,
    bytes: Buffer.from(base64Content, "base64"),
  };
}

type StandardPwaIconAssets = {
  source: string;
  displayLogo: string;
  icon192: string;
  icon512: string;
  maskable192: string;
  maskable512: string;
  appleTouchIcon: string;
};

function getDefaultPwaIconAssets(): StandardPwaIconAssets {
  const pwaBaseUrl = getPwaBaseUrl();

  return {
    source: `${pwaBaseUrl}/icons/icon-512.png`,
    displayLogo: `${pwaBaseUrl}/icons/icon-512.png`,
    icon192: `${pwaBaseUrl}/icons/icon-192.png`,
    icon512: `${pwaBaseUrl}/icons/icon-512.png`,
    maskable192: `${pwaBaseUrl}/icons/maskable-192.png`,
    maskable512: `${pwaBaseUrl}/icons/maskable-512.png`,
    appleTouchIcon: `${pwaBaseUrl}/icons/apple-touch-icon.png`,
  };
}

async function uploadStorageObject(input: {
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

  const uploadResponse = await fetch(
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

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Failed to upload storage object. Status=${uploadResponse.status}. Bucket=${input.bucket}. Path=${input.objectPath}. Body=${text}`,
    );
  }

  return `${input.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(input.bucket)}/${input.objectPath}`;
}

async function renderPwaIconPng(input: {
  sourceBytes: Buffer;
  size: number;
  maskable: boolean;
}): Promise<Buffer> {
  const transparentBackground = {
    r: 255,
    g: 255,
    b: 255,
    alpha: 0,
  };

  return sharp(input.sourceBytes, {
    density: 512,
    animated: false,
    failOn: "none",
  })
    .resize({
      width: input.size,
      height: input.size,
      fit: "cover",
      position: "center",
      background: transparentBackground,
    })
    .png()
    .toBuffer();
}

async function uploadPwaIcon(input: {
  storeId: string;
  iconDataUrl?: string | null;
  iconUrl?: string | null;
}): Promise<StandardPwaIconAssets> {
  const defaultAssets = getDefaultPwaIconAssets();
  const directIconUrl = String(input.iconUrl || "").trim();

  if (directIconUrl) {
    return {
      ...defaultAssets,
      source: directIconUrl,
      displayLogo: directIconUrl,
    };
  }

  const parsed = parseDataUrl(input.iconDataUrl);

  if (!parsed) {
    return defaultAssets;
  }

  const { supabaseUrl, secretKey } = getAppCloudEnv();
  const bucket = process.env.PWA_ICON_BUCKET?.trim() || "store-images";
  const sourceExtension = parsed.extension === "svg" ? "svg" : parsed.extension;
  const sourcePath = `${input.storeId}/source-logo.${sourceExtension}`;
  const displayLogoPath = `${input.storeId}/display-logo.png`;
  const icon192Path = `${input.storeId}/pwa-icon-192.png`;
  const icon512Path = `${input.storeId}/pwa-icon-512.png`;
  const maskable192Path = `${input.storeId}/pwa-maskable-192.png`;
  const maskable512Path = `${input.storeId}/pwa-maskable-512.png`;
  const appleTouchIconPath = `${input.storeId}/apple-touch-icon.png`;

  try {
    const [
      displayLogoBytes,
      icon192Bytes,
      icon512Bytes,
      maskable192Bytes,
      maskable512Bytes,
      appleTouchIconBytes,
    ] = await Promise.all([
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 512,
        maskable: false,
      }),
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 192,
        maskable: false,
      }),
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 512,
        maskable: false,
      }),
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 192,
        maskable: true,
      }),
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 512,
        maskable: true,
      }),
      renderPwaIconPng({
        sourceBytes: parsed.bytes,
        size: 180,
        maskable: false,
      }),
    ]);

    const [
      source,
      displayLogo,
      icon192,
      icon512,
      maskable192,
      maskable512,
      appleTouchIcon,
    ] = await Promise.all([
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: sourcePath,
        contentType: parsed.mimeType,
        bytes: parsed.bytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: displayLogoPath,
        contentType: "image/png",
        bytes: displayLogoBytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: icon192Path,
        contentType: "image/png",
        bytes: icon192Bytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: icon512Path,
        contentType: "image/png",
        bytes: icon512Bytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: maskable192Path,
        contentType: "image/png",
        bytes: maskable192Bytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: maskable512Path,
        contentType: "image/png",
        bytes: maskable512Bytes,
      }),
      uploadStorageObject({
        supabaseUrl,
        secretKey,
        bucket,
        objectPath: appleTouchIconPath,
        contentType: "image/png",
        bytes: appleTouchIconBytes,
      }),
    ]);

    return {
      source,
      displayLogo,
      icon192,
      icon512,
      maskable192,
      maskable512,
      appleTouchIcon,
    };
  } catch (error) {
    console.warn("NDJC startPwaGeneration: standard PWA icon generation failed, fallback to default icons", {
      error: error instanceof Error ? error.message : String(error),
      storeId: input.storeId,
    });

    return defaultAssets;
  }
}

async function upsertStorePwaProfile(input: {
  storeId: string;
  appName: string;
  iconAssets: StandardPwaIconAssets;
}) {
  const { supabaseUrl, secretKey } = getAppCloudEnv();
  const description = `${input.appName} official PWA app.`;

  const body = [
    {
      store_id: input.storeId,
      title: input.appName,
      title_i18n: {
        en: input.appName,
        zh: input.appName,
      },
      description,
      description_i18n: {
        en: description,
        zh: description,
      },
      logo_url: input.iconAssets.displayLogo,
      logo_image_variants: {
        source: input.iconAssets.source,
        displayLogo: input.iconAssets.displayLogo,
        icon192: input.iconAssets.icon192,
        icon512: input.iconAssets.icon512,
        maskable192: input.iconAssets.maskable192,
        maskable512: input.iconAssets.maskable512,
        appleTouchIcon: input.iconAssets.appleTouchIcon,
      },
      updated_at: new Date().toISOString(),
    },
  ];

  const response = await fetch(
    `${supabaseUrl}/rest/v1/store_profiles?on_conflict=store_id`,
    {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upsert store_profiles for PWA. Status=${response.status}. Body=${text}`);
  }
}

export async function startPwaGeneration(
  supabase: SupabaseClient,
  input: BuildRequest,
): Promise<StartBuildResponse> {
  const appName = input.appName.trim();
  const moduleName = input.module.trim() || "feature-showcase";
  const uiPackName = input.uiPack.trim() || "ui-pack-showcase-greenpink";
  const plan = normalizePlan(input.plan);
  const storeId = String(input.storeId || "").trim();
  const userId = String(input.userId || "").trim();
  const runId = String(input.runId || "").trim() || createRunId();
  const buildPriority = normalizeBuildPriority(input.buildPriority, plan);

  if (!appName) {
    return {
      ok: false,
      error: "appName is required.",
    };
  }

  if (!storeId) {
    return {
      ok: false,
      error: "storeId is required for PWA generation.",
    };
  }

  if (!userId) {
    return {
      ok: false,
      error: "userId is required for PWA generation.",
    };
  }

  const existingPwaBaseUrl = getPwaBaseUrl();
  const pwaUrl = `${existingPwaBaseUrl}/pwa/${encodeURIComponent(storeId)}`;
  const downloadUrl = `/api/download-pwa-package?runId=${encodeURIComponent(runId)}`;

  const iconAssets = await uploadPwaIcon({
    storeId,
    iconDataUrl: input.iconDataUrl,
    iconUrl: input.iconUrl,
  });

  await upsertStorePwaProfile({
    storeId,
    appName,
    iconAssets,
  });

  await insertBuildRecord(supabase, {
    userId,
    runId,
    appName,
    moduleName,
    uiPackName,
    plan,
    buildPriority,
    storeId,
    status: "success",
    stage: "success",
    message: "PWA package is ready.",
    artifactUrl: pwaUrl,
    downloadUrl,
    releaseUrl: null,
    publicApkUrl: null,
    completedAt: new Date().toISOString(),
    statusSource: "local_api",
    lastSyncedAt: new Date().toISOString(),
  });

  await insertOperationLogOnce(
    supabase,
    {
      userId,
      runId,
      eventName: "build_started",
      pagePath: "/api/start-build",
      metadata: {
        source: "pwa_generation",
        runId,
        storeId,
        appName,
        moduleName,
        uiPackName,
        plan,
        pwaUrl,
        downloadUrl,
      },
    },
    { dedupeSeconds: 30 },
  ).catch(() => null);

  return {
    ok: true,
    runId,
    stage: "success",
    message: "PWA package is ready.",
    storeId,
  };
}