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
  const secretKey = process.env.APP_CLOUD_SUPABASE_SECRET_KEY?.trim() || "";

  if (!supabaseUrl) {
    throw new Error("APP_CLOUD_SUPABASE_URL is required.");
  }

  if (!secretKey) {
    throw new Error("APP_CLOUD_SUPABASE_SECRET_KEY is required.");
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    secretKey,
  };
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

async function uploadPwaIcon(input: {
  storeId: string;
  iconDataUrl?: string | null;
  iconUrl?: string | null;
}): Promise<string | null> {
  const directIconUrl = String(input.iconUrl || "").trim();

  if (directIconUrl) {
    return directIconUrl;
  }

  const parsed = parseDataUrl(input.iconDataUrl);

  if (!parsed) {
    return null;
  }

  const { supabaseUrl, secretKey } = getAppCloudEnv();
  const bucket = process.env.PWA_ICON_BUCKET?.trim() || "store-assets";
  const objectPath = `pwa-icons/${input.storeId}/icon.${parsed.extension}`;

  const uploadResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        apikey: secretKey,
        "Content-Type": parsed.mimeType,
        "x-upsert": "true",
      },
      body: parsed.bytes,
      cache: "no-store",
    },
  );

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    console.warn("NDJC startPwaGeneration: icon upload failed, continue without icon", {
      status: uploadResponse.status,
      body: text,
      bucket,
      objectPath,
    });
    return null;
  }

  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
}

async function upsertStorePwaProfile(input: {
  storeId: string;
  appName: string;
  logoUrl?: string | null;
}) {
  const { supabaseUrl, secretKey } = getAppCloudEnv();

  const body = [
    {
      store_id: input.storeId,
      title: input.appName,
      description: `${input.appName} official PWA app.`,
      logo_url: input.logoUrl || null,
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

  const logoUrl = await uploadPwaIcon({
    storeId,
    iconDataUrl: input.iconDataUrl,
    iconUrl: input.iconUrl,
  });

  await upsertStorePwaProfile({
    storeId,
    appName,
    logoUrl,
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