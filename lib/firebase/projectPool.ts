import type { SupabaseClient } from "@supabase/supabase-js";

type FirebasePoolType = "free" | "paid";

type FirebaseProjectPoolRow = {
  id: string;
  project_id: string;
  project_type: FirebasePoolType;
  credential_env_key: string;
  app_limit: number;
  active_count: number;
  status: "active" | "full" | "disabled";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type FirebaseAllocationRow = {
  id: string;
  store_id: string;
  project_type: FirebasePoolType;
  firebase_project_id: string;
  firebase_credentials_env_key: string;
  package_name: string;
  allocation_status: "active" | "read_only" | "cleanup_queued" | "deleted";
  cleanup_requested_at: string | null;
  released_at: string | null;
  firebase_deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FirebaseProjectAssignment = {
  poolType: FirebasePoolType;
  firebaseProjectId: string;
  firebaseCredentialsEnvKey: string;
  firebaseProjectBucket: number;
  firebaseProjectSlot: number;
  appLimit: number;
};

function normalizePoolType(plan: string): FirebasePoolType {
  const value = (plan || "").trim().toLowerCase();
  return value === "free" ? "free" : "paid";
}

function parseCsvEnv(name: string): string[] {
  const raw = (process.env[name] || "").trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAppLimit(): number {
  const raw = (process.env.FIREBASE_PROJECT_APP_LIMIT || "30").trim();
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("FIREBASE_PROJECT_APP_LIMIT must be a positive integer.");
  }

  return parsed;
}

function getPoolConfig(plan: string): {
  poolType: FirebasePoolType;
  projectIds: string[];
  credentialEnvKeys: string[];
  appLimit: number;
} {
  const poolType = normalizePoolType(plan);

  const projectIds =
    poolType === "free"
      ? parseCsvEnv("FIREBASE_FREE_PROJECT_IDS")
      : parseCsvEnv("FIREBASE_PAID_PROJECT_IDS");

  const credentialEnvKeys =
    poolType === "free"
      ? parseCsvEnv("FIREBASE_FREE_CREDENTIAL_ENV_KEYS")
      : parseCsvEnv("FIREBASE_PAID_CREDENTIAL_ENV_KEYS");

  const appLimit = getAppLimit();

  if (projectIds.length === 0) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_PROJECT_IDS is required."
        : "FIREBASE_PAID_PROJECT_IDS is required.",
    );
  }

  if (credentialEnvKeys.length === 0) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_CREDENTIAL_ENV_KEYS is required."
        : "FIREBASE_PAID_CREDENTIAL_ENV_KEYS is required.",
    );
  }

  if (projectIds.length !== credentialEnvKeys.length) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_PROJECT_IDS and FIREBASE_FREE_CREDENTIAL_ENV_KEYS length mismatch."
        : "FIREBASE_PAID_PROJECT_IDS and FIREBASE_PAID_CREDENTIAL_ENV_KEYS length mismatch.",
    );
  }

  return {
    poolType,
    projectIds,
    credentialEnvKeys,
    appLimit,
  };
}

async function ensureFirebasePoolRows(
  supabase: SupabaseClient,
  config: {
    poolType: FirebasePoolType;
    projectIds: string[];
    credentialEnvKeys: string[];
    appLimit: number;
  },
): Promise<void> {
  const rows = config.projectIds.map((projectId, index) => ({
    project_id: projectId,
    project_type: config.poolType,
    credential_env_key: config.credentialEnvKeys[index],
    app_limit: config.appLimit,
    sort_order: index + 1,
  }));

  const { error } = await supabase
    .from("firebase_project_pool")
    .upsert(rows, {
      onConflict: "project_id",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`Failed to ensure firebase_project_pool rows: ${error.message}`);
  }
}

