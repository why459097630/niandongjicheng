import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { markFirebaseAllocationCleanupQueued } from "@/lib/firebase/projectPool";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getAllowedSecret(): string {
  return (
    (process.env.FIREBASE_CLEANUP_CRON_SECRET || "").trim() ||
    (process.env.CRON_SECRET || "").trim()
  );
}

function isAuthorized(request: NextRequest): boolean {
  const allowedSecret = getAllowedSecret();

  if (!allowedSecret) {
    return false;
  }

  const authHeader = (request.headers.get("authorization") || "").trim();
  return authHeader === `Bearer ${allowedSecret}`;
}

function getWebSupabase() {
  return createSupabaseClient(
    getRequiredEnv("WEB_SUPABASE_URL"),
    getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function getAppCloudSupabase() {
  return createSupabaseClient(
    getRequiredEnv("APP_CLOUD_SUPABASE_URL"),
    getRequiredEnv("APP_CLOUD_SUPABASE_SECRET_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

async function githubRequest(
  url: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { token, headers, ...rest } = init;

  return fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    cache: "no-store",
  });
}

async function dispatchCleanupWorkflow(input: {
  storeId: string;
  firebaseProjectId: string;
  firebaseCredentialsEnvKey: string;
  packageName: string;
}) {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");
  const workflowId = getRequiredEnv("FIREBASE_CLEANUP_WORKFLOW_ID");

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        ref: branch,
        inputs: {
          store_id: input.storeId,
          firebase_project_id: input.firebaseProjectId,
          firebase_credentials_env_key: input.firebaseCredentialsEnvKey,
          package_name: input.packageName,
        },
      }),
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to dispatch firebase cleanup workflow: ${text}`);
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const limitRaw = Number.parseInt(
      (request.nextUrl.searchParams.get("limit") || "20").trim(),
      10,
    );
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

    const webSupabase = getWebSupabase();
    const appCloudSupabase = getAppCloudSupabase();

    const { data: allocations, error: allocationError } = await webSupabase
      .from("firebase_app_allocations")
      .select(
        "store_id,firebase_project_id,firebase_credentials_env_key,package_name,allocation_status",
      )
      .in("allocation_status", ["active", "read_only"])
      .order("created_at", { ascending: true })
      .limit(limit * 5);

    if (allocationError) {
      throw new Error(allocationError.message);
    }

    const allocationRows =
      (allocations || []) as Array<{
        store_id: string;
        firebase_project_id: string;
        firebase_credentials_env_key: string;
        package_name: string;
        allocation_status: "active" | "read_only";
      }>;

    if (allocationRows.length === 0) {
      return NextResponse.json({
        ok: true,
        scanned: 0,
        queued: 0,
        message: "No firebase allocations need cleanup.",
      });
    }

    const storeIds = allocationRows.map((row) => row.store_id);

    const { data: stores, error: storesError } = await appCloudSupabase
      .from("stores")
      .select("store_id,service_status")
      .in("store_id", storeIds);

    if (storesError) {
      throw new Error(storesError.message);
    }

    const deletedStoreIdSet = new Set(
      ((stores || []) as Array<{ store_id: string; service_status: string }>)
        .filter((row) => String(row.service_status || "").trim() === "deleted")
        .map((row) => String(row.store_id || "").trim())
        .filter(Boolean),
    );

    const candidates = allocationRows
      .filter((row) => deletedStoreIdSet.has(row.store_id))
      .slice(0, limit);

    let queued = 0;

    for (const row of candidates) {
      await markFirebaseAllocationCleanupQueued(webSupabase, row.store_id);

      await dispatchCleanupWorkflow({
        storeId: row.store_id,
        firebaseProjectId: row.firebase_project_id,
        firebaseCredentialsEnvKey: row.firebase_credentials_env_key,
        packageName: row.package_name,
      });

      queued += 1;
    }

    return NextResponse.json({
      ok: true,
      scanned: allocationRows.length,
      queued,
      deletedStoreCount: deletedStoreIdSet.size,
    });
  } catch (error) {
    console.error("NDJC firebase cleanup-deleted-stores error", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue firebase cleanup jobs.",
      },
      { status: 500 },
    );
  }
}