async function getExistingAllocation(
  supabase: SupabaseClient,
  storeId: string,
): Promise<FirebaseAllocationRow | null> {
  const { data, error } = await supabase
    .from("firebase_app_allocations")
    .select(
      "id,store_id,project_type,firebase_project_id,firebase_credentials_env_key,package_name,allocation_status,cleanup_requested_at,released_at,firebase_deleted_at,created_at,updated_at",
    )
    .eq("store_id", storeId)
    .in("allocation_status", ["active", "read_only", "cleanup_queued"])
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load firebase allocation: ${error.message}`);
  }

  return (data as FirebaseAllocationRow | null) || null;
}

async function listPoolRows(
  supabase: SupabaseClient,
  poolType: FirebasePoolType,
): Promise<FirebaseProjectPoolRow[]> {
  const { data, error } = await supabase
    .from("firebase_project_pool")
    .select(
      "id,project_id,project_type,credential_env_key,app_limit,active_count,status,sort_order,created_at,updated_at",
    )
    .eq("project_type", poolType)
    .in("status", ["active", "full"])
    .order("active_count", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load firebase project pool: ${error.message}`);
  }

  return (data || []) as FirebaseProjectPoolRow[];
}

async function tryReserveProjectRow(
  supabase: SupabaseClient,
  row: FirebaseProjectPoolRow,
): Promise<FirebaseProjectPoolRow | null> {
  if (row.status === "disabled") {
    return null;
  }

  if (row.active_count >= row.app_limit) {
    const { error: markFullError } = await supabase
      .from("firebase_project_pool")
      .update({
        status: "full",
      })
      .eq("project_id", row.project_id);

    if (markFullError) {
      throw new Error(`Failed to mark full firebase project: ${markFullError.message}`);
    }

    return null;
  }

  const nextCount = row.active_count + 1;
  const nextStatus = nextCount >= row.app_limit ? "full" : "active";

  const { data, error } = await supabase
    .from("firebase_project_pool")
    .update({
      active_count: nextCount,
      status: nextStatus,
    })
    .eq("project_id", row.project_id)
    .eq("active_count", row.active_count)
    .select(
      "id,project_id,project_type,credential_env_key,app_limit,active_count,status,sort_order,created_at,updated_at",
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to reserve firebase project row: ${error.message}`);
  }

  return (data as FirebaseProjectPoolRow | null) || null;
}

async function reserveLeastUsedProject(
  supabase: SupabaseClient,
  poolType: FirebasePoolType,
): Promise<FirebaseProjectPoolRow> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = await listPoolRows(supabase, poolType);

    for (const row of rows) {
      const reserved = await tryReserveProjectRow(supabase, row);

      if (reserved) {
        return reserved;
      }
    }
  }

  throw new Error(
    `${poolType} Firebase project pool exhausted. Add another Firebase project and matching credential env key.`,
  );
}

async function rollbackReservedProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("firebase_project_pool")
    .select(
      "id,project_id,project_type,credential_env_key,app_limit,active_count,status,sort_order,created_at,updated_at",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load reserved firebase project for rollback: ${error.message}`);
  }

  const row = (data as FirebaseProjectPoolRow | null) || null;

  if (!row) {
    return;
  }

  const nextCount = row.active_count > 0 ? row.active_count - 1 : 0;
  const nextStatus = nextCount >= row.app_limit ? "full" : "active";

  const { error: updateError } = await supabase
    .from("firebase_project_pool")
    .update({
      active_count: nextCount,
      status: nextStatus,
    })
    .eq("project_id", row.project_id);

  if (updateError) {
    throw new Error(`Failed to rollback firebase project count: ${updateError.message}`);
  }
}

export async function resolveFirebaseProjectAssignment(
  supabase: SupabaseClient,
  input: {
    plan: string;
    storeId: string;
    packageName: string;
  },
): Promise<FirebaseProjectAssignment> {
  const storeId = (input.storeId || "").trim();
  const packageName = (input.packageName || "").trim();

  if (!storeId) {
    throw new Error("storeId is required for Firebase project assignment.");
  }

  if (!packageName) {
    throw new Error("packageName is required for Firebase project assignment.");
  }

  const config = getPoolConfig(input.plan);

  await ensureFirebasePoolRows(supabase, config);

  const existingAllocation = await getExistingAllocation(supabase, storeId);

  if (existingAllocation) {
    const matchedIndex = config.projectIds.findIndex(
      (projectId) => projectId === existingAllocation.firebase_project_id,
    );

    if (matchedIndex < 0) {
      throw new Error(
        `Existing firebase allocation project not found in env config: ${existingAllocation.firebase_project_id}`,
      );
    }

    return {
      poolType: config.poolType,
      firebaseProjectId: existingAllocation.firebase_project_id,
      firebaseCredentialsEnvKey: existingAllocation.firebase_credentials_env_key,
      firebaseProjectBucket: matchedIndex + 1,
      firebaseProjectSlot: 0,
      appLimit: config.appLimit,
    };
  }

  const reservedProject = await reserveLeastUsedProject(supabase, config.poolType);

  try {
    const { error: allocationError } = await supabase
      .from("firebase_app_allocations")
      .insert({
        store_id: storeId,
        project_type: config.poolType,
        firebase_project_id: reservedProject.project_id,
        firebase_credentials_env_key: reservedProject.credential_env_key,
        package_name: packageName,
        allocation_status: "active",
      });

    if (allocationError) {
      throw new Error(allocationError.message);
    }

    return {
      poolType: config.poolType,
      firebaseProjectId: reservedProject.project_id,
      firebaseCredentialsEnvKey: reservedProject.credential_env_key,
      firebaseProjectBucket: reservedProject.sort_order,
      firebaseProjectSlot: reservedProject.active_count - 1,
      appLimit: reservedProject.app_limit,
    };
  } catch (error) {
    await rollbackReservedProject(supabase, reservedProject.project_id);

    throw error;
  }
}

export async function markFirebaseAllocationCleanupQueued(
  supabase: SupabaseClient,
  storeId: string,
): Promise<void> {
  const { error } = await supabase
    .from("firebase_app_allocations")
    .update({
      allocation_status: "cleanup_queued",
      cleanup_requested_at: new Date().toISOString(),
    })
    .eq("store_id", storeId)
    .in("allocation_status", ["active", "read_only"]);

  if (error) {
    throw new Error(`Failed to mark firebase allocation cleanup_queued: ${error.message}`);
  }
}

export async function finalizeFirebaseAllocationDeletion(
  supabase: SupabaseClient,
  storeId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("firebase_app_allocations")
    .select(
      "id,store_id,project_type,firebase_project_id,firebase_credentials_env_key,package_name,allocation_status,cleanup_requested_at,released_at,firebase_deleted_at,created_at,updated_at",
    )
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load firebase allocation for finalize delete: ${error.message}`);
  }

  const allocation = (data as FirebaseAllocationRow | null) || null;

  if (!allocation) {
    return;
  }

  if (allocation.allocation_status === "deleted") {
    return;
  }

  const now = new Date().toISOString();

  const { error: updateAllocationError } = await supabase
    .from("firebase_app_allocations")
    .update({
      allocation_status: "deleted",
      released_at: now,
      firebase_deleted_at: now,
    })
    .eq("store_id", storeId);

  if (updateAllocationError) {
    throw new Error(`Failed to finalize firebase allocation delete: ${updateAllocationError.message}`);
  }

  const { data: poolData, error: poolError } = await supabase
    .from("firebase_project_pool")
    .select(
      "id,project_id,project_type,credential_env_key,app_limit,active_count,status,sort_order,created_at,updated_at",
    )
    .eq("project_id", allocation.firebase_project_id)
    .maybeSingle();

  if (poolError) {
    throw new Error(`Failed to load firebase project pool row for finalize delete: ${poolError.message}`);
  }

  const poolRow = (poolData as FirebaseProjectPoolRow | null) || null;

  if (!poolRow) {
    return;
  }

  const nextCount = poolRow.active_count > 0 ? poolRow.active_count - 1 : 0;
  const nextStatus = nextCount >= poolRow.app_limit ? "full" : "active";

  const { error: poolUpdateError } = await supabase
    .from("firebase_project_pool")
    .update({
      active_count: nextCount,
      status: nextStatus,
    })
    .eq("project_id", poolRow.project_id);

  if (poolUpdateError) {
    throw new Error(`Failed to decrement firebase project active_count: ${poolUpdateError.message}`);
  }
}